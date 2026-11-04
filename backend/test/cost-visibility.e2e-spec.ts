import { INestApplication } from '@nestjs/common';
import request, { Response } from 'supertest';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { createTestApp, truncateAllTables } from './setup';
import { openToday } from './cash-day.helper';
import { AuthService } from '../src/auth/auth.service';
import { User } from '../src/users/entities/user.entity';
import { UserRole } from '../src/users/enums/user-role.enum';
import { Branch } from '../src/branches/entities/branch.entity';
import { Brand } from '../src/brands/entities/brand.entity';
import { Category } from '../src/categories/entities/category.entity';
import { Product } from '../src/products/entities/product.entity';
import { TrackingMethod } from '../src/products/enums/tracking-method.enum';
import { Stock } from '../src/stock/entities/stock.entity';
import { Customer } from '../src/customers/entities/customer.entity';
import { Supplier } from '../src/suppliers/entities/supplier.entity';
import { Payment } from '../src/sales/entities/payment.entity';
import { SaleLine } from '../src/sales/entities/sale-line.entity';
import { PaymentMethod } from '../src/sales/enums/payment-method.enum';

/**
 * Buying and cost prices (INV-F3). Admins and managers receive them; a
 * cashier's response carries none, directly or through a relation, on any
 * route open to cashiers. Selling prices stay visible to all three.
 *
 * The cost figures are checked on the same routes for admins and managers,
 * so the cashier check can't pass because a response has no cost to hide.
 *
 * One app, seeded once; the `it` blocks run in order and share state.
 */
