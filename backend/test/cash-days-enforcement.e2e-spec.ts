import { INestApplication } from '@nestjs/common';
import request, { Response } from 'supertest';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { DataSource, QueryRunner } from 'typeorm';
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
import { PhonePurchase } from '../src/phone-purchases/entities/phone-purchase.entity';
import { ProductUnit } from '../src/product-units/entities/product-unit.entity';
import { ProductUnitStatus } from '../src/product-units/enums/product-unit-status.enum';
import { PaymentMethod } from '../src/sales/enums/payment-method.enum';
import { ReturnCondition } from '../src/sales/enums/return-condition.enum';
import { SaleStatus } from '../src/sales/enums/sale-status.enum';
import { SaleNumberKind } from '../src/sale-number-counters/enums/sale-number-kind.enum';
import { AuditAction } from '../src/audit-log/enums/audit-action.enum';

jest.setTimeout(60_000);

/**
 * The day gate (Phase 6.4 P9, backend 0b; P9-9, P9-10, errors C10, C11):
 * complete, void and return refuse with 409 DAY_NOT_OPEN or DAY_CLOSED
 * when today (the database clock's Colombo date) has no open cash day at
 * the sale's branch; void and return check before the PIN, so no attempt
 * is spent; and the FOR SHARE lock against close's FOR UPDATE, forced in
 * both orders with a gate (a second connection holding a row), as in
 * lock-order.e2e-spec.ts.
 *
 * Every scenario runs at its own branch. Sales, voids and returns are the
 * admin's (who approves with the test PIN); days are opened and closed by
 * a second admin, the closer, so the close-first race can hold the
 * closer's users row without touching the sale's requests. "Yesterday" is
 * made by moving a branch's rows back one day, as in cash-days.e2e-spec.ts.
 * A run crossing midnight Colombo time can fail spuriously.
 */
