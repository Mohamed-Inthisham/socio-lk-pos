import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { DataSource, QueryRunner } from 'typeorm';
import { createTestApp, truncateAllTables } from './setup';
import { AuthService } from '../src/auth/auth.service';
import { User } from '../src/users/entities/user.entity';
import { UserRole } from '../src/users/enums/user-role.enum';
import { Branch } from '../src/branches/entities/branch.entity';
import { Brand } from '../src/brands/entities/brand.entity';
import { Category } from '../src/categories/entities/category.entity';
import { Product } from '../src/products/entities/product.entity';
import { TrackingMethod } from '../src/products/enums/tracking-method.enum';
import { WarrantyPeriod } from '../src/products/enums/warranty-period.enum';
import { Stock } from '../src/stock/entities/stock.entity';
import { StockMovement } from '../src/stock/entities/stock-movement.entity';
import { Supplier } from '../src/suppliers/entities/supplier.entity';
import { ProductUnit } from '../src/product-units/entities/product-unit.entity';
import { StockPurchase } from '../src/stock-purchases/entities/stock-purchase.entity';
import { StockPurchaseItem } from '../src/stock-purchases/entities/stock-purchase-item.entity';
import { StockPurchasePayment } from '../src/stock-purchases/entities/stock-purchase-payment.entity';
import { StockPurchasePaymentMethod } from '../src/stock-purchases/enums/stock-purchase-payment-method.enum';
import { AuditLog } from '../src/audit-log/entities/audit-log.entity';
import { AuditAction } from '../src/audit-log/enums/audit-action.enum';
import {
  NO_PROBLEMS,
  reconcileStockLedger,
  reconciliationProblems,
} from './stock-ledger.helper';

type Response = request.Response;

/**
 * POST /stock-purchases with client_request_id (Phase 1 T1c): one id
 * records at most one purchase. A resend from the same user gets the
 * recorded purchase back (200), whatever its body; anyone else's id is 409
 * CLIENT_REQUEST_ID_CONFLICT; a resend sent while the first is still
 * running waits on UQ_stock_purchases_client_request_id and then replays;
 * a request that fails rolls its claim back, so the id can be used again.
 *
 * Every test checks the whole footprint (purchases, lines, units,
 * payments, stock, movements, CREATE audit rows), and that the ledger
 * reconciles.
 *
 * Sessions come from AuthService.login: no HTTP logins.
 */
