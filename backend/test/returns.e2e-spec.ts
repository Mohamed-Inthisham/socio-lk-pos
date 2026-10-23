import { INestApplication } from '@nestjs/common';
import request, { Response } from 'supertest';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { createTestApp, truncateAllTables } from './setup';
import { approvalFor, giveApprovalPin } from './approval-pin.helper';
import { User } from '../src/users/entities/user.entity';
import { UserRole } from '../src/users/enums/user-role.enum';
import { Branch } from '../src/branches/entities/branch.entity';
import { Brand } from '../src/brands/entities/brand.entity';
import { Category } from '../src/categories/entities/category.entity';
import { Product } from '../src/products/entities/product.entity';
import { ProductType } from '../src/products/enums/product-type.enum';
import { WarrantyPeriod } from '../src/products/enums/warranty-period.enum';
import { Stock } from '../src/stock/entities/stock.entity';
import { Customer } from '../src/customers/entities/customer.entity';
import { Supplier } from '../src/suppliers/entities/supplier.entity';
import { ProductUnit } from '../src/product-units/entities/product-unit.entity';
import { ProductUnitStatus } from '../src/product-units/enums/product-unit-status.enum';
import { PhonePurchase } from '../src/phone-purchases/entities/phone-purchase.entity';
import { SaleLine } from '../src/sales/entities/sale-line.entity';
import { DiscountType } from '../src/sales/enums/discount-type.enum';
import { PaymentMethod } from '../src/sales/enums/payment-method.enum';
import { ReturnCondition } from '../src/sales/enums/return-condition.enum';
import { AuditLog } from '../src/audit-log/entities/audit-log.entity';
import { AuditAction } from '../src/audit-log/enums/audit-action.enum';

/**
 * Returns and refunds (Phase 6.4 P7, step 0b): POST /sales/:id/returns,
 * the read side (GET /sales, GET /sales/:id), GET /sale-returns/inspection
 * and the void refusal. Planning doc section 8 "P7 decision log".
 *
 * Users and branches are seeded once; every test makes its own products
 * and sales, so tests don't share stock or lines. Requests go through a
 * small limiter that keeps each route under the app's throttle (10 a
 * second, 100 a minute, per route).
 */
