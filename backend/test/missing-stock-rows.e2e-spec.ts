import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { DataSource, QueryRunner } from 'typeorm';
import { createTestApp, truncateAllTables } from './setup';
import { AuthService } from '../src/auth/auth.service';
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
import { TrackingMethod } from '../src/products/enums/tracking-method.enum';
import { WarrantyPeriod } from '../src/products/enums/warranty-period.enum';
import { Stock } from '../src/stock/entities/stock.entity';
import { Customer } from '../src/customers/entities/customer.entity';
import { Supplier } from '../src/suppliers/entities/supplier.entity';
import { ProductUnit } from '../src/product-units/entities/product-unit.entity';
import { ProductUnitStatus } from '../src/product-units/enums/product-unit-status.enum';
import { PhonePurchase } from '../src/phone-purchases/entities/phone-purchase.entity';
import { StockPurchase } from '../src/stock-purchases/entities/stock-purchase.entity';
import { openToday } from './cash-day.helper';

type Response = request.Response;

/**
 * Products are a global catalog (MakeProductsCatalogGlobal): a product
 * made without a branch has no Stock row anywhere until something brings
 * it in. Before T0, the intakes that don't create one (a phone bought from
 * a customer, a trade-in at complete) hit the "Stock row missing" integrity
 * error and answered 500, and so did completing a sale of such a product.
 *
 * Now an intake creates the row (ensureStockRows, before the lock pass of
 * the global lock order, P7-25), and a sale of a product the branch never
 * had answers the usual insufficient-stock 409 with available 0.
 *
 * Sessions are minted with AuthService.login (no HTTP logins). Drafts are
 * seeded straight into the database, as in lock-order.e2e-spec.ts.
 */
