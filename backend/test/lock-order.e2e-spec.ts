import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { DataSource, QueryRunner } from 'typeorm';
import { createTestApp, truncateAllTables } from './setup';
import { User } from '../src/users/entities/user.entity';
import { UserRole } from '../src/users/enums/user-role.enum';
import { Sale } from '../src/sales/entities/sale.entity';
import { SaleStatus } from '../src/sales/enums/sale-status.enum';
import { SaleType } from '../src/sales/enums/sale-type.enum';
import { SaleLine } from '../src/sales/entities/sale-line.entity';
import { Payment } from '../src/sales/entities/payment.entity';
import { PaymentMethod } from '../src/sales/enums/payment-method.enum';
import { Branch } from '../src/branches/entities/branch.entity';
import { Brand } from '../src/brands/entities/brand.entity';
import { Category } from '../src/categories/entities/category.entity';
import { Product } from '../src/products/entities/product.entity';
import { ProductType } from '../src/products/enums/product-type.enum';
import { WarrantyPeriod } from '../src/products/enums/warranty-period.enum';
import { Stock } from '../src/stock/entities/stock.entity';
import { Customer } from '../src/customers/entities/customer.entity';
import { ProductUnit } from '../src/product-units/entities/product-unit.entity';
import { ProductUnitStatus } from '../src/product-units/enums/product-unit-status.enum';
import { PhonePurchase } from '../src/phone-purchases/entities/phone-purchase.entity';
import { approvalFor, giveApprovalPin } from './approval-pin.helper';

type Response = request.Response;

/**
 * Global lock order (Phase 6.4 P7-25, step 0c). Completing and voiding
 * sales lock Stock rows and ProductUnit rows; when two requests take the
 * same rows in opposite orders, Postgres kills one with a deadlock
 * (40P01) and that request gets a 500.
 *
 * Random timing makes that rare, so each test forces the bad interleaving
 * with a gate: a separate connection holds one row FOR UPDATE, request A
 * is sent and parked on it, request B is sent and parked too, then the
 * gate is released. Without a global order, A and B are left holding a
 * row each and waiting for the other's; with it, B waits for A and both
 * finish.
 *
 * Drafts are seeded straight into the database (lines, payments, totals
 * as addLine/addPayment would leave them), so the throttler's per-route
 * limits never get in the way. Completes and voids go through HTTP.
 */
