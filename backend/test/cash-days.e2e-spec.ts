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
import { TrackingMethod } from '../src/products/enums/tracking-method.enum';
import { ProductType } from '../src/products/enums/product-type.enum';
import { WarrantyPeriod } from '../src/products/enums/warranty-period.enum';
import { Stock } from '../src/stock/entities/stock.entity';
import { Customer } from '../src/customers/entities/customer.entity';
import { PaymentMethod } from '../src/sales/enums/payment-method.enum';
import { ReturnCondition } from '../src/sales/enums/return-condition.enum';
import { AuditAction } from '../src/audit-log/enums/audit-action.enum';
import { CashDay } from '../src/cash-days/entities/cash-day.entity';
import { CashDaysService } from '../src/cash-days/cash-days.service';

/**
 * Cash days (Phase 6.4 P9, backend 0a): the six /cash-days endpoints, the
 * summary SQL with the planning doc's P9-5 and P9-6 examples, and the
 * frozen-day rule. Planning doc section 8 "P9 decision log", errors C1 –
 * C9 (C10, C11 are backend 0b).
 *
 * The tests use the database clock's today (Colombo). A run that crosses
 * midnight Colombo time can fail spuriously: a day opened before midnight
 * is then "yesterday". "Yesterday" is made by moving a branch's rows back
 * one day with SQL.
 *
 * Every money scenario runs at its own branch, as the admin (who may sell,
 * void, approve and open anywhere), so no test sees another's sales. The
 * branch rules use branch A and B cashiers. Requests go through a limiter
 * that keeps each route under the app's throttle (10 a second, 100 a
 * minute, per route).
 */
