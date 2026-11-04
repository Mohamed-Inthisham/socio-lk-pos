import { INestApplication } from '@nestjs/common';
import request, { Response } from 'supertest';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { createTestApp, truncateAllTables } from './setup';
import { openToday } from './cash-day.helper';
import { approvalFor, giveApprovalPin } from './approval-pin.helper';
import { AuthService } from '../src/auth/auth.service';
import { User } from '../src/users/entities/user.entity';
import { UserRole } from '../src/users/enums/user-role.enum';
import { Branch } from '../src/branches/entities/branch.entity';
import { Brand } from '../src/brands/entities/brand.entity';
import { Category } from '../src/categories/entities/category.entity';
import { Product } from '../src/products/entities/product.entity';
import { TrackingMethod } from '../src/products/enums/tracking-method.enum';
import { WarrantyPeriod } from '../src/products/enums/warranty-period.enum';
import { ProductUnit } from '../src/product-units/entities/product-unit.entity';
import { ProductUnitStatus } from '../src/product-units/enums/product-unit-status.enum';
import { Stock } from '../src/stock/entities/stock.entity';
import { Customer } from '../src/customers/entities/customer.entity';
import { Supplier } from '../src/suppliers/entities/supplier.entity';
import { PaymentMethod } from '../src/sales/enums/payment-method.enum';

/**
 * GET /product-units/:id/details (INV-F2): one unit for its details page.
 * Every unit here is made through the real endpoints, so the ledger, trade-in
 * and return links are the ones production writes; only the pre-ledger unit
 * is inserted directly, because nothing writes one any more.
 *
 * The customer, notes and return reason hold values the response must never
 * carry, and the forbidden-data check looks for those values as well as the
 * keys, so it can't pass because they were empty.
 *
 * One app, seeded once; the `it` blocks run in order and share state.
 */