describe('Cost price visibility (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  let branch: Branch;
  let cable: Product;
  let phone: Product;
  let stockId: string;
  let tradeInSaleId: string;
  let purchaseId: string;
  let stockPurchaseId: string;
  let unitId: string;
  const imei = `${Date.now()}`.padEnd(15, '0');
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Colombo',
  }).format(new Date());

  const cookies = {} as Record<UserRole, string[]>;

  const http = () => request(app.getHttpServer());
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const get = (url: string, role: UserRole) =>
    http().get(`/api/v1${url}`).set('Cookie', cookies[role]);

  /** Every path in `node` that holds one of `keys`. */
  function keyPaths(
    node: unknown,
    keys: readonly string[],
    path = '$',
  ): string[] {
    if (Array.isArray(node)) {
      return node.flatMap((v, i) => keyPaths(v, keys, `${path}[${i}]`));
    }
    if (node && typeof node === 'object') {
      return Object.entries(node).flatMap(([k, v]) => [
        ...(keys.includes(k) ? [`${path}.${k}`] : []),
        ...keyPaths(v, keys, `${path}.${k}`),
      ]);
    }
    return [];
  }

  /**
   * total_amount only counts on a phone purchase: it is what the shop paid.
   * trade_in_buying_price is left out on purpose: see cost-visibility.ts.
   */
  const COST_KEYS = [
    'buying_price',
    'cost_price_snapshot',
    'cost_of_sales',
    'unit_buying_price',
  ];
  const expectNoCost = (res: Response): void => {
    expect(keyPaths(res.body, COST_KEYS)).toEqual([]);
  };

  async function seedUser(
    role: UserRole,
    branchId: string | null,
  ): Promise<User> {
    const repo = dataSource.getRepository(User);
    return repo.save(
      repo.create({
        email: `${role}@cost.test`,
        password_hash: 'not-used',
        full_name: `Test ${role}`,
        role,
        is_active: true,
        branch_id: branchId,
      }),
    );
  }

  async function sessionFor(user: User): Promise<string[]> {
    const tokens = await app.get(AuthService).login(user, null, null);
    return [
      `access_token=${tokens.access_token}`,
      `refresh_token=${tokens.refresh_token}`,
    ];
  }

  async function seedProduct(
    name: string,
    tracking: TrackingMethod,
    brandId: string,
    categoryId: string,
  ): Promise<Product> {
    const repo = dataSource.getRepository(Product);
    return repo.save(
      repo.create({
        name,
        sku: `SKU-${name}`,
        barcode: `BC-${name}`,
        brand_id: brandId,
        category_id: categoryId,
        buying_price: '80.00',
        selling_price: '100.00',
        is_active: true,
        is_serialized: tracking !== TrackingMethod.QUANTITY,
        tracking_method: tracking,
      }),
    );
  }

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
    await truncateAllTables(app);

    branch = await dataSource
      .getRepository(Branch)
      .save({ name: 'Main Shop', is_active: true } as Branch);
    const admin = await seedUser(UserRole.ADMIN, null);
    const manager = await seedUser(UserRole.MANAGER, branch.id);
    const cashier = await seedUser(UserRole.CASHIER, branch.id);
    await openToday(dataSource, branch.id, admin.id);
    cookies[UserRole.ADMIN] = await sessionFor(admin);
    cookies[UserRole.MANAGER] = await sessionFor(manager);
    cookies[UserRole.CASHIER] = await sessionFor(cashier);

    const brand = await dataSource
      .getRepository(Brand)
      .save({ name: 'Brand', is_active: true } as Brand);
    const category = await dataSource
      .getRepository(Category)
      .save({ name: 'Category', is_active: true } as Category);
    cable = await seedProduct(
      'cable',
      TrackingMethod.QUANTITY,
      brand.id,
      category.id,
    );
    phone = await seedProduct(
      'phone',
      TrackingMethod.IMEI,
      brand.id,
      category.id,
    );
    const stock = await dataSource.getRepository(Stock).save({
      product_id: cable.id,
      branch_id: branch.id,
      quantity: 10,
      min_quantity: 0,
    } as Stock);
    stockId = stock.id;
  });

  // Spaces requests out to stay under the 10 req/s throttler.
  beforeEach(() => pause(150));

  afterAll(async () => {
    await app.close();
  });

  describe('a cashier working the till', () => {
    it('POST /phone-purchases records the price, and answers without it', async () => {
      const customer = await dataSource.getRepository(Customer).save({
        name: 'Kamal',
        phone: '0771234567',
        nic: '199300000001',
        notes: null,
      });
      const res = await http()
        .post('/api/v1/phone-purchases')
        .set('Cookie', cookies[UserRole.CASHIER])
        .send({
          customer_id: customer.id,
          branch_id: branch.id,
          product_id: phone.id,
          imei,
          buying_price: 80000,
          selling_price: 100000,
        })
        .expect(201);
      purchaseId = res.body.id;
      unitId = res.body.product_units[0].id;

      expectNoCost(res);
      expect(keyPaths(res.body, ['total_amount'])).toEqual([]);
      expect(res.body.product_units[0].selling_price).toBe('100000.00');
      const [row] = await dataSource.query(
        `SELECT total_amount FROM phone_purchases WHERE id = $1`,
        [purchaseId],
      );
      expect(row.total_amount).toBe('80000.00');
    });

    it('sells a product: no cost in any answer, and the cost is still recorded', async () => {
      const post = (url: string, body: object) =>
        http()
          .post(`/api/v1${url}`)
          .set('Cookie', cookies[UserRole.CASHIER])
          .send(body);

      const sale = await post('/sales', { branch_id: branch.id }).expect(201);
      expectNoCost(sale);
      await pause(150);
      const line = await post(`/sales/${sale.body.id}/lines`, {
        product_id: cable.id,
        quantity: 1,
      }).expect(201);
      expectNoCost(line);
      expect(line.body.lines[0].unit_price).toBe('100.00');
      await pause(150);
      const payment = await post(`/sales/${sale.body.id}/payments`, {
        payment_method: PaymentMethod.CASH,
        amount: 100,
        cash_received: 100,
      }).expect(201);
      expectNoCost(payment);
      await pause(150);
      const completed = await post(`/sales/${sale.body.id}/complete`, {});
      expect(completed.status).toBe(200);
      expectNoCost(completed);

      const saved = await dataSource
        .getRepository(SaleLine)
        .findOneByOrFail({ sale_id: sale.body.id });
      expect(saved.cost_price_snapshot).toBe('80.00');
    });

    it('a sale with a trade-in, for the reads below', async () => {
      const sale = await http()
        .post('/api/v1/sales')
        .set('Cookie', cookies[UserRole.CASHIER])
        .send({ branch_id: branch.id })
        .expect(201);
      tradeInSaleId = sale.body.id;
      await pause(150);
      await http()
        .post(`/api/v1/sales/${tradeInSaleId}/lines`)
        .set('Cookie', cookies[UserRole.CASHIER])
        .send({ product_id: cable.id, quantity: 1 })
        .expect(201);
      const payments = dataSource.getRepository(Payment);
      await payments.save(
        payments.create({
          sale_id: tradeInSaleId,
          payment_method: PaymentMethod.TRADE_IN,
          amount: '50.00',
          trade_in_product_id: phone.id,
          trade_in_imei: '490154203237518',
          trade_in_buying_price: '50.00',
        }),
      );
    });
  });

  /** [route, a cost field it carries for admins and managers, a selling field]. */
  const reads = (): [string, string, string][] => [
    ['/products', 'buying_price', 'selling_price'],
    [`/products/${cable.id}`, 'buying_price', 'selling_price'],
    [`/products/by-barcode/${cable.barcode}`, 'buying_price', 'selling_price'],
    ['/stock', 'buying_price', 'selling_price'],
    [`/stock/${stockId}`, 'buying_price', 'selling_price'],
    [`/stock/by-product/${cable.id}`, 'buying_price', 'selling_price'],
    [
      `/product-units/sellable/by-identifier/${imei}?branchId=${branch.id}`,
      'buying_price',
      'selling_price',
    ],
    [`/sales/${tradeInSaleId}`, 'cost_price_snapshot', 'unit_price'],
    [`/sales/${tradeInSaleId}`, 'buying_price', 'unit_price'],
    [
      `/sales/daily-summary?branchId=${branch.id}&from=${today}&to=${today}`,
      'cost_of_sales',
      'sales_amount',
    ],
    ['/phone-purchases', 'buying_price', 'selling_price'],
    ['/phone-purchases', 'total_amount', 'selling_price'],
    [`/phone-purchases/${purchaseId}`, 'buying_price', 'selling_price'],
    [`/phone-purchases/${purchaseId}`, 'total_amount', 'selling_price'],
  ];

  describe('reads', () => {
    it('a cashier gets no cost on any route, and the selling prices', async () => {
      for (const [url, costKey, sellKey] of reads()) {
        await pause(150);
        const res = await get(url, UserRole.CASHIER);
        expect([url, res.status]).toEqual([url, 200]);
        expect([url, keyPaths(res.body, [costKey])]).toEqual([url, []]);
        expectNoCost(res);
        expect(keyPaths(res.body, [sellKey]).length).toBeGreaterThan(0);
      }
    }, 30000);

    it.each([UserRole.ADMIN, UserRole.MANAGER])(
      '%s gets the cost and the selling price on the same routes',
      async (role) => {
        for (const [url, costKey, sellKey] of reads()) {
          await pause(150);
          const res = await get(url, role);
          expect([url, res.status]).toEqual([url, 200]);
          expect(keyPaths(res.body, [costKey]).length).toBeGreaterThan(0);
          expect(keyPaths(res.body, [sellKey]).length).toBeGreaterThan(0);
        }
      },
      30000,
    );

    it('the cost of a completed sale reaches a manager through the summary', async () => {
      const res = await get(
        `/sales/daily-summary?branchId=${branch.id}&from=${today}&to=${today}`,
        UserRole.MANAGER,
      ).expect(200);
      expect(Number(res.body.cost_of_sales)).toBe(80);
    });

    it('a trade-in payment keeps its value for a cashier: it is a tender', async () => {
      const res = await get(`/sales/${tradeInSaleId}`, UserRole.CASHIER).expect(
        200,
      );
      expect(res.body.payments[0]).toMatchObject({
        amount: '50.00',
        trade_in_buying_price: '50.00',
        trade_in_product: { id: phone.id, selling_price: '100.00' },
      });
      expectNoCost(res);
    });
  });

  describe('routes closed to cashiers', () => {
    it('a manager records a stock purchase and reads its cost', async () => {
      const supplier = await dataSource
        .getRepository(Supplier)
        .save({ name: 'Supplier', is_active: true } as Supplier);
      const res = await http()
        .post('/api/v1/stock-purchases')
        .set('Cookie', cookies[UserRole.MANAGER])
        .send({
          supplier_id: supplier.id,
          branch_id: branch.id,
          client_request_id: randomUUID(),
          items: [
            { product_id: cable.id, quantity: 1, unit_buying_price: '80.00' },
          ],
        })
        .expect(201);
      stockPurchaseId = res.body.id;
      expect(res.body.items[0].unit_buying_price).toBe('80.00');
    });

    it('a manager keeps the cost of product units', async () => {
      const list = await get('/product-units', UserRole.MANAGER).expect(200);
      expect(list.body.data[0].buying_price).toBe('80000.00');
      await pause(150);
      const one = await get(
        `/product-units/${unitId}`,
        UserRole.MANAGER,
      ).expect(200);
      expect(one.body.buying_price).toBe('80000.00');
      expect(one.body.phone_purchase.total_amount).toBe('80000.00');
    });

    it('a cashier is refused every purchase and unit route', async () => {
      const closed = [
        '/product-units',
        `/product-units/${unitId}`,
        '/stock-purchases',
        '/stock-purchases/supplier-balances',
        `/stock-purchases/${stockPurchaseId}`,
        `/stock-purchases/products/${cable.id}/identifiers`,
      ];
      for (const url of closed) {
        await pause(150);
        const res = await get(url, UserRole.CASHIER);
        expect([url, res.status]).toEqual([url, 403]);
      }
    });
  });

  it('an unauthenticated request gets no data at all', async () => {
    await http().get('/api/v1/products').expect(401);
  });
});