describe('Cash days: enforcement (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  const PASSWORD = 'testpass123';
  const WRONG_PIN = '000001';

  let admin: User;
  let closer: User;
  let customer: Customer;
  let brand: Brand;
  let category: Category;
  let adminCookies: string[];
  let closerCookies: string[];

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

  /** Any status resolves; only a network error rejects. */
  async function call(
    method: 'get' | 'post',
    path: string,
    cookies: string[],
    body?: object,
  ): Promise<Response> {
    await paced(`${method} ${path.replace(/[0-9a-f-]{36}/g, ':id')}`);
    const req = request(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set('Cookie', cookies);
    return body ? req.send(body) : req;
  }

  // ---- Seeding ----

  async function seedUser(
    role: UserRole,
    email: string,
  ): Promise<{ user: User; cookies: string[] }> {
    const repo = dataSource.getRepository(User);
    const user = await repo.save(
      repo.create({
        email,
        password_hash: await bcrypt.hash(PASSWORD, 4),
        full_name: `Test ${role} ${email.split('@')[0]}`,
        role,
        is_active: true,
        branch_id: null,
      }),
    );
    await giveApprovalPin(dataSource, user.id);
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

  let branchSeq = 0;
  const freshBranch = () =>
    dataSource
      .getRepository(Branch)
      .save({ name: `Gate Shop ${++branchSeq}`, is_active: true } as Branch);

  async function seedProduct(
    branch: Branch,
    price: string,
    opts: { serialized?: boolean } = {},
  ): Promise<Product> {
    const suffix = Math.random().toString(36).slice(2, 8);
    const product = await dataSource.getRepository(Product).save(
      dataSource.getRepository(Product).create({
        product_type: ProductType.PHONE,
        name: `Item ${price} ${suffix}`,
        sku: `SKU-GATE-${suffix}`,
        barcode: `BC-GATE-${suffix}`,
        brand_id: brand.id,
        category_id: category.id,
        branch_id: branch.id,
        buying_price: '50.00',
        selling_price: price,
        is_active: true,
        is_serialized: opts.serialized ?? false,
        default_warranty: WarrantyPeriod.MONTH_12,
      }),
    );
    await dataSource.getRepository(Stock).save(
      dataSource.getRepository(Stock).create({
        product_id: product.id,
        branch_id: branch.id,
        quantity: opts.serialized ? 0 : 10,
        min_quantity: 0,
        manage_stock: true,
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
        cashier_id: admin.id,
        total_amount: '50.00',
        notes: null,
      }),
    );
    const unit = await dataSource.getRepository(ProductUnit).save(
      dataSource.getRepository(ProductUnit).create({
        product_id: product.id,
        branch_id: product.branch_id,
        imei: nextImei(),
        status: ProductUnitStatus.IN_STOCK,
        buying_price: '50.00',
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

  // ---- Sales, voids, returns (the admin) ----

  interface SoldSale {
    id: string;
    lines: { id: string }[];
  }

  /** A one-line DRAFT paid in full in cash, through the real endpoints. */
  async function paidDraft(
    branch: Branch,
    product: Product,
    imei?: string,
  ): Promise<string> {
    const created = await call('post', '/sales', adminCookies, {
      branch_id: branch.id,
    });
    expect(created.status).toBe(201);
    const saleId = created.body.id as string;
    const line = await call('post', `/sales/${saleId}/lines`, adminCookies, {
      product_id: product.id,
      quantity: 1,
      ...(imei ? { imei_snapshot: imei } : {}),
    });
    expect(line.status).toBe(201);
    const amount = Number(product.selling_price);
    const paid = await call('post', `/sales/${saleId}/payments`, adminCookies, {
      payment_method: PaymentMethod.CASH,
      amount,
      cash_received: amount,
    });
    expect(paid.status).toBe(201);
    return saleId;
  }

  const complete = (saleId: string) =>
    call('post', `/sales/${saleId}/complete`, adminCookies);

  async function sell(
    branch: Branch,
    product: Product,
    imei?: string,
  ): Promise<SoldSale> {
    const done = await complete(await paidDraft(branch, product, imei));
    expect(done.status).toBe(200);
    return done.body as SoldSale;
  }

  const voidSale = (saleId: string, pin?: string) =>
    call('post', `/sales/${saleId}/void`, adminCookies, {
      void_reason: 'Wrong item rung up',
      approval: approvalFor(admin.id, pin),
    });

  /** A return of the sale's first line, refunded in full in cash. */
  const returnBody = (
    sale: SoldSale,
    amount: number,
    opts: { phone?: boolean; pin?: string } = {},
  ) => ({
    client_request_id: randomUUID(),
    lines: [
      {
        sale_line_id: sale.lines[0].id,
        quantity: 1,
        ...(opts.phone ? {} : { condition: ReturnCondition.RESALEABLE }),
      },
    ],
    refunds: [{ method: PaymentMethod.CASH, amount }],
    reason: 'Customer changed their mind',
    approval: approvalFor(admin.id, opts.pin),
  });

  const postReturn = (saleId: string, body: object) =>
    call('post', `/sales/${saleId}/returns`, adminCookies, body);

  // ---- Cash days (the closer) ----

  async function openDay(branch: Branch, opening: number): Promise<string> {
    const res = await call('post', '/cash-days/open', closerCookies, {
      branch_id: branch.id,
      opening_balance: opening,
      client_request_id: randomUUID(),
    });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  const closeDay = (
    dayId: string,
    body: { counted_balance: number; expected_seen: number },
  ) =>
    call('post', `/cash-days/${dayId}/close`, closerCookies, {
      client_request_id: randomUUID(),
      ...body,
    });

  /** Close the day counting exactly what the server expects. */
  async function closeExact(dayId: string): Promise<void> {
    const summary = await call(
      'get',
      `/cash-days/${dayId}/summary`,
      closerCookies,
    );
    expect(summary.status).toBe(200);
    const expected = Number(summary.body.expected_balance);
    const closed = await closeDay(dayId, {
      counted_balance: expected,
      expected_seen: expected,
    });
    expect(closed.status).toBe(200);
  }

  /** Move a branch's days, sales and returns back one day (P9-6). */
  async function moveBranchBackOneDay(branch: Branch): Promise<void> {
    await dataSource.query(
      `UPDATE cash_days
          SET business_date = business_date - 1,
              opened_at = opened_at - interval '1 day',
              closed_at = closed_at - interval '1 day'
        WHERE branch_id = $1`,
      [branch.id],
    );
    await dataSource.query(
      `UPDATE sales
          SET created_at = created_at - interval '1 day',
              completed_at = completed_at - interval '1 day',
              voided_at = voided_at - interval '1 day'
        WHERE branch_id = $1`,
      [branch.id],
    );
    await dataSource.query(
      `UPDATE sale_returns SET created_at = created_at - interval '1 day'
        WHERE branch_id = $1`,
      [branch.id],
    );
  }

  async function colomboDate(): Promise<string> {
    const rows: { d: string }[] = await dataSource.query(
      `SELECT to_char((now() AT TIME ZONE 'Asia/Colombo')::date, 'YYYY-MM-DD') AS d`,
    );
    return rows[0].d;
  }

  // ---- Reads ----

  async function countRows(sql: string, params: unknown[]): Promise<number> {
    const rows: { n: number }[] = await dataSource.query(sql, params);
    return rows[0].n;
  }

  async function saleRow(saleId: string): Promise<{
    status: SaleStatus;
    sale_number: string | null;
    completed_at: Date | null;
    voided_at: Date | null;
  }> {
    const rows: {
      status: SaleStatus;
      sale_number: string | null;
      completed_at: Date | null;
      voided_at: Date | null;
    }[] = await dataSource.query(
      `SELECT status, sale_number, completed_at, voided_at
         FROM sales WHERE id = $1`,
      [saleId],
    );
    return rows[0];
  }

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

  const pinAttempts = (userId: string) =>
    countRows(
      `SELECT approval_pin_failed_attempts AS n FROM users WHERE id = $1`,
      [userId],
    );

  const counterRowsAt = (branch: Branch) =>
    countRows(
      `SELECT count(*)::int AS n FROM sale_number_counters WHERE branch_id = $1`,
      [branch.id],
    );

  /** A void or return refused by the gate left the sale exactly as sold. */
  async function expectUntouched(
    sale: SoldSale,
    product: Product,
    stock: number,
  ): Promise<void> {
    expect(await saleRow(sale.id)).toMatchObject({
      status: SaleStatus.COMPLETED,
      voided_at: null,
    });
    expect(await stockOf(product)).toBe(stock);
    expect(
      await countRows(
        `SELECT count(*)::int AS n FROM sale_returns WHERE sale_id = $1`,
        [sale.id],
      ),
    ).toBe(0);
    expect(
      await countRows(
        `SELECT returned_quantity AS n FROM sale_lines WHERE id = $1`,
        [sale.lines[0].id],
      ),
    ).toBe(0);
    expect(
      await countRows(
        `SELECT count(*)::int AS n FROM payments
          WHERE sale_id = $1 AND reversed_at IS NOT NULL`,
        [sale.id],
      ),
    ).toBe(0);
    expect(
      await countRows(
        `SELECT count(*)::int AS n FROM audit_logs
          WHERE entity_id = $1 AND action IN ($2, $3)`,
        [sale.id, AuditAction.VOID, AuditAction.RETURN],
      ),
    ).toBe(0);
  }

  // ---- The gate (a second connection) ----

  /** Run `sql` FOR UPDATE on a separate connection; held until released. */
  async function hold(sql: string, params: unknown[]): Promise<QueryRunner> {
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    await runner.query(sql, params);
    return runner;
  }

  async function release(
    runner: QueryRunner,
    how: 'commit' | 'rollback' = 'commit',
  ): Promise<void> {
    if (runner.isTransactionActive) {
      if (how === 'commit') await runner.commitTransaction();
      else await runner.rollbackTransaction();
    }
    if (!runner.isReleased) await runner.release();
  }

  /** Wait until a session running a statement like `pattern` waits on a lock. */
  async function waitForWaiter(pattern: string): Promise<void> {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const n = await countRows(
        `SELECT count(*)::int AS n
           FROM pg_stat_activity
          WHERE datname = current_database()
            AND wait_event_type = 'Lock'
            AND pid <> pg_backend_pid()
            AND query ILIKE $1`,
        [pattern],
      );
      if (n >= 1) return;
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for a lock waiter on ${pattern}`);
      }
      await pause(25);
    }
  }

  const CLOSE_UPDATE = '%UPDATE cash_days%';
  const CLOSE_LOCK = '%FROM "cash_days"%FOR UPDATE%';
  const SALE_DAY_LOCK = '%FROM cash_days%FOR SHARE%';
  // generateNext locks the counter row (SELECT … FOR UPDATE) before its
  // upsert; the sale parks there.
  const SALE_COUNTER = '%FROM "sale_number_counters"%FOR UPDATE%';

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
    await truncateAllTables(app);

    brand = await dataSource
      .getRepository(Brand)
      .save({ name: 'GateBrand', is_active: true } as Brand);
    category = await dataSource
      .getRepository(Category)
      .save({ name: 'GateCategory', is_active: true } as Category);
    customer = await dataSource.getRepository(Customer).save(
      dataSource.getRepository(Customer).create({
        name: 'Sunil Fernando',
        phone: '0771234569',
        nic: '199000000003',
        notes: null,
      }),
    );
    ({ user: admin, cookies: adminCookies } = await seedUser(
      UserRole.ADMIN,
      'admin@gate.test',
    ));
    ({ user: closer, cookies: closerCookies } = await seedUser(
      UserRole.ADMIN,
      'closer@gate.test',
    ));
  });

  afterAll(async () => {
    await app.close();
  });

  // ---- C10, C11: refused, nothing changed ----

  describe('refused, nothing changed', () => {
    it('complete on a day not opened is 409 DAY_NOT_OPEN with today; the sale stays a paid DRAFT', async () => {
      const shop = await freshBranch();
      const product = await seedProduct(shop, '500.00');
      const saleId = await paidDraft(shop, product);

      const res = await complete(saleId);

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: 'DAY_NOT_OPEN',
        business_date: await colomboDate(),
      });
      expect(await saleRow(saleId)).toMatchObject({
        status: SaleStatus.DRAFT,
        sale_number: null,
        completed_at: null,
      });
      expect(await stockOf(product)).toBe(10);
      expect(await counterRowsAt(shop)).toBe(0);
    });

    it('complete on a closed day is 409 DAY_CLOSED with today; the sale stays a paid DRAFT', async () => {
      const shop = await freshBranch();
      const product = await seedProduct(shop, '500.00');
      const dayId = await openDay(shop, 1000);
      const saleId = await paidDraft(shop, product);
      await closeExact(dayId);

      const res = await complete(saleId);

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: 'DAY_CLOSED',
        business_date: await colomboDate(),
      });
      expect(await saleRow(saleId)).toMatchObject({
        status: SaleStatus.DRAFT,
        sale_number: null,
        completed_at: null,
      });
      expect(await stockOf(product)).toBe(10);
      expect(await counterRowsAt(shop)).toBe(0);
    });

    it('void and return on a day not opened (yesterday closed) are 409 DAY_NOT_OPEN; nothing changes', async () => {
      const shop = await freshBranch();
      const product = await seedProduct(shop, '300.00');
      const dayId = await openDay(shop, 1000);
      const sale = await sell(shop, product);
      await closeExact(dayId);
      await moveBranchBackOneDay(shop);
      const today = await colomboDate();

      const voided = await voidSale(sale.id);
      const returned = await postReturn(sale.id, returnBody(sale, 300));

      for (const res of [voided, returned]) {
        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({
          code: 'DAY_NOT_OPEN',
          business_date: today,
        });
      }
      await expectUntouched(sale, product, 9);
    });

    it('void and return on a closed day are 409 DAY_CLOSED; nothing changes', async () => {
      const shop = await freshBranch();
      const product = await seedProduct(shop, '300.00');
      const dayId = await openDay(shop, 1000);
      const sale = await sell(shop, product);
      await closeExact(dayId);
      const today = await colomboDate();

      const voided = await voidSale(sale.id);
      const returned = await postReturn(sale.id, returnBody(sale, 300));

      for (const res of [voided, returned]) {
        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({
          code: 'DAY_CLOSED',
          business_date: today,
        });
      }
      await expectUntouched(sale, product, 9);
    });
  });

  // ---- P9-9: the day before the PIN ----

  describe('no PIN attempt spent', () => {
    it.each([
      ['not opened', 'DAY_NOT_OPEN'],
      ['closed', 'DAY_CLOSED'],
    ])(
      'a wrong PIN on a day %s: void and return are 409 %s and approval_pin_failed_attempts stays 0',
      async (state, code) => {
        const shop = await freshBranch();
        const product = await seedProduct(shop, '300.00');
        const dayId = await openDay(shop, 1000);
        const sale = await sell(shop, product);
        await closeExact(dayId);
        if (state === 'not opened') await moveBranchBackOneDay(shop);
        expect(await pinAttempts(admin.id)).toBe(0);

        const voided = await voidSale(sale.id, WRONG_PIN);
        const returned = await postReturn(
          sale.id,
          returnBody(sale, 300, { pin: WRONG_PIN }),
        );

        for (const res of [voided, returned]) {
          expect(res.status).toBe(409);
          expect(res.body.code).toBe(code);
        }
        expect(await pinAttempts(admin.id)).toBe(0);
        expect(
          await countRows(
            `SELECT count(*)::int AS n FROM audit_logs
              WHERE entity_id = $1 AND action = $2`,
            [admin.id, AuditAction.APPROVAL_PIN_FAILED],
          ),
        ).toBe(0);
        await expectUntouched(sale, product, 9);
      },
    );
  });

  // ---- P9-10: close racing a sale ----

  describe('close racing a sale', () => {
    it('close first: a complete waiting behind the close gets 409 DAY_CLOSED (not DAY_NOT_OPEN); the snapshot has no sale', async () => {
      const shop = await freshBranch();
      const product = await seedProduct(shop, '500.00');
      const dayId = await openDay(shop, 1000);
      const saleId = await paidDraft(shop, product);

      // The close takes the day FOR UPDATE, then its closed_by FK check
      // waits on the closer's users row. The sale is the admin's, so
      // nothing it does touches that row.
      const gate = await hold(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [
        closer.id,
      ]);
      let closed!: Response;
      let completed!: Response;
      try {
        const pClose = closeDay(dayId, {
          counted_balance: 1000,
          expected_seen: 1000,
        });
        await waitForWaiter(CLOSE_UPDATE);
        const pComplete = complete(saleId);
        await waitForWaiter(SALE_DAY_LOCK);
        await release(gate);
        [closed, completed] = await Promise.all([pClose, pComplete]);
      } finally {
        await release(gate);
      }

      expect(closed.status).toBe(200);
      expect(closed.body).toMatchObject({
        cash_sales: '0.00',
        expected_balance: '1000.00',
        counted_balance: '1000.00',
      });
      expect(completed.status).toBe(409);
      expect(completed.body).toMatchObject({
        code: 'DAY_CLOSED',
        business_date: await colomboDate(),
      });
      expect(await saleRow(saleId)).toMatchObject({
        status: SaleStatus.DRAFT,
        sale_number: null,
      });
      expect(await stockOf(product)).toBe(10);
    });

    it('a complete waiting behind a FOR UPDATE on the day that rolls back goes through (200)', async () => {
      const shop = await freshBranch();
      const product = await seedProduct(shop, '500.00');
      const dayId = await openDay(shop, 1000);
      const saleId = await paidDraft(shop, product);

      const gate = await hold(
        `SELECT id FROM cash_days WHERE id = $1 FOR UPDATE`,
        [dayId],
      );
      let completed!: Response;
      try {
        const pComplete = complete(saleId);
        await waitForWaiter(SALE_DAY_LOCK);
        await release(gate, 'rollback');
        completed = await pComplete;
      } finally {
        await release(gate, 'rollback');
      }

      expect(completed.status).toBe(200);
      expect(await saleRow(saleId)).toMatchObject({
        status: SaleStatus.COMPLETED,
      });
    });

    /**
     * Sale first: the sale holds the day FOR SHARE and is parked on the
     * sale-number counter row (lock-order step 5); the close then waits
     * on its FOR UPDATE. A warm-up sale makes the counter row exist.
     */
    async function saleFirst(expectedSeen: number): Promise<{
      dayId: string;
      saleId: string;
      completed: Response;
      closed: Response;
    }> {
      const shop = await freshBranch();
      const dayId = await openDay(shop, 1000);
      await sell(shop, await seedProduct(shop, '100.00'));
      const saleId = await paidDraft(shop, await seedProduct(shop, '500.00'));

      const gate = await hold(
        `SELECT id FROM sale_number_counters
          WHERE branch_id = $1 AND kind = $2 FOR UPDATE`,
        [shop.id, SaleNumberKind.SALE],
      );
      try {
        const pComplete = complete(saleId);
        await waitForWaiter(SALE_COUNTER);
        const pClose = closeDay(dayId, {
          counted_balance: expectedSeen,
          expected_seen: expectedSeen,
        });
        await waitForWaiter(CLOSE_LOCK);
        await release(gate);
        const [completed, closed] = await Promise.all([pComplete, pClose]);
        return { dayId, saleId, completed, closed };
      } finally {
        await release(gate);
      }
    }

    it('sale first: the close waits for the sale, and its snapshot includes it', async () => {
      const { saleId, completed, closed } = await saleFirst(1600);

      expect(completed.status).toBe(200);
      expect(await saleRow(saleId)).toMatchObject({
        status: SaleStatus.COMPLETED,
      });
      expect(closed.status).toBe(200);
      expect(closed.body).toMatchObject({
        cash_sales: '600.00',
        expected_balance: '1600.00',
        counted_balance: '1600.00',
        difference: '0.00',
      });
    });

    it('sale first, the dialog’s figures from before the sale: 409 EXPECTED_CHANGED with the sale in the fresh summary; the day stays open', async () => {
      const { dayId, completed, closed } = await saleFirst(1100);

      expect(completed.status).toBe(200);
      expect(closed.status).toBe(409);
      expect(closed.body).toMatchObject({
        code: 'EXPECTED_CHANGED',
        summary: {
          cash_day_id: dayId,
          closed: false,
          cash_sales: '600.00',
          expected_balance: '1600.00',
        },
      });
      expect(
        await countRows(
          `SELECT count(*)::int AS n FROM cash_days
            WHERE id = $1 AND closed_at IS NULL`,
          [dayId],
        ),
      ).toBe(1);
    });
  });

  // ---- An earlier day's sale is gated by today's day ----

  describe('an earlier day’s sale, voided or returned today', () => {
    let shop: Branch;
    let product: Product;
    let s1: SoldSale;
    let s2: SoldSale;
    let s3: SoldSale;
    let yesterdayId: string;
    let todayId: string;

    it('yesterday still open, today not opened: void and return are 409 DAY_NOT_OPEN with today’s date', async () => {
      shop = await freshBranch();
      product = await seedProduct(shop, '100.00');
      yesterdayId = await openDay(shop, 1000);
      s1 = await sell(shop, product);
      s2 = await sell(shop, product);
      s3 = await sell(shop, product);
      await moveBranchBackOneDay(shop);
      const today = await colomboDate();

      const voided = await voidSale(s1.id);
      const returned = await postReturn(s2.id, returnBody(s2, 100));

      for (const res of [voided, returned]) {
        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({
          code: 'DAY_NOT_OPEN',
          business_date: today,
        });
      }
      await expectUntouched(s1, product, 7);
      await expectUntouched(s2, product, 7);
    });

    it('yesterday closed, today open: the void (200) and the return (201) go through and count on today', async () => {
      await closeExact(yesterdayId);
      todayId = await openDay(shop, 1300);

      expect((await voidSale(s1.id)).status).toBe(200);
      expect((await postReturn(s2.id, returnBody(s2, 100))).status).toBe(201);

      const summary = await call(
        'get',
        `/cash-days/${todayId}/summary`,
        closerCookies,
      );
      expect(summary.body).toMatchObject({
        cash_sales: '0.00',
        cash_refunds: '100.00',
        cash_voids_earlier: '100.00',
        expected_balance: '1100.00',
      });
    });

    it('today closed: void and return are 409 DAY_CLOSED', async () => {
      await closeExact(todayId);

      const voided = await voidSale(s3.id);
      const returned = await postReturn(s3.id, returnBody(s3, 100));

      for (const res of [voided, returned]) {
        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({
          code: 'DAY_CLOSED',
          business_date: await colomboDate(),
        });
      }
      await expectUntouched(s3, product, 9);
    });
  });

  // ---- Not gated, and resends ----

  describe('after the close', () => {
    it('inspection pass works on a closed day (not gated)', async () => {
      const shop = await freshBranch();
      const model = await seedProduct(shop, '800.00', { serialized: true });
      const unit = await seedPhone(model);
      const dayId = await openDay(shop, 1000);
      const sale = await sell(shop, model, unit.imei);
      const ret = await postReturn(
        sale.id,
        returnBody(sale, 800, { phone: true }),
      );
      expect(ret.status).toBe(201);
      expect(await unitStatus(unit.id)).toBe(ProductUnitStatus.INSPECTION);
      await closeExact(dayId);

      const passed = await call(
        'post',
        `/product-units/${unit.id}/inspection-pass`,
        adminCookies,
      );

      expect(passed.status).toBe(200);
      expect(await unitStatus(unit.id)).toBe(ProductUnitStatus.IN_STOCK);
    });

    it('a return resend after the close answers 200 with the recorded return', async () => {
      const shop = await freshBranch();
      const product = await seedProduct(shop, '300.00');
      const dayId = await openDay(shop, 1000);
      const sale = await sell(shop, product);
      const body = returnBody(sale, 300);
      const first = await postReturn(sale.id, body);
      expect(first.status).toBe(201);
      await closeExact(dayId);

      const resend = await postReturn(sale.id, body);

      expect(resend.status).toBe(200);
      expect(resend.body.return_id).toBe(first.body.return_id);
      expect(
        await countRows(
          `SELECT count(*)::int AS n FROM sale_returns WHERE sale_id = $1`,
          [sale.id],
        ),
      ).toBe(1);
    });
  });
});