describe('Returns (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  const PASSWORD = 'testpass123';
  const WRONG_PIN = '193728';

  let branchA: Branch;
  let branchB: Branch;
  let admin: User;
  let managerA: User;
  let managerB: User;
  let cashierA: User;
  let customer: Customer;
  let supplier: Supplier;
  let adminCookies: string[];
  let managerACookies: string[];
  let managerBCookies: string[];
  let cashierACookies: string[];
  let cashierA2Cookies: string[];
  let cashierBCookies: string[];

  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // ---- Request pacing (the app's throttle is per route) ----

  const calls = new Map<string, number[]>();
  async function paced(key: string): Promise<void> {
    for (;;) {
      const now = Date.now();
      const recent = (calls.get(key) ?? []).filter((t) => now - t < 60_000);
      calls.set(key, recent);
      const lastSecond = recent.filter((t) => now - t < 1_000);
      if (recent.length >= 90) {
        await pause(60_000 - (now - recent[0]) + 50);
      } else if (lastSecond.length >= 8) {
        await pause(1_000 - (now - lastSecond[0]) + 20);
      } else {
        recent.push(now);
        return;
      }
    }
  }

  async function call(
    method: 'get' | 'post' | 'put',
    path: string,
    cookies: string[],
    body?: object,
    query?: Record<string, string>,
  ): Promise<Response> {
    await paced(`${method} ${path.replace(/[0-9a-f-]{36}/g, ':id')}`);
    let req = request(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set('Cookie', cookies);
    if (query) req = req.query(query);
    return body ? req.send(body) : req;
  }

  // ---- Seeding ----

  async function seedUser(
    role: UserRole,
    email: string,
    branch: Branch | null,
  ): Promise<{ user: User; cookies: string[] }> {
    const repo = dataSource.getRepository(User);
    const user = await repo.save(
      repo.create({
        email,
        password_hash: await bcrypt.hash(PASSWORD, 4),
        full_name: `Test ${role} ${email.split('@')[0]}`,
        role,
        is_active: true,
        branch_id: branch?.id ?? null,
      }),
    );
    if (role !== UserRole.CASHIER) await giveApprovalPin(dataSource, user.id);
    await pause(500); // login throttle
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return {
      user,
      cookies: login.headers['set-cookie'] as unknown as string[],
    };
  }

  let brand: Brand;
  let category: Category;

  async function seedProduct(
    name: string,
    opts: {
      branch?: Branch;
      price?: string;
      serialized?: boolean;
      stock?: number;
      manageStock?: boolean;
    } = {},
  ): Promise<Product> {
    const suffix = Math.random().toString(36).slice(2, 8);
    const branch = opts.branch ?? branchA;
    const product = await dataSource.getRepository(Product).save(
      dataSource.getRepository(Product).create({
        product_type: ProductType.PHONE,
        name: `${name} ${suffix}`,
        sku: `SKU-RET-${suffix}`,
        barcode: `BC-RET-${suffix}`,
        brand_id: brand.id,
        category_id: category.id,
        branch_id: branch.id,
        buying_price: '100.00',
        selling_price: opts.price ?? '1000.00',
        is_active: true,
        is_serialized: opts.serialized ?? false,
        default_warranty: WarrantyPeriod.MONTH_12,
      }),
    );
    await dataSource.getRepository(Stock).save(
      dataSource.getRepository(Stock).create({
        product_id: product.id,
        branch_id: branch.id,
        quantity: opts.stock ?? (opts.serialized ? 0 : 10),
        min_quantity: 0,
        manage_stock: opts.manageStock ?? true,
      }),
    );
    return product;
  }

  let imeiSeq = 0;
  const nextImei = () =>
    `35693803${String(Date.now() % 1_000_000).padStart(6, '0')}${imeiSeq++ % 10}`;

  /** A phone in stock: its purchase, an IN_STOCK unit, stock +1. */
  async function seedPhone(product: Product): Promise<ProductUnit> {
    const purchase = await dataSource.getRepository(PhonePurchase).save(
      dataSource.getRepository(PhonePurchase).create({
        customer_id: customer.id,
        branch_id: product.branch_id,
        cashier_id: cashierA.id,
        total_amount: '100.00',
        notes: null,
      }),
    );
    const unit = await dataSource.getRepository(ProductUnit).save(
      dataSource.getRepository(ProductUnit).create({
        product_id: product.id,
        branch_id: product.branch_id,
        imei: nextImei(),
        status: ProductUnitStatus.IN_STOCK,
        buying_price: '100.00',
        selling_price: null,
        phone_purchase_id: purchase.id,
      }),
    );
    await dataSource.query(
      `UPDATE stock SET quantity = quantity + 1 WHERE product_id = $1`,
      [product.id],
    );
    return unit;
  }

  /** The parts of a hydrated sale body these tests read. */
  interface SoldSale {
    id: string;
    sale_number: string;
    total: string;
    lines: { id: string; line_total: string; product_unit_id: string | null }[];
    payments: { id: string; payment_method: string }[];
  }
  interface ReturnRow {
    id: string;
    return_number: string;
    created_at: string;
    refund_due: string;
    lines: {
      sale_line_id: string;
      out_of_warranty: boolean;
      disposition: string;
    }[];
  }
  interface InspectionRowBody {
    product_unit: { id: string };
    returned_at: string;
  }
  const returnsOf = (res: Response): ReturnRow[] =>
    (res.body as { sale: { returns: ReturnRow[] } }).sale.returns;
  const inspectionOf = (res: Response): InspectionRowBody[] =>
    res.body as InspectionRowBody[];
  const saleRows = (res: Response): { id: string }[] =>
    (res.body as { data: { id: string }[] }).data;

  interface LineSpec {
    product: Product;
    quantity?: number;
    imei?: string;
    discount?: { type: DiscountType; value: number };
    supplier?: Supplier;
    warranty?: WarrantyPeriod;
  }
  interface PaySpec {
    method: PaymentMethod;
    amount: number;
    reference?: string;
    tradeIn?: { product: Product; imei: string };
  }

  /**
   * A completed sale through the real endpoints. Paid in cash unless
   * `payments` says otherwise. Returns the completed sale's body.
   */
  async function sell(
    lines: LineSpec[],
    opts: {
      branch?: Branch;
      cookies?: string[];
      payments?: PaySpec[];
      withCustomer?: boolean;
    } = {},
  ): Promise<SoldSale> {
    const cookies = opts.cookies ?? cashierACookies;
    const branch = opts.branch ?? branchA;
    const created = await call('post', '/sales', cookies, {
      branch_id: branch.id,
      ...(opts.withCustomer ? { customer_id: customer.id } : {}),
    });
    expect(created.status).toBe(201);
    const saleId = created.body.id as string;
    let total = 0;
    for (const line of lines) {
      const res = await call('post', `/sales/${saleId}/lines`, cookies, {
        product_id: line.product.id,
        quantity: line.quantity ?? 1,
        ...(line.imei ? { imei_snapshot: line.imei } : {}),
        ...(line.discount
          ? {
              discount_type: line.discount.type,
              discount_value: line.discount.value,
            }
          : {}),
        ...(line.supplier ? { external_supplier_id: line.supplier.id } : {}),
        ...(line.warranty ? { warranty: line.warranty } : {}),
      });
      expect(res.status).toBe(201);
      total = Number(res.body.total);
    }
    const payments = opts.payments ?? [
      { method: PaymentMethod.CASH, amount: total },
    ];
    for (const p of payments) {
      const body =
        p.method === PaymentMethod.CASH
          ? {
              payment_method: p.method,
              amount: p.amount,
              cash_received: p.amount,
            }
          : p.method === PaymentMethod.TRADE_IN
            ? {
                payment_method: p.method,
                amount: p.amount,
                trade_in_product_id: p.tradeIn!.product.id,
                trade_in_imei: p.tradeIn!.imei,
                trade_in_buying_price: p.amount,
              }
            : {
                payment_method: p.method,
                amount: p.amount,
                reference_number: p.reference ?? 'AUTH-1',
              };
      const res = await call(
        'post',
        `/sales/${saleId}/payments`,
        cookies,
        body,
      );
      expect(res.status).toBe(201);
    }
    const done = await call('post', `/sales/${saleId}/complete`, cookies);
    expect(done.status).toBe(200);
    return done.body as SoldSale;
  }

  type ReturnLine = {
    sale_line_id: string;
    quantity: number;
    condition?: ReturnCondition;
  };
  type Refund = {
    method: PaymentMethod;
    amount: number;
    original_payment_id?: string;
    reference_number?: string;
  };

  /** A return body approved by managerA with the test PIN. */
  const returnBody = (
    lines: ReturnLine[],
    refunds: Refund[] = [],
    extra: Record<string, unknown> = {},
  ) => ({
    client_request_id: randomUUID(),
    lines,
    refunds,
    reason: 'Customer changed their mind',
    approval: approvalFor(managerA.id),
    ...extra,
  });

  const postReturn = (
    saleId: string,
    body: object,
    cookies: string[] = cashierACookies,
  ) => call('post', `/sales/${saleId}/returns`, cookies, body);

  const cash = (amount: number): Refund => ({
    method: PaymentMethod.CASH,
    amount,
  });
  const resaleable = (lineId: string, quantity = 1): ReturnLine => ({
    sale_line_id: lineId,
    quantity,
    condition: ReturnCondition.RESALEABLE,
  });

  async function stockOf(product: Product): Promise<number> {
    const row = await dataSource
      .getRepository(Stock)
      .findOneByOrFail({ product_id: product.id });
    return row.quantity;
  }
  async function unitStatus(unitId: string): Promise<ProductUnitStatus> {
    return (
      await dataSource
        .getRepository(ProductUnit)
        .findOneByOrFail({ id: unitId })
    ).status;
  }
  async function returnedQty(lineId: string): Promise<number> {
    return (
      await dataSource.getRepository(SaleLine).findOneByOrFail({ id: lineId })
    ).returned_quantity;
  }
  async function pinAttempts(userId: string): Promise<number> {
    const rows: { n: number }[] = await dataSource.query(
      `SELECT approval_pin_failed_attempts AS n FROM users WHERE id = $1`,
      [userId],
    );
    return rows[0].n;
  }
  async function countRows(sql: string, params: unknown[]): Promise<number> {
    const rows: { n: number }[] = await dataSource.query(sql, params);
    return rows[0].n;
  }
  const returnsOn = (saleId: string) =>
    countRows(
      `SELECT count(*)::int AS n FROM sale_returns WHERE sale_id = $1`,
      [saleId],
    );
  const auditRows = (action: AuditAction, entityId: string) =>
    countRows(
      `SELECT count(*)::int AS n FROM audit_logs WHERE action = $1 AND entity_id = $2`,
      [action, entityId],
    );
  async function colomboToday(): Promise<string> {
    const rows: { d: string }[] = await dataSource.query(
      `SELECT to_char((now() AT TIME ZONE 'Asia/Colombo')::date, 'YYYYMMDD') AS d`,
    );
    return rows[0].d;
  }

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
    await truncateAllTables(app);

    branchA = await dataSource
      .getRepository(Branch)
      .save({ name: 'Main Shop', is_active: true } as Branch);
    branchB = await dataSource
      .getRepository(Branch)
      .save({ name: 'Second Shop', is_active: true } as Branch);
    brand = await dataSource
      .getRepository(Brand)
      .save({ name: 'ReturnsBrand', is_active: true } as Brand);
    category = await dataSource
      .getRepository(Category)
      .save({ name: 'ReturnsCategory', is_active: true } as Category);
    customer = await dataSource.getRepository(Customer).save(
      dataSource.getRepository(Customer).create({
        name: 'Kamal Perera',
        phone: '0771234567',
        nic: '199000000001',
        notes: null,
      }),
    );
    supplier = await dataSource
      .getRepository(Supplier)
      .save({ name: 'Ranjith Mobiles', is_active: true } as Supplier);

    ({ user: admin, cookies: adminCookies } = await seedUser(
      UserRole.ADMIN,
      'admin@ret.test',
      null,
    ));
    ({ user: managerA, cookies: managerACookies } = await seedUser(
      UserRole.MANAGER,
      'manager-a@ret.test',
      branchA,
    ));
    ({ user: managerB, cookies: managerBCookies } = await seedUser(
      UserRole.MANAGER,
      'manager-b@ret.test',
      branchB,
    ));
    ({ user: cashierA, cookies: cashierACookies } = await seedUser(
      UserRole.CASHIER,
      'cashier-a@ret.test',
      branchA,
    ));
    ({ cookies: cashierA2Cookies } = await seedUser(
      UserRole.CASHIER,
      'cashier-a2@ret.test',
      branchA,
    ));
    ({ cookies: cashierBCookies } = await seedUser(
      UserRole.CASHIER,
      'cashier-b@ret.test',
      branchB,
    ));
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  // ---- Partial returns and the refund math (P7-2, P7-3) ----

  describe('partial returns and refund shares', () => {
    it('a partial return of a discounted line, refunded in cash and back to the card (201)', async () => {
      const charger = await seedProduct('Charger');
      const sale = await sell(
        [
          {
            product: charger,
            quantity: 3,
            discount: { type: DiscountType.AMOUNT, value: 100 },
          },
        ],
        {
          payments: [
            { method: PaymentMethod.CARD, amount: 1000, reference: 'AUTH-77' },
            { method: PaymentMethod.CASH, amount: 1900 },
          ],
        },
      );
      const line = sale.lines[0];
      const card = sale.payments.find((p) => p.payment_method === 'CARD')!;
      expect(line.line_total).toBe('2900.00');
      expect(await stockOf(charger)).toBe(7);

      const body = returnBody(
        [resaleable(line.id)],
        [
          cash(466.67),
          {
            method: PaymentMethod.CARD,
            amount: 500,
            original_payment_id: card.id,
            reference_number: 'REV-77',
          },
        ],
      );
      const res = await postReturn(sale.id, body);

      expect(res.status).toBe(201);
      expect(res.body.return_id).toEqual(expect.any(String));
      expect(res.body.sale.lines[0].returned_quantity).toBe(1);
      expect(res.body.sale.returns).toHaveLength(1);
      const ret = res.body.sale.returns[0];
      expect(ret).toMatchObject({
        id: res.body.return_id,
        return_number: expect.stringMatching(/^RET-\d{8}-\d{4}$/),
        reason: 'Customer changed their mind',
        override_reason: null,
        out_of_warranty: false,
        refund_due: '966.67',
        refund_total: '966.67',
        client_request_id: body.client_request_id,
        approver: { id: managerA.id, full_name: managerA.full_name },
        requester: { id: cashierA.id, full_name: cashierA.full_name },
        lines: [
          {
            sale_line_id: line.id,
            quantity: 1,
            refund_share: '966.67',
            out_of_warranty: false,
            disposition: 'RESTOCKED',
            product_unit: null,
          },
        ],
        refunds: [
          {
            method: 'CASH',
            amount: '466.67',
            reference_number: null,
            original_payment_id: null,
          },
          {
            method: 'CARD',
            amount: '500.00',
            reference_number: 'REV-77',
            original_payment_id: card.id,
          },
        ],
      });
      expect(Object.keys(ret.approver).sort()).toEqual(['full_name', 'id']);
      expect(Object.keys(ret.requester).sort()).toEqual(['full_name', 'id']);
      // The sale's money and status never change (P7-1)
      expect(res.body.sale).toMatchObject({
        status: 'COMPLETED',
        total: '2900.00',
        amount_paid: '2900.00',
      });
      expect(await stockOf(charger)).toBe(8);
    });

    it('partial returns, then a second return up to the quantity; the shares add up to the line total', async () => {
      const charger = await seedProduct('Charger');
      const sale = await sell([
        {
          product: charger,
          quantity: 3,
          discount: { type: DiscountType.AMOUNT, value: 100 },
        },
      ]);
      const lineId = sale.lines[0].id;

      const first = await postReturn(
        sale.id,
        returnBody([resaleable(lineId)], [cash(966.67)]),
      );
      expect(first.status).toBe(201);
      const second = await postReturn(
        sale.id,
        returnBody([resaleable(lineId, 2)], [cash(1933.33)]),
      );
      expect(second.status).toBe(201);

      const shares = returnsOf(second).map((r) => r.refund_due);
      expect(shares).toEqual(['966.67', '1933.33']);
      expect(second.body.sale.lines[0].returned_quantity).toBe(3);
      expect(await stockOf(charger)).toBe(10);

      const third = await postReturn(
        sale.id,
        returnBody([resaleable(lineId)], []),
      );
      expect(third.status).toBe(409);
      expect(third.body).toMatchObject({
        code: 'RETURN_QTY_EXCEEDED',
        sale_line_id: lineId,
        returnable: 0,
      });
    });

    it('a PERCENT-discounted line returned one unit at a time shares exactly its total', async () => {
      const cable = await seedProduct('Cable', { price: '333.33' });
      const sale = await sell([
        {
          product: cable,
          quantity: 3,
          discount: { type: DiscountType.PERCENT, value: 10 },
        },
      ]);
      const lineId = sale.lines[0].id;
      expect(sale.lines[0].line_total).toBe('899.99');

      const dues: string[] = [];
      for (let i = 0; i < 3; i++) {
        const res = await postReturn(
          sale.id,
          returnBody([resaleable(lineId)], []),
        );
        expect(res.status).toBe(201);
        dues.push(res.body.sale.returns[i].refund_due);
      }
      expect(dues).toEqual(['300.00', '299.99', '300.00']);
      expect(dues.reduce((s, d) => s + Math.round(Number(d) * 100), 0)).toBe(
        89999,
      );
    });

    it('two parallel returns of the last unit: one 201, one 409, the unit counted once', async () => {
      const charger = await seedProduct('Charger');
      const sale = await sell([{ product: charger, quantity: 1 }]);
      const lineId = sale.lines[0].id;

      const results = await Promise.all([
        postReturn(sale.id, returnBody([resaleable(lineId)], [cash(1000)])),
        postReturn(sale.id, returnBody([resaleable(lineId)], [cash(1000)])),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const loser = results.find((r) => r.status === 409)!;
      expect(loser.body).toMatchObject({
        code: 'RETURN_QTY_EXCEEDED',
        returnable: 0,
      });
      expect(await returnedQty(lineId)).toBe(1);
      expect(await returnsOn(sale.id)).toBe(1);
      expect(await stockOf(charger)).toBe(10);
    });
  });

  // ---- Refunds (P7-3, P7-4, P7-5) ----

  describe('refunds', () => {
    it('a lowered refund is accepted and never raises the next; more than due is REFUND_TOO_HIGH with refund_due', async () => {
      const charger = await seedProduct('Charger');
      const sale = await sell([
        {
          product: charger,
          quantity: 3,
          discount: { type: DiscountType.AMOUNT, value: 100 },
        },
      ]);
      const lineId = sale.lines[0].id;

      const lowered = await postReturn(
        sale.id,
        returnBody([resaleable(lineId)], [cash(900)]),
      );
      expect(lowered.status).toBe(201);
      expect(lowered.body.sale.returns[0]).toMatchObject({
        refund_due: '966.67',
        refund_total: '900.00',
      });

      const tooHigh = await postReturn(
        sale.id,
        returnBody([resaleable(lineId)], [cash(966.67)]),
      );
      expect(tooHigh.status).toBe(400);
      expect(tooHigh.body).toMatchObject({
        code: 'REFUND_TOO_HIGH',
        refund_due: '966.66',
      });
      expect(await returnedQty(lineId)).toBe(1);

      const exact = await postReturn(
        sale.id,
        returnBody([resaleable(lineId)], [cash(966.66)]),
      );
      expect(exact.status).toBe(201);
    });

    it('refunds back to one payment are capped by what is left of it, across returns', async () => {
      const charger = await seedProduct('Charger');
      const sale = await sell([{ product: charger, quantity: 2 }], {
        payments: [
          { method: PaymentMethod.CARD, amount: 500, reference: 'AUTH-5' },
          { method: PaymentMethod.CASH, amount: 1500 },
        ],
      });
      const lineId = sale.lines[0].id;
      const card = sale.payments.find((p) => p.payment_method === 'CARD')!;
      const toCard = (amount: number): Refund => ({
        method: PaymentMethod.CARD,
        amount,
        original_payment_id: card.id,
        reference_number: 'REV-5',
      });

      const first = await postReturn(
        sale.id,
        returnBody([resaleable(lineId)], [toCard(500), cash(500)]),
      );
      expect(first.status).toBe(201);

      const over = await postReturn(
        sale.id,
        returnBody([resaleable(lineId)], [toCard(0.01), cash(999.99)]),
      );
      expect(over.status).toBe(409);
      expect(over.body).toMatchObject({
        code: 'REFUND_EXCEEDS_PAYMENT',
        payment_id: card.id,
        refundable: '0.00',
      });

      const inCash = await postReturn(
        sale.id,
        returnBody([resaleable(lineId)], [cash(1000)]),
      );
      expect(inCash.status).toBe(201);
    });

    it('all the refunds on a sale add up to at most its total', async () => {
      const a = await seedProduct('Case', { price: '333.33' });
      const b = await seedProduct('Screen guard', { price: '0.01' });
      const sale = await sell([
        { product: a, quantity: 3 },
        { product: b, quantity: 1 },
      ]);
      const [lineA, lineB] = sale.lines.map((l: { id: string }) => l.id);

      const one = await postReturn(
        sale.id,
        returnBody([resaleable(lineA, 2), resaleable(lineB)], [cash(666.67)]),
      );
      expect(one.status).toBe(201);
      expect(one.body.sale.returns[0].refund_due).toBe('666.67');
      const two = await postReturn(
        sale.id,
        returnBody([resaleable(lineA)], [cash(333.33)]),
      );
      expect(two.status).toBe(201);

      const refunded = await countRows(
        `SELECT round(SUM(refund_total) * 100)::int AS n FROM sale_returns WHERE sale_id = $1`,
        [sale.id],
      );
      expect(refunded).toBe(Math.round(Number(sale.total) * 100));
      expect(sale.total).toBe('1000.00');
    });

    it('REFUND_METHOD_NOT_ALLOWED: TRADE_IN, another sale payment, a different method', async () => {
      const charger = await seedProduct('Charger');
      const sale = await sell([{ product: charger, quantity: 1 }], {
        payments: [
          { method: PaymentMethod.CARD, amount: 1000, reference: 'AUTH-9' },
        ],
      });
      const other = await sell([{ product: charger, quantity: 1 }], {
        payments: [
          { method: PaymentMethod.CARD, amount: 1000, reference: 'AUTH-10' },
        ],
      });
      const lineId = sale.lines[0].id;
      const cardId = sale.payments[0].id;
      const cases: Refund[] = [
        {
          method: PaymentMethod.TRADE_IN,
          amount: 10,
          original_payment_id: cardId,
          reference_number: 'X',
        },
        {
          method: PaymentMethod.CARD,
          amount: 10,
          original_payment_id: other.payments[0].id,
          reference_number: 'X',
        },
        {
          method: PaymentMethod.KOKO,
          amount: 10,
          original_payment_id: cardId,
          reference_number: 'X',
        },
      ];
      for (const refund of cases) {
        const res = await postReturn(
          sale.id,
          returnBody([resaleable(lineId)], [refund]),
        );
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({
          code: 'REFUND_METHOD_NOT_ALLOWED',
          method: refund.method,
          original_payment_id: refund.original_payment_id,
        });
      }
      expect(await returnsOn(sale.id)).toBe(0);
    });

    it('a trade-in sale: the trade-in share goes back as cash, the trade-in phone stays with the shop', async () => {
      const phone = await seedProduct('New phone', { price: '50000.00' });
      const usedModel = await seedProduct('Used phone model', {
        serialized: true,
      });
      const tradeInImei = nextImei();
      const sale = await sell([{ product: phone, quantity: 1 }], {
        withCustomer: true,
        payments: [
          {
            method: PaymentMethod.TRADE_IN,
            amount: 30000,
            tradeIn: { product: usedModel, imei: tradeInImei },
          },
          { method: PaymentMethod.CASH, amount: 20000 },
        ],
      });

      const res = await postReturn(
        sale.id,
        returnBody([resaleable(sale.lines[0].id)], [cash(50000)]),
      );

      expect(res.status).toBe(201);
      expect(res.body.sale.returns[0].refund_total).toBe('50000.00');
      const tradeInUnit = await dataSource
        .getRepository(ProductUnit)
        .findOneByOrFail({ imei: tradeInImei });
      expect(tradeInUnit.status).toBe(ProductUnitStatus.IN_STOCK);
      expect(await stockOf(usedModel)).toBe(1);
      const audit = await dataSource.getRepository(AuditLog).findOneByOrFail({
        action: AuditAction.RETURN,
        entity_id: sale.id,
      });
      expect(audit.description).toContain(
        'includes LKR 30000.00 from a trade-in',
      );
    });

    it('a later return after the non-trade-in money is used up: its trade-in share is never more than its refund', async () => {
      const phone = await seedProduct('New phone', { price: '48400.00' });
      const kase = await seedProduct('Case', { price: '1600.00' });
      const usedModel = await seedProduct('Used phone model', {
        serialized: true,
      });
      const sale = await sell(
        [
          { product: phone, quantity: 1 },
          { product: kase, quantity: 1 },
        ],
        {
          withCustomer: true,
          payments: [
            {
              method: PaymentMethod.TRADE_IN,
              amount: 30000,
              tradeIn: { product: usedModel, imei: nextImei() },
            },
            { method: PaymentMethod.CASH, amount: 20000 },
          ],
        },
      );

      // First return: 48,400 in cash, 28,400 of it trade-in money.
      const first = await postReturn(
        sale.id,
        returnBody([resaleable(sale.lines[0].id)], [cash(48400)]),
      );
      expect(first.status).toBe(201);
      // Second: 1,600 in cash. The 20,000 non-trade-in money is used up,
      // so all of it is trade-in money: 1,600, not 1,600 − (20,000 − 48,400).
      const second = await postReturn(
        sale.id,
        returnBody([resaleable(sale.lines[1].id)], [cash(1600)]),
      );
      expect(second.status).toBe(201);

      const audits = await dataSource.getRepository(AuditLog).find({
        where: { action: AuditAction.RETURN, entity_id: sale.id },
        order: { created_at: 'ASC' },
      });
      expect(audits).toHaveLength(2);
      expect(audits[0].description).toContain(
        'includes LKR 28400.00 from a trade-in',
      );
      expect(audits[1].description).toContain(
        'includes LKR 1600.00 from a trade-in',
      );
      expect(audits[1].description).not.toContain('30000.00 from a trade-in');
    });
  });

  // ---- Where the items go (P7-6, P7-8) ----

  describe('dispositions', () => {
    it("another shop's line is refunded and never touches our stock (NOT_OUR_STOCK, no condition)", async () => {
      const charger = await seedProduct('Charger');
      const sale = await sell([{ product: charger, quantity: 2, supplier }]);
      const lineId = sale.lines[0].id;
      expect(await stockOf(charger)).toBe(10);

      const withCondition = await postReturn(
        sale.id,
        returnBody([resaleable(lineId)], [cash(1000)]),
      );
      expect(withCondition.status).toBe(400);
      expect(withCondition.body.code).toBe('RETURN_CONDITION_INVALID');

      const res = await postReturn(
        sale.id,
        returnBody([{ sale_line_id: lineId, quantity: 1 }], [cash(1000)]),
      );
      expect(res.status).toBe(201);
      expect(res.body.sale.returns[0].lines[0].disposition).toBe(
        'NOT_OUR_STOCK',
      );
      expect(await stockOf(charger)).toBe(10);
    });

    it('Back to stock adds the quantity, Damaged and an untracked product do not', async () => {
      const charger = await seedProduct('Charger');
      const cover = await seedProduct('Cover');
      const service = await seedProduct('Screen fitting', {
        manageStock: false,
        stock: 0,
      });
      const sale = await sell([
        { product: charger, quantity: 2 },
        { product: cover, quantity: 2 },
        { product: service, quantity: 1 },
      ]);
      const [chargerLine, coverLine, serviceLine] = sale.lines.map(
        (l: { id: string }) => l.id,
      );
      expect(await stockOf(charger)).toBe(8);
      expect(await stockOf(cover)).toBe(8);

      const res = await postReturn(
        sale.id,
        returnBody(
          [
            resaleable(chargerLine, 2),
            {
              sale_line_id: coverLine,
              quantity: 2,
              condition: ReturnCondition.DAMAGED,
            },
            { sale_line_id: serviceLine, quantity: 1 },
          ],
          [],
        ),
      );

      expect(res.status).toBe(201);
      expect(returnsOf(res)[0].lines.map((l) => l.disposition)).toEqual([
        'RESTOCKED',
        'DAMAGED',
        'UNTRACKED',
      ]);
      expect(await stockOf(charger)).toBe(10);
      expect(await stockOf(cover)).toBe(8);
      expect(await stockOf(service)).toBe(0);
    });

    it('RETURN_CONDITION_INVALID: missing on a tracked stock line, sent for a phone or an untracked product', async () => {
      const charger = await seedProduct('Charger');
      const service = await seedProduct('Screen fitting', {
        manageStock: false,
        stock: 0,
      });
      const model = await seedProduct('Used phone', { serialized: true });
      const unit = await seedPhone(model);
      const sale = await sell([
        { product: charger, quantity: 1 },
        { product: service, quantity: 1 },
        { product: model, imei: unit.imei },
      ]);
      const [chargerLine, serviceLine, phoneLine] = sale.lines.map(
        (l: { id: string }) => l.id,
      );

      for (const line of [
        { sale_line_id: chargerLine, quantity: 1 },
        resaleable(serviceLine),
        {
          sale_line_id: phoneLine,
          quantity: 1,
          condition: ReturnCondition.DAMAGED,
        },
      ]) {
        const res = await postReturn(sale.id, returnBody([line], []));
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({
          code: 'RETURN_CONDITION_INVALID',
          sale_line_id: line.sale_line_id,
        });
      }
      expect(await returnsOn(sale.id)).toBe(0);
    });

    it('a returned phone goes to INSPECTION with no stock change, is listed, and passes back to stock', async () => {
      const model = await seedProduct('Used iPhone', { serialized: true });
      const unit = await seedPhone(model);
      const sale = await sell([{ product: model, imei: unit.imei }]);
      expect(await stockOf(model)).toBe(0);

      const res = await postReturn(
        sale.id,
        returnBody(
          [{ sale_line_id: sale.lines[0].id, quantity: 1 }],
          [cash(1000)],
        ),
      );
      expect(res.status).toBe(201);
      expect(res.body.sale.returns[0].lines[0]).toMatchObject({
        disposition: 'INSPECTION',
        product_unit: { id: unit.id, imei: unit.imei },
      });
      expect(await unitStatus(unit.id)).toBe(ProductUnitStatus.INSPECTION);
      expect(await stockOf(model)).toBe(0);

      const list = await call(
        'get',
        '/sale-returns/inspection',
        managerACookies,
        undefined,
        { branchId: branchA.id },
      );
      expect(list.status).toBe(200);
      expect(
        inspectionOf(list).filter((r) => r.product_unit.id === unit.id),
      ).toEqual([
        {
          product_unit: {
            id: unit.id,
            imei: unit.imei,
            product_name: model.name,
          },
          return_id: res.body.return_id,
          return_number: res.body.sale.returns[0].return_number,
          sale_id: sale.id,
          sale_number: sale.sale_number,
          returned_at: res.body.sale.returns[0].created_at,
        },
      ]);

      const pass = await call(
        'post',
        `/product-units/${unit.id}/inspection-pass`,
        managerACookies,
      );
      expect(pass.status).toBe(200);
      expect(await unitStatus(unit.id)).toBe(ProductUnitStatus.IN_STOCK);
      expect(await stockOf(model)).toBe(1);
    });

    it("a phone's second life: returned, passed, sold again and returned again", async () => {
      const model = await seedProduct('Used Galaxy', { serialized: true });
      const unit = await seedPhone(model);
      expect(await stockOf(model)).toBe(1);

      const saleA = await sell([{ product: model, imei: unit.imei }]);
      expect(await stockOf(model)).toBe(0);
      const phoneLine = (id: string) => ({ sale_line_id: id, quantity: 1 });

      const onA = await postReturn(
        saleA.id,
        returnBody([phoneLine(saleA.lines[0].id)], [cash(1000)]),
      );
      expect(onA.status).toBe(201);
      expect(await unitStatus(unit.id)).toBe(ProductUnitStatus.INSPECTION);
      expect(await stockOf(model)).toBe(0);

      const pass = await call(
        'post',
        `/product-units/${unit.id}/inspection-pass`,
        managerACookies,
      );
      expect(pass.status).toBe(200);
      expect(await unitStatus(unit.id)).toBe(ProductUnitStatus.IN_STOCK);
      expect(await stockOf(model)).toBe(1);

      const saleB = await sell([{ product: model, imei: unit.imei }]);
      expect(saleB.lines[0].product_unit_id).toBe(unit.id);
      expect(await unitStatus(unit.id)).toBe(ProductUnitStatus.SOLD);
      expect(await stockOf(model)).toBe(0);

      const onB = await postReturn(
        saleB.id,
        returnBody([phoneLine(saleB.lines[0].id)], [cash(1000)]),
      );
      expect(onB.status).toBe(201);
      expect(await unitStatus(unit.id)).toBe(ProductUnitStatus.INSPECTION);
      expect(await stockOf(model)).toBe(0);

      const list = await call(
        'get',
        '/sale-returns/inspection',
        managerACookies,
        undefined,
        { branchId: branchA.id },
      );
      const rows = inspectionOf(list).filter(
        (r) => r.product_unit.id === unit.id,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        return_id: onB.body.return_id,
        sale_id: saleB.id,
        sale_number: saleB.sale_number,
      });

      const againOnA = await postReturn(
        saleA.id,
        returnBody([phoneLine(saleA.lines[0].id)], []),
      );
      expect(againOnA.status).toBe(409);
      expect(againOnA.body).toMatchObject({
        code: 'RETURN_QTY_EXCEEDED',
        sale_line_id: saleA.lines[0].id,
        returnable: 0,
      });
      expect(await unitStatus(unit.id)).toBe(ProductUnitStatus.INSPECTION);
      expect(await stockOf(model)).toBe(0);
    });

    it('a phone bought back on a later purchase cannot be returned (PHONE_TAKEN_BACK, BOUGHT_BACK_ON_PURCHASE)', async () => {
      const model = await seedProduct('Used Pixel', { serialized: true });
      const unit = await seedPhone(model);
      const sale = await sell([{ product: model, imei: unit.imei }]);

      const purchase = await call('post', '/phone-purchases', cashierACookies, {
        customer_id: customer.id,
        branch_id: branchA.id,
        product_id: model.id,
        imei: unit.imei,
        buying_price: 500,
      });
      expect(purchase.status).toBe(201);
      const attemptsBefore = await pinAttempts(managerA.id);

      const res = await postReturn(
        sale.id,
        returnBody([{ sale_line_id: sale.lines[0].id, quantity: 1 }], [], {
          approval: approvalFor(managerA.id, WRONG_PIN),
        }),
      );

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: 'PHONE_TAKEN_BACK',
        imei: unit.imei,
        reason: 'BOUGHT_BACK_ON_PURCHASE',
        later_sale: null,
      });
      expect(await unitStatus(unit.id)).toBe(ProductUnitStatus.SOLD);
      expect(await pinAttempts(managerA.id)).toBe(attemptsBefore);
    });

    it('a phone traded back in on a later sale cannot be returned (PHONE_TAKEN_BACK, TAKEN_BACK_ON_SALE)', async () => {
      const model = await seedProduct('Used Nokia', { serialized: true });
      const charger = await seedProduct('Charger', { price: '1500.00' });
      const unit = await seedPhone(model);
      const sale = await sell([{ product: model, imei: unit.imei }]);
      const later = await sell([{ product: charger, quantity: 1 }], {
        withCustomer: true,
        payments: [
          {
            method: PaymentMethod.TRADE_IN,
            amount: 700,
            tradeIn: { product: model, imei: unit.imei },
          },
          { method: PaymentMethod.CASH, amount: 800 },
        ],
      });

      const res = await postReturn(
        sale.id,
        returnBody([{ sale_line_id: sale.lines[0].id, quantity: 1 }], []),
      );

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: 'PHONE_TAKEN_BACK',
        imei: unit.imei,
        reason: 'TAKEN_BACK_ON_SALE',
        later_sale: { id: later.id, sale_number: later.sale_number },
      });
    });
  });

  // ---- Warranty (P7-22, P7-23) ----

  describe('warranty', () => {
    it('OVERRIDE_REASON_REQUIRED for an expired line, Checking only and No warranty; within warranty needs none', async () => {
      const p = await seedProduct('Earbuds');
      const sale = await sell([
        { product: p, quantity: 1, warranty: WarrantyPeriod.MONTH_12 },
        { product: p, quantity: 1, warranty: WarrantyPeriod.MONTH_12 },
        { product: p, quantity: 1, warranty: WarrantyPeriod.CHECKING },
        { product: p, quantity: 1, warranty: WarrantyPeriod.NO_WARRANTY },
      ]);
      const [within, expired, checking, none] = sale.lines.map(
        (l: { id: string }) => l.id,
      );
      await dataSource.query(
        `UPDATE sale_lines
            SET warranty_until = (now() AT TIME ZONE 'Asia/Colombo')::date - 1
          WHERE id = $1`,
        [expired],
      );

      const outside = await postReturn(
        sale.id,
        returnBody(
          [within, expired, checking, none].map((id) => resaleable(id)),
          [],
        ),
      );
      expect(outside.status).toBe(400);
      expect(outside.body.code).toBe('OVERRIDE_REASON_REQUIRED');
      expect([...outside.body.sale_line_ids].sort()).toEqual(
        [expired, checking, none].sort(),
      );

      const inside = await postReturn(
        sale.id,
        returnBody([resaleable(within)], [], {
          override_reason: 'Not needed here',
        }),
      );
      expect(inside.status).toBe(201);
      expect(inside.body.sale.returns[0]).toMatchObject({
        out_of_warranty: false,
        override_reason: null,
      });
    });

    it('an accepted override is recorded on the return, its lines and the RETURN audit row', async () => {
      const p = await seedProduct('Earbuds');
      const sale = await sell([
        { product: p, quantity: 1, warranty: WarrantyPeriod.MONTH_12 },
        { product: p, quantity: 1, warranty: WarrantyPeriod.CHECKING },
      ]);
      const [within, checking] = sale.lines.map((l: { id: string }) => l.id);

      const res = await postReturn(
        sale.id,
        returnBody([resaleable(within), resaleable(checking)], [cash(500)], {
          override_reason: 'Regular customer, manager agreed',
        }),
      );

      expect(res.status).toBe(201);
      const ret = returnsOf(res)[0];
      expect(ret).toMatchObject({
        out_of_warranty: true,
        override_reason: 'Regular customer, manager agreed',
      });
      expect(ret.lines.map((l) => [l.sale_line_id, l.out_of_warranty])).toEqual(
        [
          [within, false],
          [checking, true],
        ],
      );
      const audit = await dataSource.getRepository(AuditLog).findOneByOrFail({
        action: AuditAction.RETURN,
        entity_id: sale.id,
      });
      expect(audit.description).toContain(
        'Outside warranty: Regular customer, manager agreed',
      );
      expect(audit.changes).toMatchObject({
        out_of_warranty: { old: null, new: true },
      });
    });
  });

  // ---- Approval and the PIN (P7-9) ----

  describe('approval', () => {
    it('a return that cannot go through spends no PIN attempt', async () => {
      const charger = await seedProduct('Charger');
      const sale = await sell([{ product: charger, quantity: 1 }]);
      const lineId = sale.lines[0].id;
      const voided = await sell([{ product: charger, quantity: 1 }]);
      await call('post', `/sales/${voided.id}/void`, cashierACookies, {
        void_reason: 'Wrong item rung up',
        approval: approvalFor(managerA.id),
      }).then((r) => expect(r.status).toBe(200));
      const wrong = { approval: approvalFor(managerA.id, WRONG_PIN) };
      const failedBefore = await countRows(
        `SELECT count(*)::int AS n FROM audit_logs WHERE action = $1 AND entity_id = $2`,
        [AuditAction.APPROVAL_PIN_FAILED, managerA.id],
      );
      expect(await pinAttempts(managerA.id)).toBe(0);

      const refusals: [string, Response][] = [
        [
          'SALE_NOT_COMPLETED',
          await postReturn(
            voided.id,
            returnBody([resaleable(voided.lines[0].id)], [], wrong),
          ),
        ],
        [
          'RETURN_WRONG_BRANCH',
          await postReturn(
            sale.id,
            returnBody([resaleable(lineId)], [], wrong),
            cashierBCookies,
          ),
        ],
        [
          'LINE_NOT_ON_SALE',
          await postReturn(
            sale.id,
            returnBody([resaleable(voided.lines[0].id)], [], wrong),
          ),
        ],
        [
          'RETURN_QTY_EXCEEDED',
          await postReturn(
            sale.id,
            returnBody([resaleable(lineId, 2)], [], wrong),
          ),
        ],
        [
          'REFUND_TOO_HIGH',
          await postReturn(
            sale.id,
            returnBody([resaleable(lineId)], [cash(1000.01)], wrong),
          ),
        ],
      ];
      for (const [code, res] of refusals) {
        expect([code, res.body.code]).toEqual([code, code]);
      }
      const malformed = await postReturn(sale.id, returnBody([], [], wrong));
      expect(malformed.status).toBe(400);

      expect(await pinAttempts(managerA.id)).toBe(0);
      expect(
        await countRows(
          `SELECT count(*)::int AS n FROM audit_logs WHERE action = $1 AND entity_id = $2`,
          [AuditAction.APPROVAL_PIN_FAILED, managerA.id],
        ),
      ).toBe(failedBefore);

      // A return that can go through, with the wrong PIN: one attempt,
      // nothing recorded.
      const wrongPin = await postReturn(
        sale.id,
        returnBody([resaleable(lineId)], [], wrong),
      );
      expect(wrongPin.status).toBe(403);
      expect(wrongPin.body).toMatchObject({
        code: 'WRONG_PIN',
        attempts_left: 4,
      });
      expect(await pinAttempts(managerA.id)).toBe(1);
      expect(await returnsOn(sale.id)).toBe(0);
      expect(await returnedQty(lineId)).toBe(0);
      // 10, less the sale, less the voided sale, plus its void.
      expect(await stockOf(charger)).toBe(9);

      await dataSource.query(
        `UPDATE users SET approval_pin_failed_attempts = 0 WHERE id = $1`,
        [managerA.id],
      );
    });

    it('R1: malformed bodies are 400 (no lines, a line twice, CASH with a reference, card without one, no approval)', async () => {
      const charger = await seedProduct('Charger');
      const sale = await sell([{ product: charger, quantity: 2 }], {
        payments: [
          { method: PaymentMethod.CARD, amount: 2000, reference: 'AUTH-3' },
        ],
      });
      const lineId = sale.lines[0].id;
      const cardId = sale.payments[0].id;
      const bodies = [
        returnBody([], []),
        returnBody([resaleable(lineId), resaleable(lineId)], []),
        returnBody(
          [resaleable(lineId)],
          [{ method: PaymentMethod.CASH, amount: 10, reference_number: 'R' }],
        ),
        returnBody(
          [resaleable(lineId)],
          [
            {
              method: PaymentMethod.CARD,
              amount: 10,
              original_payment_id: cardId,
            },
          ],
        ),
        { ...returnBody([resaleable(lineId)], []), approval: undefined },
        returnBody([resaleable(lineId)], [], { reason: '  ' }),
      ];
      for (const body of bodies) {
        const res = await postReturn(sale.id, body);
        expect(res.status).toBe(400);
      }
      expect(await returnsOn(sale.id)).toBe(0);
    });

    it('a manager approves a return on their own session; the RETURN audit row names both, never the PIN', async () => {
      const charger = await seedProduct('Charger');
      const sale = await sell([{ product: charger, quantity: 1 }], {
        cookies: managerACookies,
      });

      const res = await postReturn(
        sale.id,
        returnBody([resaleable(sale.lines[0].id)], [cash(1000)]),
        managerACookies,
      );

      expect(res.status).toBe(201);
      expect(res.body.sale.returns[0]).toMatchObject({
        approver: { id: managerA.id },
        requester: { id: managerA.id },
      });
      const audit = await dataSource.getRepository(AuditLog).findOneByOrFail({
        action: AuditAction.RETURN,
        entity_id: sale.id,
      });
      expect(audit).toMatchObject({
        user_id: managerA.id,
        entity_type: 'Sale',
        changes: {
          approved_by: { old: null, new: managerA.id },
          requested_by: { old: null, new: managerA.id },
          refund_due: { old: null, new: '1000.00' },
          refund_total: { old: null, new: '1000.00' },
          out_of_warranty: { old: null, new: false },
        },
      });
      expect(audit.description).toContain(
        `approved by ${managerA.full_name} (${managerA.id})`,
      );
      expect(JSON.stringify(audit)).not.toContain('482916');
    });

    it('RETURN_WRONG_BRANCH for a cashier of another branch; an admin may return anywhere', async () => {
      const charger = await seedProduct('Charger', { branch: branchB });
      const sale = await sell([{ product: charger, quantity: 2 }], {
        branch: branchB,
        cookies: cashierBCookies,
      });
      const lineId = sale.lines[0].id;

      const wrong = await postReturn(
        sale.id,
        returnBody([resaleable(lineId)], [], {
          approval: approvalFor(managerB.id),
        }),
        cashierACookies,
      );
      expect(wrong.status).toBe(403);
      expect(wrong.body.code).toBe('RETURN_WRONG_BRANCH');

      const byAdmin = await postReturn(
        sale.id,
        returnBody([resaleable(lineId)], [], {
          approval: approvalFor(managerB.id),
        }),
        adminCookies,
      );
      expect(byAdmin.status).toBe(201);
    });

    it('SALE_NOT_COMPLETED on a draft', async () => {
      const draft = await call('post', '/sales', cashierACookies, {
        branch_id: branchA.id,
      });
      const res = await postReturn(
        draft.body.id,
        returnBody([{ sale_line_id: randomUUID(), quantity: 1 }], []),
      );
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('SALE_NOT_COMPLETED');
    });
  });

  // ---- client_request_id (P7-15, P7-24) ----

  describe('client_request_id', () => {
    it('a resend from the same sale and user returns the recorded return (200), with no PIN check and one audit row', async () => {
      const charger = await seedProduct('Charger');
      const sale = await sell([{ product: charger, quantity: 3 }]);
      const lineId = sale.lines[0].id;
      const body = returnBody([resaleable(lineId)], [cash(1000)]);

      const first = await postReturn(sale.id, body);
      expect(first.status).toBe(201);

      // Another body, and a wrong PIN: ignored.
      const resend = await postReturn(sale.id, {
        ...returnBody([resaleable(lineId, 2)], [cash(2000)]),
        client_request_id: body.client_request_id,
        approval: approvalFor(managerA.id, WRONG_PIN),
      });

      expect(resend.status).toBe(200);
      expect(resend.body.return_id).toBe(first.body.return_id);
      expect(resend.body.sale.returns).toHaveLength(1);
      expect(await pinAttempts(managerA.id)).toBe(0);
      expect(await returnsOn(sale.id)).toBe(1);
      expect(await returnedQty(lineId)).toBe(1);
      expect(await auditRows(AuditAction.RETURN, sale.id)).toBe(1);
      expect(await stockOf(charger)).toBe(8);
    });

    it('the same id from another sale is 409 CLIENT_REQUEST_ID_CONFLICT, revealing nothing', async () => {
      const charger = await seedProduct('Charger');
      const one = await sell([{ product: charger, quantity: 1 }]);
      const two = await sell([{ product: charger, quantity: 1 }]);
      const body = returnBody([resaleable(one.lines[0].id)], []);
      expect((await postReturn(one.id, body)).status).toBe(201);

      const res = await postReturn(two.id, {
        ...returnBody([resaleable(two.lines[0].id)], []),
        client_request_id: body.client_request_id,
      });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        message: expect.any(String),
        code: 'CLIENT_REQUEST_ID_CONFLICT',
      });
      expect(await returnsOn(two.id)).toBe(0);
    });

    it('the same id from another user on the same sale is 409 CLIENT_REQUEST_ID_CONFLICT', async () => {
      const charger = await seedProduct('Charger');
      const sale = await sell([{ product: charger, quantity: 2 }]);
      const body = returnBody([resaleable(sale.lines[0].id)], []);
      expect((await postReturn(sale.id, body)).status).toBe(201);

      const res = await postReturn(sale.id, body, cashierA2Cookies);

      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        message: expect.any(String),
        code: 'CLIENT_REQUEST_ID_CONFLICT',
      });
      expect(await returnsOn(sale.id)).toBe(1);
    });

    it('a simultaneous double send: one 201, one 200, one return', async () => {
      const charger = await seedProduct('Charger');
      const sale = await sell([{ product: charger, quantity: 3 }]);
      const body = returnBody([resaleable(sale.lines[0].id)], [cash(1000)]);

      const results = await Promise.all([
        postReturn(sale.id, body),
        postReturn(sale.id, body),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
      expect(results[0].body.return_id).toBe(results[1].body.return_id);
      expect(await returnsOn(sale.id)).toBe(1);
      expect(await returnedQty(sale.lines[0].id)).toBe(1);
      expect(await auditRows(AuditAction.RETURN, sale.id)).toBe(1);
      expect(await stockOf(charger)).toBe(8);
    });
  });

  // ---- Void after a return (P7-11) ----

  describe('void', () => {
    it('a sale with a return cannot be voided (409 SALE_HAS_RETURNS), before the PIN', async () => {
      const charger = await seedProduct('Charger');
      const sale = await sell([{ product: charger, quantity: 2 }]);
      expect(
        (
          await postReturn(
            sale.id,
            returnBody([resaleable(sale.lines[0].id)], []),
          )
        ).status,
      ).toBe(201);

      const res = await call(
        'post',
        `/sales/${sale.id}/void`,
        cashierACookies,
        {
          void_reason: 'Wrong item rung up',
          approval: approvalFor(managerA.id, WRONG_PIN),
        },
      );

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'SALE_HAS_RETURNS' });
      expect(await pinAttempts(managerA.id)).toBe(0);
      const after = await call('get', `/sales/${sale.id}`, cashierACookies);
      expect(after.body.status).toBe('COMPLETED');
      expect(await stockOf(charger)).toBe(9);
    });
  });

  // ---- Numbering (P7-10) ----

  describe('RET- numbering', () => {
    it('RET- numbers count per branch and Colombo day, apart from INV- numbers', async () => {
      const branchC = await dataSource
        .getRepository(Branch)
        .save({ name: 'Third Shop', is_active: true } as Branch);
      const branchD = await dataSource
        .getRepository(Branch)
        .save({ name: 'Fourth Shop', is_active: true } as Branch);
      const day = await colomboToday();
      // Yesterday's counter for branch C must stay as it is.
      await dataSource.query(
        `INSERT INTO sale_number_counters (branch_id, kind, counter_date, last_number)
         VALUES ($1, 'RETURN', (now() AT TIME ZONE 'Asia/Colombo')::date - 1, 41)`,
        [branchC.id],
      );
      const pc = await seedProduct('Charger', { branch: branchC });
      const pd = await seedProduct('Charger', { branch: branchD });
      const byAdmin = { cookies: adminCookies };
      const saleC = await sell([{ product: pc, quantity: 3 }], {
        ...byAdmin,
        branch: branchC,
      });
      const saleD = await sell([{ product: pd, quantity: 1 }], {
        ...byAdmin,
        branch: branchD,
      });
      const adminApproval = { approval: approvalFor(admin.id) };

      const numbers: string[] = [];
      for (const [saleId, lineId] of [
        [saleC.id, saleC.lines[0].id],
        [saleC.id, saleC.lines[0].id],
        [saleD.id, saleD.lines[0].id],
      ]) {
        const res = await postReturn(
          saleId,
          returnBody([resaleable(lineId)], [], adminApproval),
          adminCookies,
        );
        expect(res.status).toBe(201);
        numbers.push(
          returnsOf(res).find((r) => r.id === res.body.return_id)!
            .return_number,
        );
      }
      expect(numbers).toEqual([
        `RET-${day}-0001`,
        `RET-${day}-0002`,
        `RET-${day}-0001`,
      ]);

      // Invoice numbers keep their own count.
      expect(saleC.sale_number).toBe(`INV-${day}-0001`);
      const nextSale = await sell([{ product: pc, quantity: 1 }], {
        ...byAdmin,
        branch: branchC,
      });
      expect(nextSale.sale_number).toBe(`INV-${day}-0002`);

      const counters: { kind: string; last_number: number; today: boolean }[] =
        await dataSource.query(
          `SELECT kind, last_number,
                  counter_date = (now() AT TIME ZONE 'Asia/Colombo')::date AS today
             FROM sale_number_counters WHERE branch_id = $1
            ORDER BY kind, counter_date`,
          [branchC.id],
        );
      expect(counters).toEqual([
        { kind: 'RETURN', last_number: 41, today: false },
        { kind: 'RETURN', last_number: 2, today: true },
        { kind: 'SALE', last_number: 2, today: true },
      ]);
    });
  });

  // ---- Read side (P7-18) ----

  describe('GET /sales', () => {
    it('return_state NONE / PARTIAL / FULL, refunded_total, and q finding RET- numbers', async () => {
      const charger = await seedProduct('Charger');
      const none = await sell([{ product: charger, quantity: 2 }]);
      const partial = await sell([{ product: charger, quantity: 2 }]);
      const full = await sell([{ product: charger, quantity: 2 }]);
      await postReturn(
        partial.id,
        returnBody([resaleable(partial.lines[0].id)], [cash(400)]),
      ).then((r) => expect(r.status).toBe(201));
      const fullReturn = await postReturn(
        full.id,
        returnBody([resaleable(full.lines[0].id, 2)], [cash(2000)]),
      );
      expect(fullReturn.status).toBe(201);

      const list = await call('get', '/sales', cashierACookies, undefined, {
        branchId: branchA.id,
        limit: '200',
      });
      expect(list.status).toBe(200);
      const row = (id: string) => saleRows(list).find((s) => s.id === id);
      expect(row(none.id)).toMatchObject({
        return_state: 'NONE',
        refunded_total: '0.00',
      });
      expect(row(partial.id)).toMatchObject({
        return_state: 'PARTIAL',
        refunded_total: '400.00',
      });
      expect(row(full.id)).toMatchObject({
        return_state: 'FULL',
        refunded_total: '2000.00',
      });

      const retNumber = fullReturn.body.sale.returns[0].return_number as string;
      // RET- numbers repeat across branches, as INV- numbers do.
      const search = await call('get', '/sales', cashierACookies, undefined, {
        branchId: branchA.id,
        q: retNumber,
      });
      expect(saleRows(search).map((s) => s.id)).toEqual([full.id]);
    });
  });

  describe('GET /sale-returns/inspection', () => {
    it('admins and managers of the branch only', async () => {
      const cashierRes = await call(
        'get',
        '/sale-returns/inspection',
        cashierACookies,
        undefined,
        { branchId: branchA.id },
      );
      expect(cashierRes.status).toBe(403);

      const otherBranch = await call(
        'get',
        '/sale-returns/inspection',
        managerBCookies,
        undefined,
        { branchId: branchA.id },
      );
      expect(otherBranch.status).toBe(403);
      expect(otherBranch.body.code).toBe('INSPECTION_WRONG_BRANCH');

      const own = await call(
        'get',
        '/sale-returns/inspection',
        managerBCookies,
        undefined,
        { branchId: branchB.id },
      );
      expect(own.status).toBe(200);
      expect(Array.isArray(own.body)).toBe(true);

      const byAdmin = await call(
        'get',
        '/sale-returns/inspection',
        adminCookies,
        undefined,
        { branchId: branchA.id },
      );
      expect(byAdmin.status).toBe(200);
      // Oldest first
      const times = inspectionOf(byAdmin).map((r) => Date.parse(r.returned_at));
      expect(times).toEqual([...times].sort((a, b) => a - b));

      const missing = await call(
        'get',
        '/sale-returns/inspection',
        adminCookies,
      );
      expect(missing.status).toBe(400);
    });
  });
});