describe('Product unit details (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  let branchA: Branch;
  let branchB: Branch;
  let admin: User;
  let managerA: User;
  let phone: Product;
  let cable: Product;
  let customer: Customer;
  let supplier: Supplier;

  const cookies = {} as Record<
    'admin' | 'managerA' | 'managerB' | 'cashierA',
    string[]
  >;
  const seenUnitIds: string[] = [];

  const BUYING = '81234.00';
  const SELLING = '101234.00';
  const CUSTOMER_PHONE = '0771234567';
  const CUSTOMER_NIC = '199300000001';
  const CUSTOMER_EMAIL = 'kamal@details.test';
  const NOTE = 'Private note about the seller';
  const RETURN_REASON = 'Private reason for the return';

  const FORBIDDEN_KEYS = [
    'buying_price',
    'selling_price',
    'cost_price_snapshot',
    'unit_buying_price',
    'trade_in_buying_price',
    'total_amount',
    'amount',
    'phone',
    'nic',
    'email',
    'address',
    'notes',
    'reason',
    'override_reason',
  ];
  const FORBIDDEN_VALUES = [
    BUYING,
    SELLING,
    CUSTOMER_PHONE,
    CUSTOMER_NIC,
    CUSTOMER_EMAIL,
    NOTE,
    RETURN_REASON,
  ];

  const http = () => request(app.getHttpServer());
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

  let imeiCount = 0;
  const nextImei = (): string =>
    `3567890${String(++imeiCount).padStart(8, '0')}`;

  /** Every key in `node`, at any depth. */
  function allKeys(node: unknown): string[] {
    if (Array.isArray(node)) return node.flatMap(allKeys);
    if (node && typeof node === 'object') {
      return Object.entries(node).flatMap(([k, v]) => [k, ...allKeys(v)]);
    }
    return [];
  }

  async function details(
    unitId: string,
    as: keyof typeof cookies = 'admin',
  ): Promise<Response> {
    await pause(150); // stay under the 10 req/s throttler
    return http()
      .get(`/api/v1/product-units/${unitId}/details`)
      .set('Cookie', cookies[as]);
  }

  async function seedUser(
    role: UserRole,
    email: string,
    branch: Branch | null,
  ): Promise<User> {
    const repo = dataSource.getRepository(User);
    const user = await repo.save(
      repo.create({
        email,
        password_hash: 'not-used',
        full_name: `Test ${email.split('@')[0]}`,
        role,
        is_active: true,
        branch_id: branch?.id ?? null,
      }),
    );
    if (role !== UserRole.CASHIER) await giveApprovalPin(dataSource, user.id);
    return user;
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
        buying_price: BUYING,
        selling_price: SELLING,
        default_warranty: WarrantyPeriod.MONTH_12,
        is_active: true,
        is_serialized: tracking !== TrackingMethod.QUANTITY,
        tracking_method: tracking,
      }),
    );
  }

  /** A phone bought outright through POST /phone-purchases: its unit id. */
  async function buyPhone(imei: string, branch = branchA): Promise<string> {
    await pause(150);
    const res = await http()
      .post('/api/v1/phone-purchases')
      .set(
        'Cookie',
        branch.id === branchA.id ? cookies.managerA : cookies.managerB,
      )
      .send({
        customer_id: customer.id,
        branch_id: branch.id,
        product_id: phone.id,
        imei,
        buying_price: Number(BUYING),
        selling_price: Number(SELLING),
        notes: NOTE,
      })
      .expect(201);
    const unitId = (res.body as { product_units: { id: string }[] })
      .product_units[0].id;
    seenUnitIds.push(unitId);
    return unitId;
  }

  /** A phone received through POST /stock-purchases. */
  async function receivePhone(
    imei: string,
  ): Promise<{ unitId: string; purchase: Record<string, string> }> {
    await pause(150);
    const res = await http()
      .post('/api/v1/stock-purchases')
      .set('Cookie', cookies.managerA)
      .send({
        supplier_id: supplier.id,
        branch_id: branchA.id,
        purchase_date: '2026-10-27',
        client_request_id: randomUUID(),
        notes: NOTE,
        items: [
          {
            product_id: phone.id,
            quantity: 1,
            unit_buying_price: BUYING,
            unit_selling_price: SELLING,
            imei_numbers: [imei],
          },
        ],
      })
      .expect(201);
    const unit = await dataSource
      .getRepository(ProductUnit)
      .findOneByOrFail({ imei, status: ProductUnitStatus.IN_STOCK });
    seenUnitIds.push(unit.id);
    return { unitId: unit.id, purchase: res.body as Record<string, string> };
  }

  async function post(url: string, body?: object): Promise<Response> {
    await pause(150);
    const req = http().post(`/api/v1${url}`).set('Cookie', cookies.managerA);
    return body ? req.send(body) : req;
  }

  /** A draft with one line for this IMEI: its id and line. */
  async function draftWith(
    imei: string,
    customerId?: string,
  ): Promise<{ id: string; lineId: string; total: number }> {
    const sale = await post('/sales', {
      branch_id: branchA.id,
      ...(customerId ? { customer_id: customerId } : {}),
    });
    expect(sale.status).toBe(201);
    const line = await post(`/sales/${sale.body.id}/lines`, {
      product_id: phone.id,
      quantity: 1,
      imei_snapshot: imei,
      warranty: WarrantyPeriod.MONTH_12,
    });
    expect(line.status).toBe(201);
    return {
      id: sale.body.id,
      lineId: line.body.lines[0].id,
      total: Number(line.body.total),
    };
  }

  /** A completed sale of this IMEI, paid in cash. */
  async function sell(
    imei: string,
    customerId?: string,
  ): Promise<{ id: string; saleNumber: string; lineId: string }> {
    const draft = await draftWith(imei, customerId);
    const paid = await post(`/sales/${draft.id}/payments`, {
      payment_method: PaymentMethod.CASH,
      amount: draft.total,
      cash_received: draft.total,
    });
    expect(paid.status).toBe(201);
    const done = await post(`/sales/${draft.id}/complete`);
    expect(done.status).toBe(200);
    return {
      id: draft.id,
      saleNumber: done.body.sale_number,
      lineId: draft.lineId,
    };
  }

  /** A completed sale of a cable, paid with a traded-in phone. */
  async function takeTradeIn(
    imei: string,
  ): Promise<{ saleId: string; saleNumber: string; unitId: string }> {
    const sale = await post('/sales', {
      branch_id: branchA.id,
      customer_id: customer.id,
    });
    expect(sale.status).toBe(201);
    const line = await post(`/sales/${sale.body.id}/lines`, {
      product_id: cable.id,
      quantity: 1,
    });
    expect(line.status).toBe(201);
    const total = Number(line.body.total);
    const paid = await post(`/sales/${sale.body.id}/payments`, {
      payment_method: PaymentMethod.TRADE_IN,
      amount: total,
      trade_in_product_id: phone.id,
      trade_in_imei: imei,
      trade_in_buying_price: total,
      trade_in_notes: NOTE,
    });
    expect(paid.status).toBe(201);
    const done = await post(`/sales/${sale.body.id}/complete`);
    expect(done.status).toBe(200);
    const unit = await dataSource
      .getRepository(ProductUnit)
      .findOneByOrFail({ imei, status: ProductUnitStatus.IN_STOCK });
    seenUnitIds.push(unit.id);
    return {
      saleId: sale.body.id,
      saleNumber: done.body.sale_number,
      unitId: unit.id,
    };
  }

  const voidSale = async (saleId: string): Promise<void> => {
    const res = await post(`/sales/${saleId}/void`, {
      void_reason: 'Wrong item rung up',
      approval: approvalFor(managerA.id),
    });
    expect(res.status).toBe(200);
  };

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
    await truncateAllTables(app);

    branchA = await dataSource
      .getRepository(Branch)
      .save({ name: 'Main Shop', is_active: true } as Branch);
    branchB = await dataSource
      .getRepository(Branch)
      .save({ name: 'City Shop', is_active: true } as Branch);
    admin = await seedUser(UserRole.ADMIN, 'admin@details.test', null);
    managerA = await seedUser(
      UserRole.MANAGER,
      'manager-a@details.test',
      branchA,
    );
    const managerB = await seedUser(
      UserRole.MANAGER,
      'manager-b@details.test',
      branchB,
    );
    const cashierA = await seedUser(
      UserRole.CASHIER,
      'cashier-a@details.test',
      branchA,
    );
    cookies.admin = await sessionFor(admin);
    cookies.managerA = await sessionFor(managerA);
    cookies.managerB = await sessionFor(managerB);
    cookies.cashierA = await sessionFor(cashierA);
    await openToday(dataSource, branchA.id, admin.id);
    await openToday(dataSource, branchB.id, admin.id);

    const brand = await dataSource
      .getRepository(Brand)
      .save({ name: 'Brand', is_active: true } as Brand);
    const category = await dataSource
      .getRepository(Category)
      .save({ name: 'Category', is_active: true } as Category);
    phone = await seedProduct(
      'phone',
      TrackingMethod.IMEI,
      brand.id,
      category.id,
    );
    cable = await seedProduct(
      'cable',
      TrackingMethod.QUANTITY,
      brand.id,
      category.id,
    );
    await dataSource.getRepository(Stock).save({
      product_id: cable.id,
      branch_id: branchA.id,
      quantity: 100,
      min_quantity: 0,
    } as Stock);
    customer = await dataSource.getRepository(Customer).save({
      name: 'Kamal Perera',
      phone: CUSTOMER_PHONE,
      nic: CUSTOMER_NIC,
      email: CUSTOMER_EMAIL,
      notes: NOTE,
    });
    supplier = await dataSource
      .getRepository(Supplier)
      .save({ name: 'Ranjith Mobiles', is_active: true } as Supplier);
  });

  // Spaces tests out to stay under the 10 req/s throttler.
  beforeEach(() => pause(150));

  afterAll(async () => {
    await app.close();
  });

  describe('access', () => {
    let unitId: string;

    beforeAll(async () => {
      unitId = await buyPhone(nextImei());
    });

    it('an admin opens a unit at any branch', async () => {
      const res = await details(unitId, 'admin');

      expect(res.status).toBe(200);
      expect(res.body.unit.id).toBe(unitId);
    });

    it('a manager opens a unit at their own branch', async () => {
      const res = await details(unitId, 'managerA');

      expect(res.status).toBe(200);
      expect(res.body.branch).toEqual({ id: branchA.id, name: 'Main Shop' });
    });

    it('a cashier is refused', async () => {
      const res = await details(unitId, 'cashierA');

      expect(res.status).toBe(403);
    });

    it('no session is 401', async () => {
      await http().get(`/api/v1/product-units/${unitId}/details`).expect(401);
    });

    it('another branch’s unit is the same 404 as a missing id, for a manager', async () => {
      const other = await details(unitId, 'managerB');
      const missing = await details(randomUUID(), 'managerB');

      expect(other.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(other.body).toEqual(missing.body);
    });

    it('a missing id is 404 for an admin', async () => {
      const res = await details(randomUUID(), 'admin');

      expect(res.status).toBe(404);
    });

    it('a malformed id is 400, and "details" isn’t read as an id', async () => {
      const res = await details('not-a-uuid', 'admin');

      expect(res.status).toBe(400);
    });

    it('GET /product-units/:id keeps its fuller answer for existing consumers', async () => {
      await pause(150);
      const res = await http()
        .get(`/api/v1/product-units/${unitId}`)
        .set('Cookie', cookies.admin)
        .expect(200);

      expect(res.body.buying_price).toBe(BUYING);
      expect(res.body.phone_purchase.customer.phone).toBe(CUSTOMER_PHONE);
    });
  });

  describe('acquisition', () => {
    it('a stock purchase: its number, date and supplier, through the ledger', async () => {
      const { unitId, purchase } = await receivePhone(nextImei());

      const res = await details(unitId);

      expect(res.status).toBe(200);
      expect(res.body.acquisition).toEqual({
        type: 'STOCK_PURCHASE',
        date: '2026-10-27',
        stock_purchase: {
          id: purchase.id,
          purchase_number: purchase.purchase_number,
        },
        supplier_name: 'Ranjith Mobiles',
        customer_name: null,
        sale: null,
      });
    });

    it('a phone purchase: its date and seller', async () => {
      const unitId = await buyPhone(nextImei());

      const res = await details(unitId);

      expect(res.body.acquisition).toMatchObject({
        type: 'PHONE_PURCHASE',
        date: expect.any(String),
        stock_purchase: null,
        supplier_name: null,
        customer_name: 'Kamal Perera',
        sale: null,
      });
    });

    it('a trade-in: its date, customer and sale, and it stays one after a void', async () => {
      const { saleId, saleNumber, unitId } = await takeTradeIn(nextImei());
      const expected = {
        type: 'TRADE_IN',
        date: expect.any(String),
        stock_purchase: null,
        supplier_name: null,
        customer_name: 'Kamal Perera',
        sale: { id: saleId, sale_number: saleNumber },
      };

      expect((await details(unitId)).body.acquisition).toMatchObject(expected);

      await voidSale(saleId);

      const voided = await details(unitId);
      expect(voided.body.unit.status).toBe(ProductUnitStatus.RETURNED);
      expect(voided.body.acquisition).toMatchObject(expected);
    });

    it('a unit with no phone purchase and no ledger row is UNKNOWN', async () => {
      const repo = dataSource.getRepository(ProductUnit);
      const unit = await repo.save(
        repo.create({
          product_id: phone.id,
          branch_id: branchA.id,
          imei: nextImei(),
          status: ProductUnitStatus.IN_STOCK,
          buying_price: BUYING,
          selling_price: null,
          phone_purchase_id: null,
        }),
      );
      seenUnitIds.push(unit.id);

      const res = await details(unit.id);

      expect(res.body.acquisition).toEqual({
        type: 'UNKNOWN',
        date: null,
        stock_purchase: null,
        supplier_name: null,
        customer_name: null,
        sale: null,
      });
    });

    it('an identifier on a purchase line doesn’t make an unlinked unit that purchase’s', async () => {
      const imei = nextImei();
      const { unitId } = await receivePhone(imei);
      await sell(imei);
      const repo = dataSource.getRepository(ProductUnit);
      const unlinked = await repo.save(
        repo.create({
          product_id: phone.id,
          branch_id: branchA.id,
          imei,
          status: ProductUnitStatus.IN_STOCK,
          buying_price: BUYING,
          selling_price: null,
          phone_purchase_id: null,
        }),
      );
      seenUnitIds.push(unlinked.id);

      expect((await details(unlinked.id)).body.acquisition.type).toBe(
        'UNKNOWN',
      );
      expect((await details(unitId)).body.acquisition.type).toBe(
        'STOCK_PURCHASE',
      );
    });
  });

  describe('sales', () => {
    it('leaves a draft out', async () => {
      const imei = nextImei();
      const unitId = await buyPhone(imei);
      const draft = await draftWith(imei);

      const res = await details(unitId);

      expect(res.body.sales).toEqual([]);
      await pause(150);
      await http()
        .delete(`/api/v1/sales/${draft.id}`)
        .set('Cookie', cookies.managerA);
    });

    it('a sale with no customer has a null customer_name, and a customer’s sale their name', async () => {
      const walkInImei = nextImei();
      const walkInUnit = await buyPhone(walkInImei);
      const namedImei = nextImei();
      const namedUnit = await buyPhone(namedImei);
      const walkIn = await sell(walkInImei);
      const named = await sell(namedImei, customer.id);

      expect((await details(walkInUnit)).body.sales).toEqual([
        expect.objectContaining({
          id: walkIn.id,
          sale_number: walkIn.saleNumber,
          status: 'COMPLETED',
          customer_name: null,
          voided_at: null,
        }),
      ]);
      expect((await details(namedUnit)).body.sales).toEqual([
        expect.objectContaining({
          id: named.id,
          customer_name: 'Kamal Perera',
        }),
      ]);
    });

    it('keeps a voided sale, and lists the newest first', async () => {
      const imei = nextImei();
      const unitId = await buyPhone(imei);
      const first = await sell(imei);
      await voidSale(first.id);
      const second = await sell(imei);

      const res = await details(unitId);

      expect(res.body.unit.status).toBe(ProductUnitStatus.SOLD);
      expect(
        (res.body.sales as { id: string; status: string }[]).map((s) => [
          s.id,
          s.status,
        ]),
      ).toEqual([
        [second.id, 'COMPLETED'],
        [first.id, 'VOIDED'],
      ]);
      expect(res.body.sales[1].voided_at).toEqual(expect.any(String));
    });
  });

  describe('returns', () => {
    it('shows a return with its sale, and no reason', async () => {
      const imei = nextImei();
      const unitId = await buyPhone(imei);
      const sale = await sell(imei, customer.id);
      const returned = await post(`/sales/${sale.id}/returns`, {
        client_request_id: randomUUID(),
        lines: [{ sale_line_id: sale.lineId, quantity: 1 }],
        refunds: [],
        reason: RETURN_REASON,
        approval: approvalFor(managerA.id),
      });
      expect(returned.status).toBe(201);

      const res = await details(unitId);

      expect(res.body.unit.status).toBe(ProductUnitStatus.INSPECTION);
      expect(res.body.returns).toEqual([
        {
          id: returned.body.return_id,
          return_number: expect.any(String),
          sale_id: sale.id,
          sale_number: sale.saleNumber,
          disposition: 'INSPECTION',
          returned_at: expect.any(String),
        },
      ]);
    });

    it('a unit never returned has an empty list', async () => {
      const unitId = await buyPhone(nextImei());

      expect((await details(unitId)).body.returns).toEqual([]);
    });
  });

  describe('a bought-back IMEI', () => {
    it('keeps each acquisition on its own unit', async () => {
      const imei = nextImei();
      const firstUnit = await buyPhone(imei);
      const sale = await sell(imei, customer.id);
      const secondUnit = await buyPhone(imei);

      const first = await details(firstUnit);
      const second = await details(secondUnit);

      expect(secondUnit).not.toBe(firstUnit);
      expect(first.body.unit).toMatchObject({
        imei,
        status: ProductUnitStatus.SOLD,
      });
      expect((first.body.sales as { id: string }[]).map((s) => s.id)).toEqual([
        sale.id,
      ]);
      expect(second.body.unit).toMatchObject({
        imei,
        status: ProductUnitStatus.IN_STOCK,
      });
      expect(second.body.acquisition.type).toBe('PHONE_PURCHASE');
      expect(second.body.sales).toEqual([]);
    });
  });

  describe('forbidden data', () => {
    it('no unit above carries a price, an amount, contact details or free text', async () => {
      expect(seenUnitIds.length).toBeGreaterThan(5);

      for (const unitId of seenUnitIds) {
        const res = await details(unitId);
        expect(res.status).toBe(200);

        const keys = allKeys(res.body);
        for (const key of FORBIDDEN_KEYS) {
          expect([unitId, key, keys.includes(key)]).toEqual([
            unitId,
            key,
            false,
          ]);
        }
        const text = JSON.stringify(res.body);
        for (const value of FORBIDDEN_VALUES) {
          expect(text).not.toContain(value);
        }
      }
    }, 30000);
  });
});
