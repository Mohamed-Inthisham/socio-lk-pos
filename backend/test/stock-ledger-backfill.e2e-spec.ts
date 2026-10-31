import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { DataSource, QueryFailedError, QueryRunner } from 'typeorm';
import { createTestApp, truncateAllTables } from './setup';
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
import { StockMovementType } from '../src/stock/enums/stock-movement-type.enum';
import { StockLedgerBackfill } from '../src/stock/entities/stock-ledger-backfill.entity';
import {
  NO_PROBLEMS,
  reconcileStockLedger,
  reconciliationProblems,
} from './stock-ledger.helper';

/**
 * The opening-balance backfill (Phase 1 T1b,
 * BackfillStockOpeningBalances): backfill_stock_opening_balances() and
 * its completion marker, against the real database.
 *
 * The migration ran once on this database; the e2e reset empties the
 * ledger and the marker, so each test calls the function itself on the
 * stock it seeded. Lock interleavings are forced with separate
 * connections and observed through pg_stat_activity, never sleeps.
 *
 * No HTTP: nothing here logs in.
 */
describe('Stock ledger backfill (e2e)', () => {
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
    user: User;
    cable: Stock;
    phone: Stock;
    empty: Stock;
    untracked: Stock;
  }

  async function seedProduct(name: string, brand: Brand, category: Category) {
    const suffix = Math.random().toString(36).slice(2, 8);
    return dataSource.getRepository(Product).save(
      dataSource.getRepository(Product).create({
        product_type: null,
        name,
        sku: `SKU-BF-${suffix}`,
        barcode: `BC-BF-${suffix}`,
        brand_id: brand.id,
        category_id: category.id,
        branch_id: null,
        buying_price: '500.00',
        selling_price: '1000.00',
        is_active: true,
        is_serialized: false,
        tracking_method: TrackingMethod.QUANTITY,
        default_warranty: WarrantyPeriod.NO_WARRANTY,
      }),
    );
  }

  /** Four stock rows, as a shop has them before go-live. */
  async function setup(): Promise<Ctx> {
    const branch = await dataSource
      .getRepository(Branch)
      .save({ name: 'Main Shop', is_active: true } as Branch);
    const users = dataSource.getRepository(User);
    const user = await users.save(
      users.create({
        email: 'admin@backfill.test',
        password_hash: await bcrypt.hash('testpass123', 4),
        full_name: 'Admin',
        role: UserRole.ADMIN,
        is_active: true,
        branch_id: null,
      }),
    );
    const brand = await dataSource
      .getRepository(Brand)
      .save({ name: 'TestBrand', is_active: true } as Brand);
    const category = await dataSource
      .getRepository(Category)
      .save({ name: 'TestCategory', is_active: true } as Category);
    const row = async (name: string, quantity: number, manage_stock = true) =>
      dataSource.getRepository(Stock).save(
        dataSource.getRepository(Stock).create({
          product_id: (await seedProduct(name, brand, category)).id,
          branch_id: branch.id,
          quantity,
          min_quantity: 0,
          manage_stock,
        }),
      );
    return {
      branch,
      user,
      cable: await row('UGREEN Cable', 10),
      phone: await row('iPhone 15 Black', 2),
      empty: await row('UGREEN Hub', 0),
      untracked: await row('Reload card', 7, false),
    };
  }

  const backfill = (lockWait?: string) =>
    dataSource.query<{ inserted: number }[]>(
      lockWait === undefined
        ? `SELECT backfill_stock_opening_balances() AS inserted`
        : `SELECT backfill_stock_opening_balances($1::interval) AS inserted`,
      lockWait === undefined ? [] : [lockWait],
    );

  const movements = () =>
    dataSource.getRepository(StockMovement).find({ order: { seq: 'ASC' } });

  const marker = () => dataSource.getRepository(StockLedgerBackfill).find();

  /** A ledger row inserted straight into the table (valid unless changed). */
  function insertMovement(stock: Stock, overrides: Record<string, unknown>) {
    const row: Record<string, unknown> = {
      product_id: stock.product_id,
      branch_id: stock.branch_id,
      movement_type: 'SALE',
      quantity_delta: -1,
      quantity_before: stock.quantity,
      quantity_after: stock.quantity - 1,
      stock_managed: true,
      reference_type: 'SALE_LINE',
      reference_id: randomUUID(),
      created_by_id: null,
      ...overrides,
    };
    const columns = Object.keys(row);
    return dataSource.query<{ id: string }[]>(
      `INSERT INTO stock_movements (${columns.map((c) => `"${c}"`).join(', ')})
       VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      Object.values(row),
    );
  }

  const opening = (stock: Stock, overrides: Record<string, unknown> = {}) =>
    insertMovement(stock, {
      movement_type: 'OPENING_BALANCE',
      quantity_delta: stock.quantity,
      quantity_before: 0,
      quantity_after: stock.quantity,
      reference_type: 'STOCK',
      reference_id: stock.id,
      ...overrides,
    });

  async function refusal(promise: Promise<unknown>): Promise<string> {
    const err = await promise.then(
      () => {
        throw new Error('Expected the backfill to refuse');
      },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(QueryFailedError);
    return (err as Error).message;
  }

  /** Wait until `n` other sessions are blocked on a lock (10 s at most). */
  async function waitForLockWaiters(n: number): Promise<void> {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const rows: { count: number }[] = await dataSource.query(
        `SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND pid <> pg_backend_pid()`,
      );
      if (rows[0].count >= n) return;
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for ${n} lock waiter(s)`);
      }
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  async function runner(): Promise<QueryRunner> {
    const r = dataSource.createQueryRunner();
    await r.connect();
    await r.startTransaction();
    return r;
  }

  async function finish(r: QueryRunner): Promise<void> {
    if (r.isTransactionActive) await r.commitTransaction();
    if (!r.isReleased) await r.release();
  }

  // ---- First run and re-runs ----

  it('first run: one opening per stock row, zero and untracked rows included, then the marker', async () => {
    const ctx = await setup();

    const [{ inserted }] = await backfill();

    expect(inserted).toBe(4);
    const rows = await movements();
    expect(
      rows.map((m) => ({
        ref: m.reference_id,
        type: m.movement_type,
        delta: m.quantity_delta,
        before: m.quantity_before,
        after: m.quantity_after,
        managed: m.stock_managed,
        unit: m.product_unit_id,
        by: m.created_by_id,
        ref_type: m.reference_type,
      })),
    ).toEqual(
      expect.arrayContaining(
        [
          [ctx.cable, 10, true],
          [ctx.phone, 2, true],
          [ctx.empty, 0, true],
          [ctx.untracked, 7, false],
        ].map(([stock, qty, managed]) => ({
          ref: (stock as Stock).id,
          type: 'OPENING_BALANCE',
          delta: qty,
          before: 0,
          after: qty,
          managed,
          unit: null,
          by: null,
          ref_type: 'STOCK',
        })),
      ),
    );
    expect(rows).toHaveLength(4);
    expect(await marker()).toEqual([
      expect.objectContaining({ stock_rows: 4, opening_rows: 4 }),
    ]);
    // Stock itself is untouched.
    const stock = await dataSource.getRepository(Stock).find();
    expect(stock.map((s) => s.quantity).sort((a, b) => a - b)).toEqual([
      0, 2, 7, 10,
    ]);
    expect(
      reconciliationProblems(await reconcileStockLedger(dataSource)),
    ).toEqual(NO_PROBLEMS);
  });

  it('a re-run, before or after trading, does nothing; rows created after go-live get no opening', async () => {
    const ctx = await setup();
    await backfill();
    expect((await backfill())[0].inserted).toBe(0);

    // Go-live: a sale on the cable row, and a new stock row.
    await insertMovement(ctx.cable, {
      created_by_id: ctx.user.id,
      quantity_before: 10,
      quantity_after: 9,
    });
    await dataSource.getRepository(Stock).update(ctx.cable.id, { quantity: 9 });
    const product = await dataSource
      .getRepository(Product)
      .findOneByOrFail({ id: ctx.empty.product_id });
    const later = await dataSource.getRepository(Stock).save(
      dataSource.getRepository(Stock).create({
        product_id: product.id,
        branch_id: (
          await dataSource
            .getRepository(Branch)
            .save({ name: 'Second Shop', is_active: true } as Branch)
        ).id,
        quantity: 0,
        min_quantity: 0,
        manage_stock: true,
      }),
    );
    const count = (await movements()).length;

    expect((await backfill())[0].inserted).toBe(0);

    expect(await movements()).toHaveLength(count);
    expect((await movements()).some((m) => m.reference_id === later.id)).toBe(
      false,
    );
    expect(await marker()).toEqual([
      expect.objectContaining({ stock_rows: 4, opening_rows: 4 }),
    ]);
  });

  it('a partial older run: keeps the valid first openings and adds the missing ones', async () => {
    const ctx = await setup();
    await opening(ctx.cable);
    await opening(ctx.phone);

    const [{ inserted }] = await backfill();

    expect(inserted).toBe(2);
    const openings = (await movements()).filter(
      (m) => m.movement_type === StockMovementType.OPENING_BALANCE,
    );
    expect(openings.map((m) => m.reference_id).sort()).toEqual(
      [ctx.cable, ctx.phone, ctx.empty, ctx.untracked].map((s) => s.id).sort(),
    );
    expect(await marker()).toEqual([
      expect.objectContaining({ stock_rows: 4, opening_rows: 4 }),
    ]);
  });

  // ---- Refusals: nothing written, no marker ----

  it('refuses a stock row that already has movements without an opening', async () => {
    const ctx = await setup();
    await insertMovement(ctx.cable, { created_by_id: ctx.user.id });

    const message = await refusal(backfill());

    expect(message).toBe(
      `Opening-balance backfill refused: stock rows ${ctx.cable.id} already have movements without an opening balance`,
    );
    expect(await movements()).toHaveLength(1);
    expect(await marker()).toEqual([]);
  });

  it('refuses an opening that comes after another movement of its row', async () => {
    const ctx = await setup();
    await insertMovement(ctx.cable, { created_by_id: ctx.user.id });
    await opening(ctx.cable);

    const message = await refusal(backfill());

    expect(message).toBe(
      `Opening-balance backfill refused: stock rows ${ctx.cable.id} have an opening balance after other movements`,
    );
    expect(await movements()).toHaveLength(2);
    expect(await marker()).toEqual([]);
  });

  it.each([
    [
      'a reference to another stock row',
      (c: Ctx) => ({ reference_id: c.phone.id }),
    ],
    ['a non-STOCK reference', () => ({ reference_type: 'STOCK_ADJUSTMENT' })],
    [
      'a non-zero before',
      (c: Ctx) => ({
        quantity_before: 5,
        quantity_after: 5 + c.cable.quantity,
      }),
    ],
  ])(
    'refuses an opening that is not its stock row valid opening: %s',
    async (_name, change) => {
      const ctx = await setup();
      const [{ id }] = await opening(ctx.cable, change(ctx));

      const message = await refusal(backfill());

      expect(message).toBe(
        `Opening-balance backfill refused: opening movements ${id} do not belong to a stock row`,
      );
      expect(await movements()).toHaveLength(1);
      expect(await marker()).toEqual([]);
    },
  );

  // ---- lock_wait ----

  it.each([['0'], ['-1 second'], ['0.5 milliseconds']])(
    'refuses lock_wait %s (it must be at least 1 ms)',
    async (lockWait) => {
      await setup();
      const message = await refusal(backfill(lockWait));
      expect(message).toMatch(
        /^lock_wait must be a positive interval of at least 1 millisecond/,
      );
      expect(await marker()).toEqual([]);
    },
  );

  it('refuses a null lock_wait', async () => {
    await setup();
    const message = await refusal(
      dataSource.query(`SELECT backfill_stock_opening_balances(NULL)`),
    );
    expect(message).toMatch(/^lock_wait must be a positive interval/);
  });

  it('gives up with a lock timeout while a stock transaction holds its row', async () => {
    const ctx = await setup();
    const gate = await runner();
    try {
      await gate.query(`SELECT id FROM stock WHERE id = $1 FOR UPDATE`, [
        ctx.cable.id,
      ]);

      const message = await refusal(backfill('200 milliseconds'));

      expect(message).toMatch(/lock timeout/i);
    } finally {
      await finish(gate);
    }
    expect(await movements()).toEqual([]);
    expect(await marker()).toEqual([]);
  });

  // ---- Lock order with a running stock transaction ----

  it('a running stock transaction that already wrote the ledger finishes first, then the backfill: no deadlock', async () => {
    const ctx = await setup();
    await backfill(); // completed: the next call returns 0 after its locks

    // A return-shaped transaction: locks the stock row, writes a ledger
    // row, and only then updates stock (asking for ROW EXCLUSIVE).
    const tx = await runner();
    let pending: Promise<{ inserted: number }[]> | undefined;
    try {
      await tx.query(`SELECT id FROM stock WHERE id = $1 FOR UPDATE`, [
        ctx.cable.id,
      ]);
      await tx.query(
        `INSERT INTO stock_movements (product_id, branch_id, movement_type,
           quantity_delta, quantity_before, quantity_after, stock_managed,
           reference_type, reference_id, created_by_id)
         VALUES ($1, $2, 'SALE', -1, 10, 9, true, 'SALE_LINE', $3, $4)`,
        [ctx.cable.product_id, ctx.cable.branch_id, randomUUID(), ctx.user.id],
      );
      pending = backfill();
      await waitForLockWaiters(1);
      // The backfill waits for EXCLUSIVE on stock. Asking for ROW
      // EXCLUSIVE now conflicts only with that waiting request; Postgres
      // lets the lock holder go first instead of deadlocking.
      await tx.query(`UPDATE stock SET quantity = 9 WHERE id = $1`, [
        ctx.cable.id,
      ]);
      await tx.commitTransaction();

      expect((await pending)[0].inserted).toBe(0);
    } finally {
      await finish(tx);
      if (pending) await Promise.allSettled([pending]);
    }
    expect(
      reconciliationProblems(await reconcileStockLedger(dataSource)),
    ).toEqual(NO_PROBLEMS);
  });

  it('while the backfill holds its locks, stock writers queue and plain reads continue', async () => {
    const ctx = await setup();
    const held = await runner();
    let writer: Promise<unknown> | undefined;
    try {
      // The backfill inside a transaction that hasn't committed yet.
      await held.query(`SELECT backfill_stock_opening_balances()`);

      writer = dataSource.query(
        `UPDATE stock SET min_quantity = 1 WHERE id = $1`,
        [ctx.cable.id],
      );
      await waitForLockWaiters(1);
      const read: { quantity: number }[] = await dataSource.query(
        `SELECT quantity FROM stock WHERE id = $1`,
        [ctx.cable.id],
      );
      expect(read[0].quantity).toBe(10);

      await held.commitTransaction();
      await writer;
    } finally {
      await finish(held);
      if (writer) await Promise.allSettled([writer]);
    }
    expect(
      (
        await dataSource
          .getRepository(Stock)
          .findOneByOrFail({ id: ctx.cable.id })
      ).min_quantity,
    ).toBe(1);
    expect(await marker()).toHaveLength(1);
  });

  // ---- The marker is immutable ----

  it('refuses UPDATE, DELETE and an unflagged TRUNCATE of the marker; the e2e reset clears it', async () => {
    await setup();
    await backfill();

    for (const sql of [
      `UPDATE stock_ledger_backfill SET stock_rows = 0`,
      `DELETE FROM stock_ledger_backfill`,
      `TRUNCATE stock_ledger_backfill`,
    ]) {
      const message = await refusal(dataSource.query(sql));
      expect(message).toMatch(/^stock_ledger_backfill is immutable: /);
    }
    expect(await marker()).toHaveLength(1);

    await truncateAllTables(app);

    expect(await marker()).toEqual([]);
  });
});