describe('Lock order (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await truncateAllTables(app);
  });

  afterAll(async () => {
    await app.close();
  });

  // ---- Seeding ----

  interface Ctx {
    branch: Branch;
    admin: User;
    cookies: string[];
    customer: Customer;
  }

  async function setup(): Promise<Ctx> {
    const branch = await dataSource
      .getRepository(Branch)
      .save({ name: 'Main Shop', is_active: true } as Branch);
    const password = 'testpass123';
    const admin = await dataSource.getRepository(User).save(
      dataSource.getRepository(User).create({
        email: 'a@t.com',
        password_hash: await bcrypt.hash(password, 4),
        full_name: 'Test admin',
        role: UserRole.ADMIN,
        is_active: true,
        branch_id: null,
      }),
    );
    // Every void needs an approval PIN (P6-17).
    await giveApprovalPin(dataSource, admin.id);
    const customer = await dataSource.getRepository(Customer).save(
      dataSource.getRepository(Customer).create({
        name: 'Kamal Perera',
        phone: '0771234567',
        nic: '199000000001',
        notes: null,
      }),
    );
    // Login throttle (FOLLOWUPS "Login throttle limit is not env-driven").
    await new Promise((r) => setTimeout(r, 500));
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: admin.email, password })
      .expect(200);
    const cookies = login.headers['set-cookie'] as unknown as string[];
    return { branch, admin, cookies, customer };
  }

  async function seedProduct(
    ctx: Ctx,
    name: string,
    opts: { serialized?: boolean; price?: string; stock?: number } = {},
  ): Promise<Product> {
    const brand =
      (await dataSource.getRepository(Brand).findOne({ where: {} })) ??
      (await dataSource
        .getRepository(Brand)
        .save({ name: 'TestBrand', is_active: true } as Brand));
    const category =
      (await dataSource.getRepository(Category).findOne({ where: {} })) ??
      (await dataSource
        .getRepository(Category)
        .save({ name: 'TestCategory', is_active: true } as Category));
    const suffix = Math.random().toString(36).slice(2, 8);
    const product = await dataSource.getRepository(Product).save(
      dataSource.getRepository(Product).create({
        product_type: ProductType.PHONE,
        name,
        sku: `SKU-LOCK-${suffix}`,
        barcode: `BC-LOCK-${suffix}`,
        brand_id: brand.id,
        category_id: category.id,
        branch_id: ctx.branch.id,
        buying_price: '500.00',
        selling_price: opts.price ?? '1000.00',
        is_active: true,
        is_serialized: opts.serialized ?? false,
        default_warranty: WarrantyPeriod.NO_WARRANTY,
      }),
    );
    await dataSource.getRepository(Stock).save(
      dataSource.getRepository(Stock).create({
        product_id: product.id,
        branch_id: ctx.branch.id,
        quantity: opts.stock ?? 0,
        min_quantity: 0,
        manage_stock: true,
      }),
    );
    return product;
  }

  async function seedUnit(
    ctx: Ctx,
    product: Product,
    imei: string,
  ): Promise<ProductUnit> {
    const purchase = await dataSource.getRepository(PhonePurchase).save(
      dataSource.getRepository(PhonePurchase).create({
        customer_id: ctx.customer.id,
        branch_id: ctx.branch.id,
        cashier_id: ctx.admin.id,
        total_amount: '500.00',
        notes: null,
      }),
    );
    return dataSource.getRepository(ProductUnit).save(
      dataSource.getRepository(ProductUnit).create({
        product_id: product.id,
        branch_id: ctx.branch.id,
        imei,
        status: ProductUnitStatus.IN_STOCK,
        buying_price: '500.00',
        selling_price: null,
        phone_purchase_id: purchase.id,
      }),
    );
  }

  interface DraftLine {
    product: Product;
    quantity?: number;
    unit?: ProductUnit;
  }

  interface DraftTradeIn {
    product: Product;
    imei: string;
    value: number;
  }

  /**
   * A fully paid DRAFT, lines numbered in the order given. Paid with an
   * optional trade-in and cash for the rest.
   */
  async function seedDraft(
    ctx: Ctx,
    lines: DraftLine[],
    tradeIn?: DraftTradeIn,
  ): Promise<Sale> {
    const totalCents = lines.reduce(
      (sum, l) =>
        sum +
        Math.round(Number(l.product.selling_price) * 100) * (l.quantity ?? 1),
      0,
    );
    const total = (totalCents / 100).toFixed(2);
    const sale = await dataSource.getRepository(Sale).save(
      dataSource.getRepository(Sale).create({
        sale_type: SaleType.RETAIL,
        status: SaleStatus.DRAFT,
        branch_id: ctx.branch.id,
        cashier_id: ctx.admin.id,
        customer_id: tradeIn ? ctx.customer.id : null,
        subtotal: total,
        discount_total: '0',
        tax_total: '0',
        total,
        amount_paid: total,
        change_due: '0',
      }),
    );
    let lineNumber = 0;
    for (const l of lines) {
      const quantity = l.quantity ?? 1;
      const unitPrice = l.product.selling_price;
      await dataSource.getRepository(SaleLine).save(
        dataSource.getRepository(SaleLine).create({
          sale_id: sale.id,
          line_number: ++lineNumber,
          product_id: l.product.id,
          product_sku_snapshot: l.product.sku,
          product_name_snapshot: l.product.name,
          unit_price: unitPrice,
          cost_price_snapshot: l.product.buying_price,
          quantity,
          discount_type: null,
          discount_value: null,
          discount_amount: '0',
          line_total: (
            (Math.round(Number(unitPrice) * 100) * quantity) /
            100
          ).toFixed(2),
          external_supplier_id: null,
          imei_snapshot: l.unit?.imei ?? null,
          product_unit_id: l.unit?.id ?? null,
          warranty: WarrantyPeriod.NO_WARRANTY,
        }),
      );
    }
    const tradeInCents = tradeIn ? tradeIn.value * 100 : 0;
    if (tradeIn) {
      const value = tradeIn.value.toFixed(2);
      await dataSource.getRepository(Payment).save(
        dataSource.getRepository(Payment).create({
          sale_id: sale.id,
          payment_method: PaymentMethod.TRADE_IN,
          amount: value,
          cash_received: null,
          trade_in_product_id: tradeIn.product.id,
          trade_in_imei: tradeIn.imei,
          trade_in_buying_price: value,
          trade_in_selling_price: '750.00',
          trade_in_notes: null,
        }),
      );
    }
    const cash = ((totalCents - tradeInCents) / 100).toFixed(2);
    if (totalCents > tradeInCents) {
      await dataSource.getRepository(Payment).save(
        dataSource.getRepository(Payment).create({
          sale_id: sale.id,
          payment_method: PaymentMethod.CASH,
          amount: cash,
          cash_received: cash,
        }),
      );
    }
    return sale;
  }

  // ---- Requests ----

  /** Send a request and resolve with its response, whatever the status. */
  const send = (test: request.Test): Promise<Response> =>
    new Promise((resolve, reject) => {
      void test.end((err: unknown, res?: Response) => {
        if (res) resolve(res);
        else reject(err instanceof Error ? err : new Error(String(err)));
      });
    });

  const complete = (ctx: Ctx, saleId: string) =>
    send(
      request(app.getHttpServer())
        .post(`/api/v1/sales/${saleId}/complete`)
        .set('Cookie', ctx.cookies),
    );

  const voidSale = (ctx: Ctx, saleId: string) =>
    send(
      request(app.getHttpServer())
        .post(`/api/v1/sales/${saleId}/void`)
        .set('Cookie', ctx.cookies)
        .send({
          void_reason: 'Wrong item rung up',
          approval: approvalFor(ctx.admin.id),
        }),
    );

  async function completeNow(ctx: Ctx, saleId: string): Promise<void> {
    const res = await complete(ctx, saleId);
    expect(res.status).toBe(200);
  }

  // ---- The gate ----

  /** Hold one row FOR UPDATE on a separate connection until released. */
  async function holdRow(
    table: 'product_units' | 'stock',
    id: string,
  ): Promise<QueryRunner> {
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    await runner.query(`SELECT id FROM "${table}" WHERE id = $1 FOR UPDATE`, [
      id,
    ]);
    return runner;
  }

  async function release(runner: QueryRunner): Promise<void> {
    if (runner.isTransactionActive) await runner.commitTransaction();
    if (!runner.isReleased) await runner.release();
  }

  /** Wait until `n` other sessions are blocked on a lock. */
  async function waitForLockWaiters(n: number): Promise<void> {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const rows: { count: number }[] = await dataSource.query(
        `SELECT count(*)::int AS count
           FROM pg_stat_activity
          WHERE datname = current_database()
            AND wait_event_type = 'Lock'
            AND pid <> pg_backend_pid()`,
      );
      if (rows[0].count >= n) return;
      if (Date.now() > deadline) {
        throw new Error(
          `Timed out waiting for ${n} lock waiter(s); saw ${rows[0].count}`,
        );
      }
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  /**
   * Park A on the gate, park B behind it, release, and return both
   * responses.
   */
  async function race(
    gate: QueryRunner,
    a: () => Promise<Response>,
    b: () => Promise<Response>,
  ): Promise<[Response, Response]> {
    try {
      const pa = a();
      await waitForLockWaiters(1);
      const pb = b();
      await waitForLockWaiters(2);
      await release(gate);
      return await Promise.all([pa, pb]);
    } finally {
      await release(gate);
    }
  }

  const statusesOf = (responses: Response[]) =>
    responses.map((r) => ({ status: r.status, body: r.body as unknown }));

  async function stockQty(product: Product): Promise<number | undefined> {
    const row = await dataSource
      .getRepository(Stock)
      .findOne({ where: { product_id: product.id } });
    return row?.quantity;
  }

  async function unitStatus(unit: ProductUnit): Promise<ProductUnitStatus> {
    const row = await dataSource
      .getRepository(ProductUnit)
      .findOneByOrFail({ id: unit.id });
    return row.status;
  }

  // ---- The races ----

  it('two completes with the same products in opposite line orders both succeed', async () => {
    const ctx = await setup();
    const phone = await seedProduct(ctx, 'Phone P1', {
      serialized: true,
      stock: 2,
    });
    const cable = await seedProduct(ctx, 'Cable P2', { stock: 2 });
    const u1 = await seedUnit(ctx, phone, '356938035643809');
    const u2 = await seedUnit(ctx, phone, '490154203237518');
    // X: [phone u1, cable]; Y: [cable, phone u2].
    const x = await seedDraft(ctx, [
      { product: phone, unit: u1 },
      { product: cable },
    ]);
    const y = await seedDraft(ctx, [
      { product: cable },
      { product: phone, unit: u2 },
    ]);

    // X parks on u1 (holding Stock P1 today); Y takes Stock P2, waits on P1.
    const gate = await holdRow('product_units', u1.id);
    const responses = await race(
      gate,
      () => complete(ctx, x.id),
      () => complete(ctx, y.id),
    );

    expect(statusesOf(responses)).toEqual([
      { status: 200, body: expect.anything() },
      { status: 200, body: expect.anything() },
    ]);
    expect(await stockQty(phone)).toBe(0);
    expect(await stockQty(cable)).toBe(0);
    expect(await unitStatus(u1)).toBe(ProductUnitStatus.SOLD);
    expect(await unitStatus(u2)).toBe(ProductUnitStatus.SOLD);
  }, 30_000);

  it('a complete and a void touching the same stock rows in opposite orders both succeed', async () => {
    const ctx = await setup();
    const phone = await seedProduct(ctx, 'Phone P1', {
      serialized: true,
      stock: 2,
    });
    const cable = await seedProduct(ctx, 'Cable P2', { stock: 2 });
    const u1 = await seedUnit(ctx, phone, '356938035643809');
    const u3 = await seedUnit(ctx, phone, '490154203237518');
    // Z, completed first: [cable, phone u3]. The void reads its lines in
    // insertion order: Stock P2, then Stock P1.
    const z = await seedDraft(ctx, [
      { product: cable },
      { product: phone, unit: u3 },
    ]);
    await completeNow(ctx, z.id);
    // X: [phone u1, cable].
    const x = await seedDraft(ctx, [
      { product: phone, unit: u1 },
      { product: cable },
    ]);

    // X parks on u1 (holding Stock P1 today); the void takes Stock P2,
    // then waits on P1.
    const gate = await holdRow('product_units', u1.id);
    const responses = await race(
      gate,
      () => complete(ctx, x.id),
      () => voidSale(ctx, z.id),
    );

    expect(statusesOf(responses)).toEqual([
      { status: 200, body: expect.anything() },
      { status: 200, body: expect.anything() },
    ]);
    // 2 − Z + Z back − X = 1 for each product.
    expect(await stockQty(phone)).toBe(1);
    expect(await stockQty(cable)).toBe(1);
    expect(await unitStatus(u1)).toBe(ProductUnitStatus.SOLD);
    expect(await unitStatus(u3)).toBe(ProductUnitStatus.IN_STOCK);
  }, 30_000);

  it('voiding a trade-in sale while its trade-in phone is being sold: the void wins, the sale gets the existing 409', async () => {
    const ctx = await setup();
    const accessory = await seedProduct(ctx, 'Charger A', { stock: 1 });
    const used = await seedProduct(ctx, 'Used iPhone 12 Q', {
      serialized: true,
      price: '900.00',
    });
    const imei = '356938035643809';
    // T: one charger, paid with a 600 trade-in and 400 cash; completing
    // it takes the phone into stock (Stock Q = 1).
    const t = await seedDraft(ctx, [{ product: accessory }], {
      product: used,
      imei,
      value: 600,
    });
    await completeNow(ctx, t.id);
    const u = await dataSource
      .getRepository(ProductUnit)
      .findOneByOrFail({ imei });
    // S sells that trade-in phone.
    const s = await seedDraft(ctx, [{ product: used, unit: u }]);

    // The void parks on u (holding Stock A); S takes Stock Q, queues on
    // u. Today the void then wants Stock Q: a cycle.
    const gate = await holdRow('product_units', u.id);
    const [voidRes, completeRes] = await race(
      gate,
      () => voidSale(ctx, t.id),
      () => complete(ctx, s.id),
    );

    expect(statusesOf([voidRes])).toEqual([
      { status: 200, body: expect.anything() },
    ]);
    // S runs after the void, exactly as if it had been sent later: the
    // phone went back to the customer, so there is no stock to sell.
    expect(completeRes.status).toBe(409);
    expect((completeRes.body as { message: string }).message).toBe(
      'Insufficient stock for "Used iPhone 12 Q": requested 1, available 0',
    );
    expect(await stockQty(used)).toBe(0);
    expect(await unitStatus(u)).toBe(ProductUnitStatus.RETURNED);
  }, 30_000);

  it('a complete with a trade-in and a complete selling that model on overlapping rows both succeed', async () => {
    const ctx = await setup();
    const cable = await seedProduct(ctx, 'Cable P1', { stock: 2 });
    const used = await seedProduct(ctx, 'Used iPhone 12 Q', {
      serialized: true,
      price: '900.00',
      stock: 1,
    });
    const v = await seedUnit(ctx, used, '490154203237518');
    // X: one cable, paid with a trade-in of model Q and cash.
    const x = await seedDraft(ctx, [{ product: cable }], {
      product: used,
      imei: '356938035643809',
      value: 600,
    });
    // Y: [used phone v, cable].
    const y = await seedDraft(ctx, [
      { product: used, unit: v },
      { product: cable },
    ]);

    // Y parks on v (holding Stock Q today); X takes Stock P1, takes the
    // trade-in in, then waits on Stock Q.
    const gate = await holdRow('product_units', v.id);
    const responses = await race(
      gate,
      () => complete(ctx, y.id),
      () => complete(ctx, x.id),
    );

    expect(statusesOf(responses)).toEqual([
      { status: 200, body: expect.anything() },
      { status: 200, body: expect.anything() },
    ]);
    expect(await stockQty(cable)).toBe(0);
    // 1 − v sold + the trade-in taken in.
    expect(await stockQty(used)).toBe(1);
    expect(await unitStatus(v)).toBe(ProductUnitStatus.SOLD);
  }, 30_000);

  it('pairs of opposite-order completes sent together, round after round, all succeed', async () => {
    const ctx = await setup();
    const rounds = 4;
    const phone = await seedProduct(ctx, 'Phone P1', {
      serialized: true,
      stock: rounds * 2,
    });
    const cable = await seedProduct(ctx, 'Cable P2', { stock: rounds * 2 });
    const results: { status: number; body: unknown }[] = [];
    for (let i = 0; i < rounds; i++) {
      const ua = await seedUnit(
        ctx,
        phone,
        `35693803564${String(i).padStart(4, '0')}`,
      );
      const ub = await seedUnit(
        ctx,
        phone,
        `49015420323${String(i).padStart(4, '0')}`,
      );
      const a = await seedDraft(ctx, [
        { product: phone, unit: ua },
        { product: cable },
      ]);
      const b = await seedDraft(ctx, [
        { product: cable },
        { product: phone, unit: ub },
      ]);
      results.push(
        ...statusesOf(
          await Promise.all([complete(ctx, a.id), complete(ctx, b.id)]),
        ),
      );
    }

    expect(results.filter((r) => r.status !== 200)).toEqual([]);
    expect(await stockQty(phone)).toBe(0);
    expect(await stockQty(cable)).toBe(0);
  }, 60_000);
});