describe('Missing stock rows (e2e)', () => {
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
    const users = dataSource.getRepository(User);
    const saved = await users.save(
      users.create({
        email: 'admin@missing-stock.test',
        password_hash: await bcrypt.hash('testpass123', 4),
        full_name: 'Test admin',
        role: UserRole.ADMIN,
        is_active: true,
        branch_id: null,
      }),
    );
    const admin = await users.findOneByOrFail({ id: saved.id });
    await openToday(dataSource, branch.id, admin.id);
    const customer = await dataSource.getRepository(Customer).save(
      dataSource.getRepository(Customer).create({
        name: 'Kamal Perera',
        phone: '0771234567',
        nic: '199000000001',
        notes: null,
      }),
    );
    const tokens = await app.get(AuthService).login(admin, null, null);
    const cookies = [
      `access_token=${tokens.access_token}`,
      `refresh_token=${tokens.refresh_token}`,
    ];
    return { branch, admin, cookies, customer };
  }

  /**
   * A catalog product with no branch, and a Stock row only when `stockAt`
   * is given.
   */
  async function seedProduct(
    name: string,
    opts: {
      imei?: boolean;
      stockAt?: { branch: Branch; quantity: number };
    } = {},
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
        product_type: null,
        name,
        sku: `SKU-MISS-${suffix}`,
        barcode: `BC-MISS-${suffix}`,
        brand_id: brand.id,
        category_id: category.id,
        branch_id: null,
        buying_price: '500.00',
        selling_price: '1000.00',
        is_active: true,
        is_serialized: opts.imei ?? false,
        tracking_method: opts.imei
          ? TrackingMethod.IMEI
          : TrackingMethod.QUANTITY,
        default_warranty: WarrantyPeriod.NO_WARRANTY,
      }),
    );
    if (opts.stockAt) {
      await dataSource.getRepository(Stock).save(
        dataSource.getRepository(Stock).create({
          product_id: product.id,
          branch_id: opts.stockAt.branch.id,
          quantity: opts.stockAt.quantity,
          min_quantity: 0,
          manage_stock: true,
        }),
      );
    }
    return product;
  }

  /**
   * A fully paid DRAFT with a line of `quantity` × `product` for each of
   * `items`, numbered in order, paid with an optional trade-in and cash for
   * the rest.
   */
  async function seedDraft(
    ctx: Ctx,
    items: { product: Product; quantity: number }[],
    tradeIn?: { product: Product; imei: string; value: number },
  ): Promise<{ sale: Sale; lines: SaleLine[] }> {
    const lineCents = items.map(
      ({ product, quantity }) =>
        Math.round(Number(product.selling_price) * 100) * quantity,
    );
    const totalCents = lineCents.reduce((sum, cents) => sum + cents, 0);
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
    const lines: SaleLine[] = [];
    for (const [index, { product, quantity }] of items.entries()) {
      lines.push(
        await dataSource.getRepository(SaleLine).save(
          dataSource.getRepository(SaleLine).create({
            sale_id: sale.id,
            line_number: index + 1,
            product_id: product.id,
            product_sku_snapshot: product.sku,
            product_name_snapshot: product.name,
            unit_price: product.selling_price!,
            cost_price_snapshot: product.buying_price!,
            quantity,
            discount_type: null,
            discount_value: null,
            discount_amount: '0',
            line_total: (lineCents[index] / 100).toFixed(2),
            external_supplier_id: null,
            imei_snapshot: null,
            product_unit_id: null,
            warranty: WarrantyPeriod.NO_WARRANTY,
          }),
        ),
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
    if (totalCents > tradeInCents) {
      const cash = ((totalCents - tradeInCents) / 100).toFixed(2);
      await dataSource.getRepository(Payment).save(
        dataSource.getRepository(Payment).create({
          sale_id: sale.id,
          payment_method: PaymentMethod.CASH,
          amount: cash,
          cash_received: cash,
        }),
      );
    }
    return { sale, lines };
  }

  // ---- Requests and reads ----

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

  /** A stock purchase of each product, 2 of each unless `quantities` says. */
  const stockPurchase = (
    ctx: Ctx,
    supplier: Supplier,
    products: Product[],
    quantities: number[] = [],
  ) =>
    send(
      request(app.getHttpServer())
        .post('/api/v1/stock-purchases')
        .set('Cookie', ctx.cookies)
        .send({
          supplier_id: supplier.id,
          branch_id: ctx.branch.id,
          items: products.map((product, index) => ({
            product_id: product.id,
            quantity: quantities[index] ?? 2,
            unit_buying_price: '100.00',
          })),
        }),
    );

  const phonePurchase = (ctx: Ctx, phone: Product, imei: string) =>
    send(
      request(app.getHttpServer())
        .post('/api/v1/phone-purchases')
        .set('Cookie', ctx.cookies)
        .send({
          customer_id: ctx.customer.id,
          branch_id: ctx.branch.id,
          product_id: phone.id,
          imei,
          buying_price: 80000,
        }),
    );

  const seedSupplier = () =>
    dataSource
      .getRepository(Supplier)
      .save({ name: 'Colombo Wholesale', is_active: true } as Supplier);

  const stockRowsOf = (product: Product) =>
    dataSource.getRepository(Stock).find({ where: { product_id: product.id } });

  async function stockQty(
    product: Product,
    branch: Branch,
  ): Promise<number | undefined> {
    const row = await dataSource
      .getRepository(Stock)
      .findOne({ where: { product_id: product.id, branch_id: branch.id } });
    return row?.quantity;
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

  async function release(runner: QueryRunner): Promise<void> {
    if (runner.isTransactionActive) await runner.commitTransaction();
    if (!runner.isReleased) await runner.release();
  }

  // ---- Phone purchase ----

  it('buying a phone of a model the branch never had creates its stock row (was 500)', async () => {
    const ctx = await setup();
    const phone = await seedProduct('iPhone 15 Black', { imei: true });
    expect(await stockRowsOf(phone)).toEqual([]);

    const res = await send(
      request(app.getHttpServer())
        .post('/api/v1/phone-purchases')
        .set('Cookie', ctx.cookies)
        .send({
          customer_id: ctx.customer.id,
          branch_id: ctx.branch.id,
          product_id: phone.id,
          imei: '356938035643809',
          buying_price: 80000,
        }),
    );

    expect(res.status).toBe(201);
    const rows = await stockRowsOf(phone);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      branch_id: ctx.branch.id,
      quantity: 1,
      min_quantity: 0,
      manage_stock: true,
    });
    const unit = await dataSource
      .getRepository(ProductUnit)
      .findOneByOrFail({ product_id: phone.id });
    expect(unit).toMatchObject({
      branch_id: ctx.branch.id,
      imei: '356938035643809',
      status: ProductUnitStatus.IN_STOCK,
    });
  });

  // ---- Trade-in at complete ----

  it('completing a sale with a trade-in of a model the branch never had creates its stock row (was 500)', async () => {
    const ctx = await setup();
    const cable = await seedProduct('UGREEN Cable', {
      stockAt: { branch: ctx.branch, quantity: 5 },
    });
    const tradeInModel = await seedProduct('Galaxy S21', { imei: true });
    expect(await stockRowsOf(tradeInModel)).toEqual([]);
    const { sale } = await seedDraft(ctx, [{ product: cable, quantity: 1 }], {
      product: tradeInModel,
      imei: '490154203237518',
      value: 400,
    });

    const res = await complete(ctx, sale.id);

    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe(SaleStatus.COMPLETED);
    expect(await stockQty(cable, ctx.branch)).toBe(4);
    expect(await stockQty(tradeInModel, ctx.branch)).toBe(1);
    const unit = await dataSource
      .getRepository(ProductUnit)
      .findOneByOrFail({ product_id: tradeInModel.id });
    expect(unit).toMatchObject({
      branch_id: ctx.branch.id,
      imei: '490154203237518',
      status: ProductUnitStatus.IN_STOCK,
    });
  });

  // ---- Rollback after the stock row was created ----

  it('a trade-in whose product was deactivated after the draft is refused, and its new stock row is rolled back', async () => {
    const ctx = await setup();
    const cable = await seedProduct('UGREEN Cable', {
      stockAt: { branch: ctx.branch, quantity: 5 },
    });
    const tradeInModel = await seedProduct('Galaxy S21', { imei: true });
    const { sale } = await seedDraft(ctx, [{ product: cable, quantity: 1 }], {
      product: tradeInModel,
      imei: '490154203237518',
      value: 400,
    });
    await dataSource
      .getRepository(Product)
      .update(tradeInModel.id, { is_active: false });

    // completeSale creates the trade-in's stock row (ensureStockRows, step
    // 2d) and takes the cable off stock before createForTradeIn checks the
    // product, so this refusal comes after both.
    const res = await complete(ctx, sale.id);

    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toBe(
      'Product "Galaxy S21" is inactive',
    );
    expect(await stockRowsOf(tradeInModel)).toEqual([]);
    expect(await stockQty(cable, ctx.branch)).toBe(5);
    expect(
      await dataSource
        .getRepository(ProductUnit)
        .count({ where: { product_id: tradeInModel.id } }),
    ).toBe(0);
    expect(await dataSource.getRepository(PhonePurchase).count()).toBe(0);
    const after = await dataSource
      .getRepository(Sale)
      .findOneByOrFail({ id: sale.id });
    expect(after.status).toBe(SaleStatus.DRAFT);
  });

  it('buying a phone whose IMEI is already in stock is refused and changes nothing', async () => {
    const ctx = await setup();
    const phone = await seedProduct('iPhone 15 Black', { imei: true });
    expect((await phonePurchase(ctx, phone, '356938035643809')).status).toBe(
      201,
    );

    // The IMEI pre-check refuses before any stock row is touched.
    const res = await phonePurchase(ctx, phone, '356938035643809');

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      message: 'IMEI already exists in inventory',
      imei: '356938035643809',
      existing_unit: { status: ProductUnitStatus.IN_STOCK },
    });
    const rows = await stockRowsOf(phone);
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(1);
    expect(await dataSource.getRepository(PhonePurchase).count()).toBe(1);
    expect(
      await dataSource
        .getRepository(ProductUnit)
        .count({ where: { imei: '356938035643809' } }),
    ).toBe(1);
  });

  it('a phone purchase whose IMEI goes live while it runs is refused, and its new stock row is rolled back', async () => {
    const ctx = await setup();
    const phone = await seedProduct('iPhone 15 Black', { imei: true });
    const other = await seedProduct('Galaxy S21', { imei: true });
    const imei = '356938035643809';

    // Another transaction takes the IMEI in and stays open: the purchase
    // passes the IMEI pre-check (it can't see an uncommitted unit), creates
    // the phone's stock row, then waits on the live-IMEI unique index when
    // it inserts its unit. Committing the gate turns that wait into the
    // unique violation the purchase maps to 409.
    const gate = dataSource.createQueryRunner();
    await gate.connect();
    await gate.startTransaction();
    await gate.query(
      `INSERT INTO product_units
         (product_id, branch_id, imei, imei_number, status, buying_price)
       VALUES ($1, $2, $3, $3, 'IN_STOCK', 100)`,
      [other.id, ctx.branch.id, imei],
    );
    let pending: Promise<Response> | undefined;
    let res: Response;
    try {
      pending = phonePurchase(ctx, phone, imei);
      await waitForLockWaiters(1);
      await release(gate);
      res = await pending;
    } finally {
      await release(gate);
      if (pending) await Promise.allSettled([pending]);
    }

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      message: 'IMEI already exists in inventory',
      imei,
      existing_unit: null,
    });
    expect(await stockRowsOf(phone)).toEqual([]);
    expect(await dataSource.getRepository(PhonePurchase).count()).toBe(0);
    const units = await dataSource
      .getRepository(ProductUnit)
      .find({ where: { imei } });
    expect(units.map((u) => u.product_id)).toEqual([other.id]);
  });

  // ---- Sale ----

  it('completing a sale of a product the branch never had answers 409 with available 0 (was 500), and changes nothing', async () => {
    const ctx = await setup();
    // Line 1 is decremented (5 → 4) before line 2 is refused, so its
    // quantity coming back as 5 shows the whole complete rolled back.
    const cable = await seedProduct('UGREEN Cable', {
      stockAt: { branch: ctx.branch, quantity: 5 },
    });
    const charger = await seedProduct('UGREEN 20W Charger');
    const { sale, lines } = await seedDraft(ctx, [
      { product: cable, quantity: 1 },
      { product: charger, quantity: 2 },
    ]);
    const paymentsOf = () =>
      dataSource
        .getRepository(Payment)
        .find({ where: { sale_id: sale.id }, order: { id: 'ASC' } });
    const paymentsBefore = await paymentsOf();
    expect(paymentsBefore).toHaveLength(1);

    const res = await complete(ctx, sale.id);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      message:
        'Insufficient stock for "UGREEN 20W Charger": requested 2, available 0',
      product_id: charger.id,
      sale_line_id: lines[1].id,
    });
    // The sale is still an unnumbered draft.
    const after = await dataSource
      .getRepository(Sale)
      .findOneByOrFail({ id: sale.id });
    expect(after.status).toBe(SaleStatus.DRAFT);
    expect(after.sale_number).toBeNull();
    expect(after.completed_at).toBeNull();
    // Its payments are exactly as they were: none added, removed or
    // changed (reversed_at, amounts, updated_at all included).
    expect(await paymentsOf()).toEqual(paymentsBefore);
    // A sale never creates stock, and the decrement of line 1 was undone.
    expect(await stockRowsOf(charger)).toEqual([]);
    expect(await stockQty(cable, ctx.branch)).toBe(5);
    expect(await stockRowsOf(cable)).toHaveLength(1);
  });

  // ---- Stock purchase ----

  it('a stock purchase of products the branch never had creates their stock rows', async () => {
    const ctx = await setup();
    const supplier = await seedSupplier();
    const cable = await seedProduct('UGREEN Cable');
    const charger = await seedProduct('UGREEN 20W Charger');

    const res = await stockPurchase(ctx, supplier, [charger, cable]);

    expect(res.status).toBe(201);
    expect(await stockQty(cable, ctx.branch)).toBe(2);
    expect(await stockQty(charger, ctx.branch)).toBe(2);
  });

  it('two stock purchases listing the same existing stock rows in opposite orders both succeed', async () => {
    const ctx = await setup();
    const supplier = await seedSupplier();
    const cable = await seedProduct('UGREEN Cable', {
      stockAt: { branch: ctx.branch, quantity: 0 },
    });
    const charger = await seedProduct('UGREEN 20W Charger', {
      stockAt: { branch: ctx.branch, quantity: 0 },
    });
    const [first, second] = [cable, charger].sort((a, b) =>
      a.id < b.id ? -1 : 1,
    );
    const firstRow = await dataSource
      .getRepository(Stock)
      .findOneByOrFail({ product_id: first.id });

    // Guards the lock pass over rows that already exist. (The code before
    // T0 locked these with one SELECT … IN (…) FOR UPDATE, which both
    // purchases ran in the same plan order, so this passed then too; the
    // first-intake test below is the one that shows the T0 ordering.)
    // Hold the first row in the lock order, park one purchase listing it
    // last and one listing it first, then release.
    const gate = dataSource.createQueryRunner();
    await gate.connect();
    await gate.startTransaction();
    await gate.query(`SELECT id FROM "stock" WHERE id = $1 FOR UPDATE`, [
      firstRow.id,
    ]);
    let responses: Response[];
    try {
      const a = stockPurchase(ctx, supplier, [second, first]);
      await waitForLockWaiters(1);
      const b = stockPurchase(ctx, supplier, [first, second]);
      await waitForLockWaiters(2);
      await release(gate);
      responses = await Promise.all([a, b]);
    } finally {
      await release(gate);
    }

    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    expect(await stockQty(first, ctx.branch)).toBe(4);
    expect(await stockQty(second, ctx.branch)).toBe(4);
  });

  it('two first-intake stock purchases listing the same new products in different orders cannot deadlock', async () => {
    const ctx = await setup();
    const supplier = await seedSupplier();
    const seeded = [
      await seedProduct('UGREEN Cable'),
      await seedProduct('UGREEN 20W Charger'),
      await seedProduct('Anker Power Bank'),
    ];
    // Roles by id, so Z is last in the lock order: P < Q < Z.
    const [p, q, z] = seeded.sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const product of [p, q, z]) {
      expect(await stockRowsOf(product)).toEqual([]);
    }

    // The gate holds product Z's row FOR UPDATE. Creating a stock row for
    // Z checks its foreign key, which takes FOR KEY SHARE on that product
    // row, so a purchase pauses exactly when it reaches Z.
    //
    // Before T0 (rows created in request order):
    //   A [Q, Z, P] inserts Q's row, then waits at Z (holding Q);
    //   B [P, Q]    inserts P's row, then waits on A's uncommitted Q;
    //   gate released: A inserts Z, then waits on B's uncommitted P:
    //   deadlock (40P01), one purchase gets a 500.
    // With T0 (rows created in sorted order P, Q, Z):
    //   A inserts P and Q, then waits at Z; B waits on A's P;
    //   gate released: A finishes, then B finds the rows and finishes.
    const gate = dataSource.createQueryRunner();
    await gate.connect();
    await gate.startTransaction();
    await gate.query(`SELECT id FROM products WHERE id = $1 FOR UPDATE`, [
      z.id,
    ]);
    const pending: Promise<Response>[] = [];
    let responses: Response[];
    try {
      pending.push(stockPurchase(ctx, supplier, [q, z, p], [1, 2, 3]));
      await waitForLockWaiters(1);
      pending.push(stockPurchase(ctx, supplier, [p, q], [10, 20]));
      await waitForLockWaiters(2);
      await release(gate);
      responses = await Promise.all(pending);
    } finally {
      await release(gate);
      await Promise.allSettled(pending);
    }

    expect(
      responses.map((r) => ({ status: r.status, body: r.body as unknown })),
    ).toEqual([
      expect.objectContaining({ status: 201 }),
      expect.objectContaining({ status: 201 }),
    ]);
    expect(await dataSource.getRepository(StockPurchase).count()).toBe(2);
    for (const product of [p, q, z]) {
      expect(await stockRowsOf(product)).toHaveLength(1);
    }
    expect(await stockQty(p, ctx.branch)).toBe(3 + 10);
    expect(await stockQty(q, ctx.branch)).toBe(1 + 20);
    expect(await stockQty(z, ctx.branch)).toBe(2);
  });
});