describe('Cash days (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  const PASSWORD = 'testpass123';

  let branchA: Branch;
  let branchB: Branch;
  let admin: User;
  let cashierA: User;
  let cashierB: User;
  let customer: Customer;
  let brand: Brand;
  let category: Category;
  let adminCookies: string[];
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
    method: 'get' | 'post',
    path: string,
    cookies: string[],
    body?: object,
    query?: Record<string, string | number>,
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

  let branchSeq = 0;
  const freshBranch = () =>
    dataSource
      .getRepository(Branch)
      .save({ name: `Cash Shop ${++branchSeq}`, is_active: true } as Branch);

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
        sku: `SKU-CD-${suffix}`,
        barcode: `BC-CD-${suffix}`,
        brand_id: brand.id,
        category_id: category.id,
        branch_id: branch.id,
        buying_price: '100.00',
        selling_price: price,
        is_active: true,
        is_serialized: opts.serialized ?? false,
        tracking_method:
          (opts.serialized ?? false)
            ? TrackingMethod.IMEI
            : TrackingMethod.QUANTITY,
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

  interface PaySpec {
    method: PaymentMethod;
    amount: number;
    cashReceived?: number;
    tradeIn?: Product;
  }
  interface SoldSale {
    id: string;
    lines: { id: string }[];
    payments: { id: string; payment_method: PaymentMethod }[];
  }

  /** A completed one-line sale, through the real endpoints, as the admin. */
  async function sell(
    branch: Branch,
    product: Product,
    payments: PaySpec[],
  ): Promise<SoldSale> {
    const created = await call('post', '/sales', adminCookies, {
      branch_id: branch.id,
      ...(payments.some((p) => p.tradeIn) ? { customer_id: customer.id } : {}),
    });
    expect(created.status).toBe(201);
    const saleId = created.body.id as string;
    const line = await call('post', `/sales/${saleId}/lines`, adminCookies, {
      product_id: product.id,
      quantity: 1,
    });
    expect(line.status).toBe(201);
    for (const p of payments) {
      const body =
        p.method === PaymentMethod.CASH
          ? {
              payment_method: p.method,
              amount: p.amount,
              cash_received: p.cashReceived ?? p.amount,
            }
          : p.method === PaymentMethod.TRADE_IN
            ? {
                payment_method: p.method,
                amount: p.amount,
                trade_in_product_id: p.tradeIn!.id,
                trade_in_imei: nextImei(),
                trade_in_buying_price: p.amount,
              }
            : {
                payment_method: p.method,
                amount: p.amount,
                reference_number: 'AUTH-1',
              };
      const res = await call(
        'post',
        `/sales/${saleId}/payments`,
        adminCookies,
        body,
      );
      expect(res.status).toBe(201);
    }
    const done = await call('post', `/sales/${saleId}/complete`, adminCookies);
    expect(done.status).toBe(200);
    return done.body as SoldSale;
  }

  const cashSale = async (branch: Branch, price: string) =>
    sell(branch, await seedProduct(branch, price), [
      { method: PaymentMethod.CASH, amount: Number(price) },
    ]);

  async function voidSale(saleId: string): Promise<void> {
    const res = await call('post', `/sales/${saleId}/void`, adminCookies, {
      void_reason: 'Wrong item rung up',
      approval: approvalFor(admin.id),
    });
    expect(res.status).toBe(200);
  }

  // ---- Cash days ----

  const openDay = (
    branch: Branch,
    opening: number,
    cookies: string[] = adminCookies,
    clientRequestId: string = randomUUID(),
  ) =>
    call('post', '/cash-days/open', cookies, {
      branch_id: branch.id,
      opening_balance: opening,
      client_request_id: clientRequestId,
    });

  async function openedDay(branch: Branch, opening: number): Promise<string> {
    const res = await openDay(branch, opening);
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  const closeDay = (
    dayId: string,
    body: {
      counted_balance: number;
      expected_seen: number;
      difference_reason?: string | null;
      client_request_id?: string;
    },
    cookies: string[] = adminCookies,
  ) =>
    call('post', `/cash-days/${dayId}/close`, cookies, {
      client_request_id: randomUUID(),
      ...body,
    });

  const summaryOf = (dayId: string, cookies: string[] = adminCookies) =>
    call('get', `/cash-days/${dayId}/summary`, cookies);

  async function colomboDate(offsetDays = 0): Promise<string> {
    const rows: { d: string }[] = await dataSource.query(
      `SELECT to_char((now() AT TIME ZONE 'Asia/Colombo')::date + $1::int, 'YYYY-MM-DD') AS d`,
      [offsetDays],
    );
    return rows[0].d;
  }

  /** An open day inserted directly, `offsetDays` from today. */
  async function insertOpenDay(
    branch: Branch,
    offsetDays: number,
    opening = '1000.00',
  ): Promise<string> {
    const rows: { id: string }[] = await dataSource.query(
      `INSERT INTO cash_days
         (branch_id, business_date, opening_balance, opened_by, opened_at,
          open_client_request_id)
       VALUES ($1, (now() AT TIME ZONE 'Asia/Colombo')::date + $2::int, $3,
               $4, now() + make_interval(days => $2::int), $5)
       RETURNING id`,
      [branch.id, offsetDays, opening, admin.id, randomUUID()],
    );
    return rows[0].id;
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

  async function countRows(sql: string, params: unknown[]): Promise<number> {
    const rows: { n: number }[] = await dataSource.query(sql, params);
    return rows[0].n;
  }
  const daysAt = (branch: Branch) =>
    countRows(`SELECT count(*)::int AS n FROM cash_days WHERE branch_id = $1`, [
      branch.id,
    ]);
  interface AuditRow {
    action: string;
    user_id: string;
    description: string;
    changes: Record<string, { old: unknown; new: unknown }>;
  }
  const auditOf = (action: AuditAction, dayId: string): Promise<AuditRow[]> =>
    dataSource.query(
      `SELECT action, user_id, description, changes FROM audit_logs
        WHERE action = $1 AND entity_id = $2 ORDER BY created_at`,
      [action, dayId],
    );

  const idsOf = (res: Response): string[] =>
    (res.body as { data: { id: string }[] }).data.map((d) => d.id);

  const ZERO_TENDERS = {
    CARD: '0.00',
    BANK_TRANSFER: '0.00',
    KOKO: '0.00',
    MINTPAY: '0.00',
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
      .save({ name: 'Second Shop', is_active: true } as Branch);
    brand = await dataSource
      .getRepository(Brand)
      .save({ name: 'CashDaysBrand', is_active: true } as Brand);
    category = await dataSource
      .getRepository(Category)
      .save({ name: 'CashDaysCategory', is_active: true } as Category);
    customer = await dataSource.getRepository(Customer).save(
      dataSource.getRepository(Customer).create({
        name: 'Nimal Silva',
        phone: '0771234568',
        nic: '199000000002',
        notes: null,
      }),
    );

    ({ user: admin, cookies: adminCookies } = await seedUser(
      UserRole.ADMIN,
      'admin@cd.test',
      null,
    ));
    ({ user: cashierA, cookies: cashierACookies } = await seedUser(
      UserRole.CASHIER,
      'cashier-a@cd.test',
      branchA,
    ));
    ({ cookies: cashierA2Cookies } = await seedUser(
      UserRole.CASHIER,
      'cashier-a2@cd.test',
      branchA,
    ));
    ({ user: cashierB, cookies: cashierBCookies } = await seedUser(
      UserRole.CASHIER,
      'cashier-b@cd.test',
      branchB,
    ));
  });

  afterAll(async () => {
    await app.close();
  });

  // ---- The worked examples (P9-5, P9-6) ----

  describe('expected cash: the worked examples', () => {
    let shop: Branch;
    let saleA: SoldSale;
    let mondayId: string;

    it('P9-5: change not counted, a same-day void nets to zero, a split refund counts only its cash (15,500.00)', async () => {
      shop = await freshBranch();
      mondayId = await openedDay(shop, 5000);

      // Sale A: 12,000.00 cash; the customer gave 15,000.00, 3,000.00 change.
      saleA = await sell(shop, await seedProduct(shop, '12000.00'), [
        { method: PaymentMethod.CASH, amount: 12000, cashReceived: 15000 },
      ]);
      // Sale B: 2,000.00 cash, voided the same day.
      const saleB = await cashSale(shop, '2000.00');
      await voidSale(saleB.id);
      // A trade-in sale (CARD 500.00 + TRADE_IN 9,500.00, no cash), then a
      // return refunding 2,000.00 as CARD 500.00 + CASH 1,500.00: the
      // trade-in share (2,000.00 − 500.00) is in the cash.
      const usedModel = await seedProduct(shop, '1.00', { serialized: true });
      const saleC = await sell(shop, await seedProduct(shop, '10000.00'), [
        { method: PaymentMethod.CARD, amount: 500 },
        { method: PaymentMethod.TRADE_IN, amount: 9500, tradeIn: usedModel },
      ]);
      const card = saleC.payments.find(
        (p) => p.payment_method === PaymentMethod.CARD,
      )!;
      const ret = await call(
        'post',
        `/sales/${saleC.id}/returns`,
        adminCookies,
        {
          client_request_id: randomUUID(),
          lines: [
            {
              sale_line_id: saleC.lines[0].id,
              quantity: 1,
              condition: ReturnCondition.RESALEABLE,
            },
          ],
          refunds: [
            {
              method: PaymentMethod.CARD,
              amount: 500,
              original_payment_id: card.id,
              reference_number: 'REV-1',
            },
            { method: PaymentMethod.CASH, amount: 1500 },
          ],
          reason: 'Customer changed their mind',
          approval: approvalFor(admin.id),
        },
      );
      expect(ret.status).toBe(201);

      const summary = await summaryOf(mondayId);
      expect(summary.status).toBe(200);
      expect(summary.body).toEqual({
        cash_day_id: mondayId,
        business_date: await colomboDate(),
        closed: false,
        opening_balance: '5000.00',
        cash_sales: '12000.00',
        cash_refunds: '1500.00',
        cash_voids_earlier: '0.00',
        expected_balance: '15500.00',
        summary: {
          non_cash_sales: { ...ZERO_TENDERS, CARD: '500.00' },
          non_cash_refunds: { ...ZERO_TENDERS, CARD: '500.00' },
          earlier_voids_non_cash: ZERO_TENDERS,
          trade_in_value: '9500.00',
          counts: { sales_completed: 3, returns: 1, voids: 1 },
        },
      });

      const closed = await closeDay(mondayId, {
        counted_balance: 15500,
        expected_seen: 15500,
      });
      expect(closed.status).toBe(200);
      expect(closed.body).toMatchObject({
        cash_sales: '12000.00',
        cash_refunds: '1500.00',
        cash_voids_earlier: '0.00',
        expected_balance: '15500.00',
        counted_balance: '15500.00',
        difference: '0.00',
        difference_reason: null,
      });
    });

    it('P9-6: an earlier day sale voided today comes off today (11,500.00); yesterday stays 15,500.00, live and snapshot', async () => {
      // Monday becomes yesterday, with sale A and its 12,000.00 cash in it.
      await moveBranchBackOneDay(shop);
      const tuesdayId = await openedDay(shop, 15500);
      await cashSale(shop, '8000.00');
      await voidSale(saleA.id);

      const tuesday = await summaryOf(tuesdayId);
      expect(tuesday.body).toMatchObject({
        opening_balance: '15500.00',
        cash_sales: '8000.00',
        cash_refunds: '0.00',
        cash_voids_earlier: '12000.00',
        expected_balance: '11500.00',
        summary: {
          earlier_voids_non_cash: ZERO_TENDERS,
          counts: { sales_completed: 1, returns: 0, voids: 1 },
        },
      });

      // Monday's snapshot is unchanged ...
      const monday = await summaryOf(mondayId);
      expect(monday.body).toMatchObject({
        business_date: await colomboDate(-1),
        closed: true,
        cash_sales: '12000.00',
        expected_balance: '15500.00',
      });
      // ... and Monday worked out again now, after the void, equals it:
      // the frozen-day rule, not just a stored copy.
      const row = await dataSource
        .getRepository(CashDay)
        .findOneByOrFail({ id: mondayId });
      const live = await app
        .get(CashDaysService)
        .computeSummary(dataSource.manager, row);
      expect(live).toEqual(monday.body);

      const closed = await closeDay(tuesdayId, {
        counted_balance: 11500,
        expected_seen: 11500,
      });
      expect(closed.status).toBe(200);
      expect(closed.body.cash_voids_earlier).toBe('12000.00');
    });
  });

  // ---- C1: validation ----

  describe('C1: validation', () => {
    it('open: a negative amount, 3 decimals, null, no client_request_id (400)', async () => {
      const shop = await freshBranch();
      for (const body of [
        { opening_balance: -1, client_request_id: randomUUID() },
        { opening_balance: 10.123, client_request_id: randomUUID() },
        { opening_balance: null, client_request_id: randomUUID() },
        { opening_balance: 1000 },
      ]) {
        const res = await call('post', '/cash-days/open', adminCookies, {
          branch_id: shop.id,
          ...body,
        });
        expect(res.status).toBe(400);
      }
      expect(await daysAt(shop)).toBe(0);
    });

    it('close: negative counted, 3 decimals, a 501-character reason (even at zero difference), no client_request_id (400)', async () => {
      const shop = await freshBranch();
      const dayId = await openedDay(shop, 1000);
      for (const body of [
        { counted_balance: -1, expected_seen: 1000 },
        { counted_balance: 1000.001, expected_seen: 1000 },
        {
          counted_balance: 1000,
          expected_seen: 1000,
          difference_reason: 'x'.repeat(501),
        },
      ]) {
        const res = await closeDay(dayId, body);
        expect(res.status).toBe(400);
      }
      const noId = await call(
        'post',
        `/cash-days/${dayId}/close`,
        adminCookies,
        {
          counted_balance: 1000,
          expected_seen: 1000,
        },
      );
      expect(noId.status).toBe(400);
      expect((await summaryOf(dayId)).body.closed).toBe(false);
    });
  });

  // ---- C2: branch ----

  describe('C2: own branch only (admins: any)', () => {
    it('a branch B cashier is refused at branch A on every endpoint (403 CASH_DAY_WRONG_BRANCH)', async () => {
      await dataSource.query(`DELETE FROM cash_days WHERE branch_id = $1`, [
        branchA.id,
      ]);
      const opened = await openDay(branchA, 1000, cashierACookies);
      expect(opened.status).toBe(201);
      const dayId = opened.body.id as string;

      const refused = [
        await openDay(branchA, 1000, cashierBCookies),
        await call('get', '/cash-days/current', cashierBCookies, undefined, {
          branchId: branchA.id,
        }),
        await call('get', '/cash-days', cashierBCookies, undefined, {
          branchId: branchA.id,
        }),
        await call('get', `/cash-days/${dayId}`, cashierBCookies),
        await summaryOf(dayId, cashierBCookies),
        await closeDay(
          dayId,
          { counted_balance: 1000, expected_seen: 1000 },
          cashierBCookies,
        ),
      ];
      for (const res of refused) {
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('CASH_DAY_WRONG_BRANCH');
      }
      // An admin may read and close it.
      expect(
        (await call('get', `/cash-days/${dayId}`, adminCookies)).status,
      ).toBe(200);
      const closed = await closeDay(dayId, {
        counted_balance: 1000,
        expected_seen: 1000,
      });
      expect(closed.status).toBe(200);
      expect(closed.body.opened_by.id).toBe(cashierA.id);
      expect(closed.body.closed_by.id).toBe(admin.id);
    });

    it('a cashier opens and closes their own branch’s day (201, 200; opened_by and closed_by are the cashier)', async () => {
      await dataSource.query(`DELETE FROM cash_days WHERE branch_id = $1`, [
        branchB.id,
      ]);
      const cashierRef = { id: cashierB.id, full_name: cashierB.full_name };

      const opened = await openDay(branchB, 2000, cashierBCookies);
      expect(opened.status).toBe(201);
      expect(opened.body).toMatchObject({
        branch_id: branchB.id,
        opening_balance: '2000.00',
        opened_by: cashierRef,
        closed_by: null,
      });
      const dayId = opened.body.id as string;

      const seen = await summaryOf(dayId, cashierBCookies);
      expect(seen.status).toBe(200);
      const closed = await closeDay(
        dayId,
        {
          counted_balance: 2000,
          expected_seen: Number(seen.body.expected_balance),
        },
        cashierBCookies,
      );
      expect(closed.status).toBe(200);
      expect(closed.body).toMatchObject({
        opened_by: cashierRef,
        closed_by: cashierRef,
        expected_balance: '2000.00',
        difference: '0.00',
      });
      const [openAudit] = await auditOf(AuditAction.DAY_OPEN, dayId);
      const [closeAudit] = await auditOf(AuditAction.DAY_CLOSE, dayId);
      expect(openAudit.user_id).toBe(cashierB.id);
      expect(closeAudit.user_id).toBe(cashierB.id);
    });

    it('404 Branch not found for open, current and the list', async () => {
      const missing = randomUUID();
      const res = [
        await call('post', '/cash-days/open', adminCookies, {
          branch_id: missing,
          opening_balance: 1000,
          client_request_id: randomUUID(),
        }),
        await call('get', '/cash-days/current', adminCookies, undefined, {
          branchId: missing,
        }),
        await call('get', '/cash-days', adminCookies, undefined, {
          branchId: missing,
        }),
      ];
      for (const r of res) {
        expect(r.status).toBe(404);
        expect(r.body.message).toBe('Branch not found');
      }
    });
  });

  // ---- C3: client_request_id ----

  describe('C3: client_request_id', () => {
    it('open: a resend by the same user is 200 with the same day; another user or branch is 409', async () => {
      await dataSource.query(`DELETE FROM cash_days WHERE branch_id = $1`, [
        branchA.id,
      ]);
      const crid = randomUUID();
      const first = await openDay(branchA, 1000, cashierACookies, crid);
      expect(first.status).toBe(201);
      // The resend's body is ignored.
      const again = await openDay(branchA, 2500, cashierACookies, crid);
      expect(again.status).toBe(200);
      expect(again.body.id).toBe(first.body.id);
      expect(again.body.opening_balance).toBe('1000.00');
      expect(await daysAt(branchA)).toBe(1);
      expect(await auditOf(AuditAction.DAY_OPEN, first.body.id)).toHaveLength(
        1,
      );

      const byOther = await openDay(branchA, 1000, cashierA2Cookies, crid);
      expect(byOther.status).toBe(409);
      expect(byOther.body.code).toBe('CLIENT_REQUEST_ID_CONFLICT');

      const shop1 = await freshBranch();
      const shop2 = await freshBranch();
      const adminCrid = randomUUID();
      expect((await openDay(shop1, 1000, adminCookies, adminCrid)).status).toBe(
        201,
      );
      const otherBranch = await openDay(shop2, 1000, adminCookies, adminCrid);
      expect(otherBranch.status).toBe(409);
      expect(otherBranch.body.code).toBe('CLIENT_REQUEST_ID_CONFLICT');
      expect(await daysAt(shop2)).toBe(0);
    });

    it('close: a resend is 200 with the closed day and one DAY_CLOSE row; the id on another day is 409', async () => {
      const shop = await freshBranch();
      const dayId = await openedDay(shop, 1000);
      const crid = randomUUID();
      const first = await closeDay(dayId, {
        counted_balance: 1000,
        expected_seen: 1000,
        client_request_id: crid,
      });
      expect(first.status).toBe(200);
      // A resend with a different body still gets the recorded close.
      const again = await closeDay(dayId, {
        counted_balance: 5,
        expected_seen: 5,
        client_request_id: crid,
      });
      expect(again.status).toBe(200);
      expect(again.body.counted_balance).toBe('1000.00');
      expect(again.body.closed_at).toBe(first.body.closed_at);
      expect(await auditOf(AuditAction.DAY_CLOSE, dayId)).toHaveLength(1);

      const other = await freshBranch();
      const otherDayId = await openedDay(other, 1000);
      const reused = await closeDay(otherDayId, {
        counted_balance: 1000,
        expected_seen: 1000,
        client_request_id: crid,
      });
      expect(reused.status).toBe(409);
      expect(reused.body.code).toBe('CLIENT_REQUEST_ID_CONFLICT');
      expect((await summaryOf(otherDayId)).body.closed).toBe(false);
    });
  });

  // ---- C4, C5: open refusals ----

  describe('C4, C5: open refusals', () => {
    it('C4: today already open, then already closed (409 DAY_ALREADY_OPEN)', async () => {
      const shop = await freshBranch();
      const dayId = await openedDay(shop, 1000);

      const whileOpen = await openDay(shop, 1000);
      expect(whileOpen.status).toBe(409);
      expect(whileOpen.body).toMatchObject({
        code: 'DAY_ALREADY_OPEN',
        cash_day_id: dayId,
        closed_at: null,
      });

      const closed = await closeDay(dayId, {
        counted_balance: 1000,
        expected_seen: 1000,
      });
      const afterClose = await openDay(shop, 1000);
      expect(afterClose.status).toBe(409);
      expect(afterClose.body).toMatchObject({
        code: 'DAY_ALREADY_OPEN',
        cash_day_id: dayId,
        closed_at: closed.body.closed_at,
      });
      expect(afterClose.body.message).toContain('already opened and closed');
      expect(await daysAt(shop)).toBe(1);
    });

    it('C5: an earlier day still open (409 EARLIER_DAY_NOT_CLOSED); closing it lets today open', async () => {
      const shop = await freshBranch();
      const yesterdayId = await insertOpenDay(shop, -1);
      const yesterday = await colomboDate(-1);

      const refused = await openDay(shop, 1000);
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({
        code: 'EARLIER_DAY_NOT_CLOSED',
        business_date: yesterday,
        cash_day_id: yesterdayId,
      });
      const current = await call(
        'get',
        '/cash-days/current',
        adminCookies,
        undefined,
        { branchId: shop.id },
      );
      expect(current.body.earlier_open).toEqual({
        id: yesterdayId,
        business_date: yesterday,
      });

      const closed = await closeDay(yesterdayId, {
        counted_balance: 1000,
        expected_seen: 1000,
      });
      expect(closed.status).toBe(200);
      expect(closed.body.business_date).toBe(yesterday);
      expect((await openDay(shop, 1000)).status).toBe(201);
    });
  });

  // ---- C6 – C9: close refusals and the difference ----

  describe('C6 – C9: close', () => {
    it('C6: an unknown day is 404 (close and summary)', async () => {
      const missing = randomUUID();
      expect(
        (await closeDay(missing, { counted_balance: 1, expected_seen: 1 }))
          .status,
      ).toBe(404);
      expect((await summaryOf(missing)).status).toBe(404);
      expect(
        (await call('get', `/cash-days/${missing}`, adminCookies)).status,
      ).toBe(404);
    });

    it('C7: an already closed day is 409 DAY_ALREADY_CLOSED', async () => {
      const shop = await freshBranch();
      const dayId = await openedDay(shop, 1000);
      await closeDay(dayId, { counted_balance: 1000, expected_seen: 1000 });

      const again = await closeDay(dayId, {
        counted_balance: 2000,
        expected_seen: 1000,
        difference_reason: 'Trying again',
      });
      expect(again.status).toBe(409);
      expect(again.body).toMatchObject({
        code: 'DAY_ALREADY_CLOSED',
        cash_day_id: dayId,
      });
      expect(await auditOf(AuditAction.DAY_CLOSE, dayId)).toHaveLength(1);
    });

    it('C8: a sale after the dialog read the figures is 409 EXPECTED_CHANGED with the fresh summary', async () => {
      const shop = await freshBranch();
      const dayId = await openedDay(shop, 1000);
      const seen = await summaryOf(dayId);
      expect(seen.body.expected_balance).toBe('1000.00');
      await cashSale(shop, '500.00');

      const crid = randomUUID();
      const stale = await closeDay(dayId, {
        counted_balance: 1000,
        expected_seen: 1000,
        client_request_id: crid,
      });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('EXPECTED_CHANGED');
      expect(stale.body.summary).toMatchObject({
        cash_day_id: dayId,
        closed: false,
        cash_sales: '500.00',
        expected_balance: '1500.00',
      });

      // The dialog shows the fresh figures and sends again, same id.
      const fresh = await closeDay(dayId, {
        counted_balance: 1500,
        expected_seen: 1500,
        client_request_id: crid,
      });
      expect(fresh.status).toBe(200);
      expect(fresh.body.expected_balance).toBe('1500.00');
    });

    it('C9: short with no reason or under 3 characters is 400 REASON_REQUIRED; with a reason it closes', async () => {
      const shop = await freshBranch();
      const dayId = await openedDay(shop, 1000);
      for (const reason of [undefined, 'ab', '   ']) {
        const res = await closeDay(dayId, {
          counted_balance: 900,
          expected_seen: 1000,
          difference_reason: reason,
        });
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({
          code: 'REASON_REQUIRED',
          difference: '-100.00',
        });
      }
      expect((await summaryOf(dayId)).body.closed).toBe(false);

      const closed = await closeDay(dayId, {
        counted_balance: 900,
        expected_seen: 1000,
        difference_reason: '  Float miscounted  ',
      });
      expect(closed.status).toBe(200);
      expect(closed.body).toMatchObject({
        expected_balance: '1000.00',
        counted_balance: '900.00',
        difference: '-100.00',
        difference_reason: 'Float miscounted',
      });
    });

    it('over by 50.00 with a reason', async () => {
      const shop = await freshBranch();
      const dayId = await openedDay(shop, 1000);
      const closed = await closeDay(dayId, {
        counted_balance: 1050,
        expected_seen: 1000,
        difference_reason: 'Customer left change',
      });
      expect(closed.status).toBe(200);
      expect(closed.body).toMatchObject({
        difference: '50.00',
        difference_reason: 'Customer left change',
      });
    });

    it('the rounding rule: 0.50 short needs no reason (200, null); 1.00 short does (400 REASON_REQUIRED)', async () => {
      const shop = await freshBranch();
      const halfDay = await openedDay(shop, 1000.5);
      const half = await closeDay(halfDay, {
        counted_balance: 1000,
        expected_seen: 1000.5,
      });
      expect(half.status).toBe(200);
      expect(half.body).toMatchObject({
        expected_balance: '1000.50',
        counted_balance: '1000.00',
        difference: '-0.50',
        difference_reason: null,
      });

      const other = await freshBranch();
      const rupeeDay = await openedDay(other, 1000);
      const rupee = await closeDay(rupeeDay, {
        counted_balance: 999,
        expected_seen: 1000,
      });
      expect(rupee.status).toBe(400);
      expect(rupee.body).toMatchObject({
        code: 'REASON_REQUIRED',
        difference: '-1.00',
      });
      expect((await summaryOf(rupeeDay)).body.closed).toBe(false);
    });

    it('a zero difference ignores any reason sent and stores null', async () => {
      const shop = await freshBranch();
      const dayId = await openedDay(shop, 1000);
      const closed = await closeDay(dayId, {
        counted_balance: 1000,
        expected_seen: 1000,
        difference_reason: 'ok',
      });
      expect(closed.status).toBe(200);
      expect(closed.body.difference).toBe('0.00');
      expect(closed.body.difference_reason).toBeNull();
    });
  });

  // ---- Reads ----

  describe('reads', () => {
    it('current: before opening, open, then closed (last_closed)', async () => {
      const shop = await freshBranch();
      const today = await colomboDate();
      const get = () =>
        call('get', '/cash-days/current', adminCookies, undefined, {
          branchId: shop.id,
        });

      expect((await get()).body).toEqual({
        business_date: today,
        today: null,
        earlier_open: null,
        last_closed: null,
      });

      const dayId = await openedDay(shop, 2500);
      const open = (await get()).body;
      expect(open.today).toMatchObject({
        id: dayId,
        business_date: today,
        opening_balance: '2500.00',
        closed_at: null,
        closed_by: null,
      });
      expect(open.last_closed).toBeNull();

      await closeDay(dayId, {
        counted_balance: 2400,
        expected_seen: 2500,
        difference_reason: 'Short by a note',
      });
      const closed = (await get()).body;
      expect(closed.today.closed_at).not.toBeNull();
      expect(closed.last_closed).toEqual({
        business_date: today,
        counted_balance: '2400.00',
      });
    });

    it('list: open days included, newest first, opener and closer as { id, full_name }; GET :id the same', async () => {
      const shop = await freshBranch();
      const yesterdayId = await insertOpenDay(shop, -1);
      await closeDay(yesterdayId, {
        counted_balance: 1000,
        expected_seen: 1000,
      });
      const todayId = await openedDay(shop, 1000);

      const list = await call('get', '/cash-days', adminCookies, undefined, {
        branchId: shop.id,
      });
      expect(list.status).toBe(200);
      expect(idsOf(list)).toEqual([todayId, yesterdayId]);
      expect(list.body.data[0]).toMatchObject({
        closed_at: null,
        closed_by: null,
        opened_by: { id: admin.id, full_name: admin.full_name },
      });
      expect(list.body.data[1].closed_by).toEqual({
        id: admin.id,
        full_name: admin.full_name,
      });
      expect(list.body.meta).toMatchObject({
        total: 2,
        page: 1,
        totalPages: 1,
      });

      const page2 = await call('get', '/cash-days', adminCookies, undefined, {
        branchId: shop.id,
        page: 2,
        limit: 1,
      });
      expect(idsOf(page2)).toEqual([yesterdayId]);
      expect(page2.body.meta).toMatchObject({ hasPrev: true, hasNext: false });

      const one = await call('get', `/cash-days/${yesterdayId}`, adminCookies);
      expect(one.status).toBe(200);
      expect(one.body.opened_by).toEqual({
        id: admin.id,
        full_name: admin.full_name,
      });
      expect(one.body.closed_by).toEqual({
        id: admin.id,
        full_name: admin.full_name,
      });
      expect(one.body.summary).toEqual({
        non_cash_sales: ZERO_TENDERS,
        non_cash_refunds: ZERO_TENDERS,
        earlier_voids_non_cash: ZERO_TENDERS,
        trade_in_value: '0.00',
        counts: { sales_completed: 0, returns: 0, voids: 0 },
      });
    });
  });

  // ---- Audit (P9-19) ----

  describe('audit rows', () => {
    it('DAY_OPEN carries the opening balance; DAY_CLOSE expected, counted, difference and the reason', async () => {
      const shop = await freshBranch();
      const dayId = await openedDay(shop, 3000);
      await closeDay(dayId, {
        counted_balance: 2950,
        expected_seen: 3000,
        difference_reason: 'Paid a delivery from the till',
      });

      const [opened] = await auditOf(AuditAction.DAY_OPEN, dayId);
      expect(opened.user_id).toBe(admin.id);
      expect(opened.changes).toEqual({
        business_date: { old: null, new: await colomboDate() },
        opening_balance: { old: null, new: '3000.00' },
      });
      expect(opened.description).toContain('opened with LKR 3000.00');

      const [closed] = await auditOf(AuditAction.DAY_CLOSE, dayId);
      expect(closed.user_id).toBe(admin.id);
      expect(closed.changes).toEqual({
        expected_balance: { old: null, new: '3000.00' },
        counted_balance: { old: null, new: '2950.00' },
        difference: { old: null, new: '-50.00' },
        difference_reason: { old: null, new: 'Paid a delivery from the till' },
      });
      expect(closed.description).toContain('Short LKR 50.00');
    });
  });
});