describe('Stock purchase client_request_id (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await truncateAllTables(app);
    await dataSource.query(`SELECT backfill_stock_opening_balances()`);
  });

  afterAll(async () => {
    await app.close();
  });

  // ---- Seeding ----

  interface Ctx {
    branch: Branch;
    supplier: Supplier;
    manager: User;
    cookies: { admin: string[]; manager: string[]; otherManager: string[] };
    cable: Product;
    phone: Product;
    hub: Product;
  }

  async function seedUser(email: string, role: UserRole, branch: Branch) {
    const users = dataSource.getRepository(User);
    const saved = await users.save(
      users.create({
        email,
        password_hash: await bcrypt.hash('testpass123', 4),
        full_name: email.split('@')[0],
        role,
        is_active: true,
        branch_id: role === UserRole.ADMIN ? null : branch.id,
      }),
    );
    return users.findOneByOrFail({ id: saved.id });
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
    brand: Brand,
    category: Category,
  ) {
    const suffix = Math.random().toString(36).slice(2, 8);
    return dataSource.getRepository(Product).save(
      dataSource.getRepository(Product).create({
        product_type: null,
        name,
        sku: `SKU-IDEM-${suffix}`,
        barcode: `BC-IDEM-${suffix}`,
        brand_id: brand.id,
        category_id: category.id,
        branch_id: null,
        buying_price: '500.00',
        selling_price: '1000.00',
        is_active: true,
        is_serialized: tracking !== TrackingMethod.QUANTITY,
        tracking_method: tracking,
        default_warranty: WarrantyPeriod.MONTH_12,
      }),
    );
  }

  async function setup(): Promise<Ctx> {
    const branch = await dataSource
      .getRepository(Branch)
      .save({ name: 'Main Shop', is_active: true } as Branch);
    const admin = await seedUser('admin@idem.test', UserRole.ADMIN, branch);
    const manager = await seedUser(
      'manager@idem.test',
      UserRole.MANAGER,
      branch,
    );
    const otherManager = await seedUser(
      'other.manager@idem.test',
      UserRole.MANAGER,
      branch,
    );
    const supplier = await dataSource
      .getRepository(Supplier)
      .save({ name: 'Colombo Wholesale', is_active: true } as Supplier);
    const brand = await dataSource
      .getRepository(Brand)
      .save({ name: 'TestBrand', is_active: true } as Brand);
    const category = await dataSource
      .getRepository(Category)
      .save({ name: 'TestCategory', is_active: true } as Category);
    return {
      branch,
      supplier,
      manager,
      cookies: {
        admin: await sessionFor(admin),
        manager: await sessionFor(manager),
        otherManager: await sessionFor(otherManager),
      },
      cable: await seedProduct(
        'UGREEN Cable',
        TrackingMethod.QUANTITY,
        brand,
        category,
      ),
      phone: await seedProduct(
        'iPhone 15 Black',
        TrackingMethod.IMEI,
        brand,
        category,
      ),
      hub: await seedProduct(
        'UGREEN Hub',
        TrackingMethod.SERIAL_NUMBER,
        brand,
        category,
      ),
    };
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

  const postPurchase = (cookies: string[], body: object) =>
    send(
      request(app.getHttpServer())
        .post('/api/v1/stock-purchases')
        .set('Cookie', cookies)
        .send(body),
    );

  /**
   * A purchase of every kind of line: two phones by IMEI, two hubs by
   * serial number, ten cables by quantity, part paid in cash.
   */
  const fullBody = (
    ctx: Ctx,
    clientRequestId: string,
    phoneImeis = ['356938035643810', '356938035643828'],
  ) => ({
    client_request_id: clientRequestId,
    supplier_id: ctx.supplier.id,
    branch_id: ctx.branch.id,
    supplier_invoice_number: 'INV-7781',
    items: [
      {
        product_id: ctx.phone.id,
        quantity: 2,
        unit_buying_price: '150000.00',
        unit_identifiers: phoneImeis.map((imei_number) => ({ imei_number })),
      },
      {
        product_id: ctx.hub.id,
        quantity: 2,
        unit_buying_price: '7000.00',
        unit_identifiers: [
          { serial_number: 'SN-HUB-0001' },
          { serial_number: 'SN-HUB-0002' },
        ],
      },
      { product_id: ctx.cable.id, quantity: 10, unit_buying_price: '400.00' },
    ],
    initial_payment: {
      amount: '50000.00',
      method: StockPurchasePaymentMethod.CASH,
      payment_date: '2026-11-02',
    },
  });

  /** Only cables: no identifiers, so it can be sent again with any id. */
  const cableBody = (ctx: Ctx, clientRequestId: string, quantity = 5) => ({
    client_request_id: clientRequestId,
    supplier_id: ctx.supplier.id,
    branch_id: ctx.branch.id,
    items: [
      { product_id: ctx.cable.id, quantity, unit_buying_price: '400.00' },
    ],
  });

  function expectStatus(res: Response, status: number) {
    if (res.status !== status) {
      throw new Error(
        `Expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`,
      );
    }
  }

  /**
   * Which purchase a response describes: its id and its line and payment
   * ids, sorted (findOne loads the relations in no fixed order).
   */
  const purchaseIdentity = (res: Response) => {
    const body = res.body as {
      id: string;
      items: { id: string }[];
      payments: { id: string }[];
    };
    return {
      id: body.id,
      lineIds: body.items.map((item) => item.id).sort(),
      paymentIds: body.payments.map((payment) => payment.id).sort(),
    };
  };

  // ---- Reads ----

  /**
   * Everything a purchase writes. Waits briefly first, so an audit row
   * written after the response (as the old interceptor did) would be
   * counted too.
   */
  async function footprint() {
    await new Promise((r) => setTimeout(r, 100));
    const stock = await dataSource.getRepository(Stock).find();
    return {
      purchases: await dataSource.getRepository(StockPurchase).count(),
      lines: await dataSource.getRepository(StockPurchaseItem).count(),
      units: await dataSource.getRepository(ProductUnit).count(),
      payments: await dataSource.getRepository(StockPurchasePayment).count(),
      movements: await dataSource.getRepository(StockMovement).count(),
      createAudits: await dataSource.getRepository(AuditLog).count({
        where: { entity_type: 'StockPurchase', action: AuditAction.CREATE },
      }),
      stock: stock.reduce((sum, row) => sum + row.quantity, 0),
    };
  }

  const NOTHING = {
    purchases: 0,
    lines: 0,
    units: 0,
    payments: 0,
    movements: 0,
    createAudits: 0,
    stock: 0,
  };

  /** The footprint of one fullBody purchase. */
  const ONE_FULL_PURCHASE = {
    purchases: 1,
    lines: 3,
    units: 4,
    payments: 1,
    movements: 2 + 2 + 1,
    createAudits: 1,
    stock: 2 + 2 + 10,
  };

  async function expectReconciled() {
    expect(
      reconciliationProblems(await reconcileStockLedger(dataSource)),
    ).toEqual(NO_PROBLEMS);
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

  /** Sessions blocked inserting a purchase row: waiting on the claim. */
  async function claimWaiters(): Promise<number> {
    const rows: { count: number }[] = await dataSource.query(
      `SELECT count(*)::int AS count
         FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'
          AND query ILIKE 'INSERT INTO "stock_purchases"%'
          AND pid <> pg_backend_pid()`,
    );
    return rows[0].count;
  }

  /**
   * Hold a product row FOR UPDATE: a purchase that has to create that
   * product's stock row checks the foreign key (FOR KEY SHARE on the
   * product) and pauses there, after its claim.
   */
  async function holdProduct(product: Product): Promise<QueryRunner> {
    const gate = dataSource.createQueryRunner();
    await gate.connect();
    await gate.startTransaction();
    await gate.query(`SELECT id FROM products WHERE id = $1 FOR UPDATE`, [
      product.id,
    ]);
    return gate;
  }

  async function release(runner: QueryRunner): Promise<void> {
    if (runner.isTransactionActive) await runner.commitTransaction();
    if (!runner.isReleased) await runner.release();
  }

  // ---- Scenario A: the first request ----

  it('records a new purchase once: 201, its lines, units, payment, stock, movements and one CREATE audit row', async () => {
    const ctx = await setup();
    const id = randomUUID();

    const res = await postPurchase(ctx.cookies.manager, fullBody(ctx, id));

    expectStatus(res, 201);
    const body = res.body as { id: string; total_amount: string };
    expect(body.total_amount).toBe('318000.00');
    expect(await footprint()).toEqual(ONE_FULL_PURCHASE);
    const purchase = await dataSource
      .getRepository(StockPurchase)
      .findOneByOrFail({ id: body.id });
    expect(purchase.client_request_id).toBe(id);
    expect(purchase.created_by_id).toBe(ctx.manager.id);

    const audit = await dataSource.getRepository(AuditLog).findOneByOrFail({
      entity_type: 'StockPurchase',
      action: AuditAction.CREATE,
    });
    expect(audit).toMatchObject({
      entity_id: body.id,
      user_id: ctx.manager.id,
      user_name: ctx.manager.full_name,
      user_role: UserRole.MANAGER,
      changes: {
        total_amount: { old: null, new: '318000.00' },
        initial_payment: { old: null, new: '50000.00' },
      },
    });
    expect(audit.description).toContain(purchase.purchase_number);
    expect(audit.ip_address).toBeTruthy();
    await expectReconciled();
  });

  it('refuses a purchase without a client_request_id, or with one that is not a UUID (400), writing nothing', async () => {
    const ctx = await setup();
    const { client_request_id: _omitted, ...withoutId } = cableBody(
      ctx,
      randomUUID(),
    );
    void _omitted;

    const missing = await postPurchase(ctx.cookies.manager, withoutId);
    const invalid = await postPurchase(
      ctx.cookies.manager,
      cableBody(ctx, 'not-a-uuid'),
    );

    for (const res of [missing, invalid]) {
      expectStatus(res, 400);
      expect(JSON.stringify(res.body)).toContain(
        'client_request_id must be a UUID',
      );
    }
    expect(await footprint()).toEqual(NOTHING);
  });

  // ---- Scenario B: the same user resends ----

  it('a resend by the same user returns the recorded purchase (200) and writes nothing', async () => {
    const ctx = await setup();
    const id = randomUUID();
    const first = await postPurchase(ctx.cookies.manager, fullBody(ctx, id));
    expectStatus(first, 201);

    const again = await postPurchase(ctx.cookies.manager, fullBody(ctx, id));

    expectStatus(again, 200);
    expect(purchaseIdentity(again)).toEqual(purchaseIdentity(first));
    expect(await footprint()).toEqual(ONE_FULL_PURCHASE);
    await expectReconciled();
  });

  it('a resend with a different body still returns the original purchase, unchanged', async () => {
    const ctx = await setup();
    const id = randomUUID();
    const first = await postPurchase(ctx.cookies.manager, cableBody(ctx, id));
    expectStatus(first, 201);

    const edited = await postPurchase(ctx.cookies.manager, {
      ...cableBody(ctx, id, 50),
      notes: 'Edited before resending',
      initial_payment: {
        amount: '100.00',
        method: StockPurchasePaymentMethod.CASH,
        payment_date: '2026-11-02',
      },
    });

    expectStatus(edited, 200);
    const body = edited.body as {
      id: string;
      total_amount: string;
      notes: string | null;
      items: { quantity: number }[];
      payments: unknown[];
    };
    expect(body.id).toBe((first.body as { id: string }).id);
    expect(body.total_amount).toBe('2000.00');
    expect(body.notes).toBeNull();
    expect(body.items.map((item) => item.quantity)).toEqual([5]);
    expect(body.payments).toEqual([]);
    expect(await footprint()).toEqual({
      purchases: 1,
      lines: 1,
      units: 0,
      payments: 0,
      movements: 1,
      createAudits: 1,
      stock: 5,
    });
    await expectReconciled();
  });

  // ---- Scenario C: another user's request id ----

  it("another user's request id is 409 CLIENT_REQUEST_ID_CONFLICT, revealing nothing and writing nothing", async () => {
    const ctx = await setup();
    const id = randomUUID();
    const first = await postPurchase(ctx.cookies.manager, fullBody(ctx, id));
    expectStatus(first, 201);
    const recorded = first.body as { id: string; purchase_number: string };

    for (const cookies of [ctx.cookies.otherManager, ctx.cookies.admin]) {
      const res = await postPurchase(cookies, fullBody(ctx, id));

      expectStatus(res, 409);
      expect(res.body).toMatchObject({ code: 'CLIENT_REQUEST_ID_CONFLICT' });
      const text = JSON.stringify(res.body);
      for (const secret of [
        recorded.id,
        recorded.purchase_number,
        ctx.manager.id,
        ctx.supplier.name,
      ]) {
        expect(text).not.toContain(secret);
      }
    }
    expect(await footprint()).toEqual(ONE_FULL_PURCHASE);
    await expectReconciled();
  });

  // ---- Scenario D: a resend while the first is still running ----

  it('a simultaneous resend waits on the claim, then replays: one 201, one 200, one purchase (with IMEI and serial lines)', async () => {
    const ctx = await setup();
    const id = randomUUID();

    // The first request claims the id, then pauses creating the phone's
    // stock row. Before T1c the resend would have waited on the hub's
    // serial-number lock and failed as "already received"; now it waits
    // on the claim and is answered from the recorded purchase.
    const gate = await holdProduct(ctx.phone);
    const pending: Promise<Response>[] = [];
    let responses: Response[];
    try {
      pending.push(postPurchase(ctx.cookies.manager, fullBody(ctx, id)));
      await waitForLockWaiters(1);
      pending.push(postPurchase(ctx.cookies.manager, fullBody(ctx, id)));
      await waitForLockWaiters(2);
      expect(await claimWaiters()).toBe(1);
      await release(gate);
      responses = await Promise.all(pending);
    } finally {
      await release(gate);
      await Promise.allSettled(pending);
    }

    expect(responses.map((r) => r.status)).toEqual([201, 200]);
    expect(purchaseIdentity(responses[1])).toEqual(
      purchaseIdentity(responses[0]),
    );
    expect(await footprint()).toEqual(ONE_FULL_PURCHASE);
    await expectReconciled();
    // Longer than its two 10 s lock-wait loops, so a stuck wait reports
    // its own message instead of Jest's timeout.
  }, 30_000);

  it('a simultaneous request by another user with the same id waits on the claim, then gets 409', async () => {
    const ctx = await setup();
    const id = randomUUID();

    const gate = await holdProduct(ctx.cable);
    const pending: Promise<Response>[] = [];
    let responses: Response[];
    try {
      pending.push(postPurchase(ctx.cookies.manager, cableBody(ctx, id)));
      await waitForLockWaiters(1);
      pending.push(postPurchase(ctx.cookies.otherManager, cableBody(ctx, id)));
      await waitForLockWaiters(2);
      expect(await claimWaiters()).toBe(1);
      await release(gate);
      responses = await Promise.all(pending);
    } finally {
      await release(gate);
      await Promise.allSettled(pending);
    }

    expect(responses.map((r) => r.status)).toEqual([201, 409]);
    expect(responses[1].body).toMatchObject({
      code: 'CLIENT_REQUEST_ID_CONFLICT',
    });
    expect(await dataSource.getRepository(StockPurchase).count()).toBe(1);
    await expectReconciled();
  });

  it('when the first request fails after its claim, a simultaneous resend with the same id goes ahead', async () => {
    const ctx = await setup();
    const id = randomUUID();

    // The first request's total is too large: it claims the id, pauses
    // creating the cable's stock row, then fails adding its line and rolls
    // back. The resend (corrected) was waiting on the claim, and proceeds.
    const gate = await holdProduct(ctx.cable);
    const pending: Promise<Response>[] = [];
    let responses: Response[];
    try {
      pending.push(
        postPurchase(ctx.cookies.manager, {
          ...cableBody(ctx, id, 1_000_000),
          items: [
            {
              product_id: ctx.cable.id,
              quantity: 1_000_000,
              unit_buying_price: '99999999.99',
            },
          ],
        }),
      );
      await waitForLockWaiters(1);
      pending.push(postPurchase(ctx.cookies.manager, cableBody(ctx, id, 5)));
      await waitForLockWaiters(2);
      expect(await claimWaiters()).toBe(1);
      await release(gate);
      responses = await Promise.all(pending);
    } finally {
      await release(gate);
      await Promise.allSettled(pending);
    }

    expect(responses.map((r) => r.status)).toEqual([400, 201]);
    expect(JSON.stringify(responses[0].body)).toContain(
      'The purchase total is too large.',
    );
    const purchase = await dataSource
      .getRepository(StockPurchase)
      .findOneByOrFail({ client_request_id: id });
    expect(purchase.id).toBe((responses[1].body as { id: string }).id);
    expect(await footprint()).toEqual({
      purchases: 1,
      lines: 1,
      units: 0,
      payments: 0,
      movements: 1,
      createAudits: 1,
      stock: 5,
    });
    await expectReconciled();
  });

  // ---- Scenario E: a failed request, then a retry ----

  it('a request that fails after its claim keeps nothing, and the same id then records the corrected purchase', async () => {
    const ctx = await setup();
    // A phone already in stock with this IMEI.
    expectStatus(
      await postPurchase(ctx.cookies.manager, {
        client_request_id: randomUUID(),
        supplier_id: ctx.supplier.id,
        branch_id: ctx.branch.id,
        items: [
          {
            product_id: ctx.phone.id,
            quantity: 1,
            unit_buying_price: '150000.00',
            unit_identifiers: [{ imei_number: '356938035643810' }],
          },
        ],
      }),
      201,
    );
    const before = await footprint();

    // fullBody repeats that IMEI: refused by the live-identifier check,
    // which runs after the claim, so everything rolls back.
    const id = randomUUID();
    const failed = await postPurchase(ctx.cookies.manager, fullBody(ctx, id));
    expectStatus(failed, 409);
    expect(JSON.stringify(failed.body)).not.toContain(
      'CLIENT_REQUEST_ID_CONFLICT',
    );
    expect(await footprint()).toEqual(before);
    expect(
      await dataSource
        .getRepository(StockPurchase)
        .countBy({ client_request_id: id }),
    ).toBe(0);

    // Corrected: a different IMEI. The same id is free again.
    const retried = await postPurchase(
      ctx.cookies.manager,
      fullBody(ctx, id, ['356938035643836', '356938035643828']),
    );

    expectStatus(retried, 201);
    expect(await footprint()).toEqual({
      purchases: before.purchases + 1,
      lines: before.lines + 3,
      units: before.units + 4,
      payments: before.payments + 1,
      movements: before.movements + 5,
      createAudits: before.createAudits + 1,
      stock: before.stock + 14,
    });
    await expectReconciled();
  });

  // ---- Scenario F: new ids ----

  it('two different request ids record two purchases', async () => {
    const ctx = await setup();

    const first = await postPurchase(
      ctx.cookies.manager,
      cableBody(ctx, randomUUID()),
    );
    const second = await postPurchase(
      ctx.cookies.manager,
      cableBody(ctx, randomUUID()),
    );

    expectStatus(first, 201);
    expectStatus(second, 201);
    expect((second.body as { id: string }).id).not.toBe(
      (first.body as { id: string }).id,
    );
    expect(await footprint()).toEqual({
      purchases: 2,
      lines: 2,
      units: 0,
      payments: 0,
      movements: 2,
      createAudits: 2,
      stock: 10,
    });
    await expectReconciled();
  });
});
