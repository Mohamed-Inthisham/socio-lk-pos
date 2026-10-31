import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { DataSource, QueryFailedError } from 'typeorm';
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
import { StockService } from '../src/stock/stock.service';
import {
  StockMovementReferenceType,
  StockMovementType,
} from '../src/stock/enums/stock-movement-type.enum';
import { ProductUnit } from '../src/product-units/entities/product-unit.entity';
import { ProductUnitStatus } from '../src/product-units/enums/product-unit-status.enum';

/**
 * The stock movement ledger's foundation (Phase 1 T1a): the table, its
 * constraints and append-only trigger (CreateStockMovements), and
 * StockService's writer, against the real database. No caller passes a
 * movement yet (T1b), so the writer is driven here directly, inside
 * transactions as the business services will.
 *
 * No HTTP: nothing here logs in.
 */
describe('Stock movement ledger (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let stockService: StockService;

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
    stockService = app.get(StockService);
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
    cashier: User;
    manager: User;
    cable: Product;
    phone: Product;
    cableStock: Stock;
    phoneStock: Stock;
  }

  async function seedUser(email: string, role: UserRole, branch: Branch) {
    const users = dataSource.getRepository(User);
    return users.save(
      users.create({
        email,
        password_hash: await bcrypt.hash('testpass123', 4),
        full_name: email,
        role,
        is_active: true,
        branch_id: branch.id,
      }),
    );
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
        sku: `SKU-LEDGER-${suffix}`,
        barcode: `BC-LEDGER-${suffix}`,
        brand_id: brand.id,
        category_id: category.id,
        branch_id: null,
        buying_price: '500.00',
        selling_price: '1000.00',
        is_active: true,
        is_serialized: tracking !== TrackingMethod.QUANTITY,
        tracking_method: tracking,
        default_warranty: WarrantyPeriod.NO_WARRANTY,
      }),
    );
  }

  async function seedStock(
    product: Product,
    branch: Branch,
    quantity: number,
    manage_stock = true,
  ) {
    return dataSource.getRepository(Stock).save(
      dataSource.getRepository(Stock).create({
        product_id: product.id,
        branch_id: branch.id,
        quantity,
        min_quantity: 0,
        manage_stock,
      }),
    );
  }

  async function seedUnit(
    ctx: Ctx,
    imei: string,
    status = ProductUnitStatus.IN_STOCK,
  ) {
    return dataSource.getRepository(ProductUnit).save(
      dataSource.getRepository(ProductUnit).create({
        product_id: ctx.phone.id,
        branch_id: ctx.branch.id,
        imei,
        imei_number: imei,
        status,
        buying_price: '500.00',
        selling_price: null,
        phone_purchase_id: null,
      }),
    );
  }

  async function setup(): Promise<Ctx> {
    const branch = await dataSource
      .getRepository(Branch)
      .save({ name: 'Main Shop', is_active: true } as Branch);
    const brand = await dataSource
      .getRepository(Brand)
      .save({ name: 'TestBrand', is_active: true } as Brand);
    const category = await dataSource
      .getRepository(Category)
      .save({ name: 'TestCategory', is_active: true } as Category);
    const cashier = await seedUser(
      'cashier@ledger.test',
      UserRole.CASHIER,
      branch,
    );
    const manager = await seedUser(
      'manager@ledger.test',
      UserRole.MANAGER,
      branch,
    );
    const cable = await seedProduct(
      'UGREEN Cable',
      TrackingMethod.QUANTITY,
      brand,
      category,
    );
    const phone = await seedProduct(
      'iPhone 15 Black',
      TrackingMethod.IMEI,
      brand,
      category,
    );
    const cableStock = await seedStock(cable, branch, 10);
    const phoneStock = await seedStock(phone, branch, 1);
    return { branch, cashier, manager, cable, phone, cableStock, phoneStock };
  }

  const movements = () =>
    dataSource.getRepository(StockMovement).find({ order: { seq: 'ASC' } });

  const stockQty = async (stock: Stock) =>
    (await dataSource.getRepository(Stock).findOneByOrFail({ id: stock.id }))
      .quantity;

  /** The error a promise rejects with (fails the test if it resolves). */
  async function failure(promise: Promise<unknown>): Promise<QueryFailedError> {
    const err = await promise.then(
      () => {
        throw new Error('Expected the database to refuse this');
      },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(QueryFailedError);
    return err as QueryFailedError;
  }

  const constraintOf = (err: QueryFailedError) =>
    (err.driverError as { constraint?: string }).constraint;

  const sale = (ctx: Ctx, referenceId: string = randomUUID()) => ({
    type: StockMovementType.SALE,
    referenceType: StockMovementReferenceType.SALE_LINE,
    referenceId,
    createdById: ctx.cashier.id,
  });

  /**
   * A ledger row inserted straight into the table: a valid quantity-only
   * SALE of 1 from 10, unless `overrides` changes a column.
   */
  function insertRaw(ctx: Ctx, overrides: Record<string, unknown> = {}) {
    const row: Record<string, unknown> = {
      product_id: ctx.cable.id,
      branch_id: ctx.branch.id,
      product_unit_id: null,
      movement_type: 'SALE',
      quantity_delta: -1,
      quantity_before: 10,
      quantity_after: 9,
      stock_managed: true,
      unit_status_from: null,
      unit_status_to: null,
      reason_code: null,
      reference_type: 'SALE_LINE',
      reference_id: randomUUID(),
      reverses_movement_id: null,
      created_by_id: ctx.cashier.id,
      approved_by_id: null,
      ...overrides,
    };
    const columns = Object.keys(row);
    return dataSource.query(
      `INSERT INTO stock_movements (${columns.map((c) => `"${c}"`).join(', ')})
       VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})
       RETURNING id`,
      Object.values(row),
    );
  }

  // ---- The writer, through StockService ----

  it('a sale records one SALE row with the locked quantity as before, in the same transaction', async () => {
    const ctx = await setup();

    await dataSource.transaction((manager) =>
      stockService.decrementForSale(
        manager,
        ctx.cable.id,
        ctx.branch.id,
        3,
        ctx.cable.name,
        sale(ctx),
      ),
    );

    expect(await stockQty(ctx.cableStock)).toBe(7);
    const rows = await movements();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      product_id: ctx.cable.id,
      branch_id: ctx.branch.id,
      product_unit_id: null,
      movement_type: StockMovementType.SALE,
      quantity_delta: -3,
      quantity_before: 10,
      quantity_after: 7,
      stock_managed: true,
      reference_type: StockMovementReferenceType.SALE_LINE,
      created_by_id: ctx.cashier.id,
      approved_by_id: null,
    });
    expect(rows[0].seq).toMatch(/^\d+$/);
  });

  it('a phone sale records the stock change and the unit status change in one row', async () => {
    const ctx = await setup();
    const unit = await seedUnit(ctx, '356938035643809');

    await dataSource.transaction((manager) =>
      stockService.decrementForSale(
        manager,
        ctx.phone.id,
        ctx.branch.id,
        1,
        ctx.phone.name,
        {
          ...sale(ctx),
          unit: {
            id: unit.id,
            from: ProductUnitStatus.IN_STOCK,
            to: ProductUnitStatus.SOLD,
          },
        },
      ),
    );

    const rows = await movements();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      product_unit_id: unit.id,
      quantity_delta: -1,
      quantity_before: 1,
      quantity_after: 0,
      unit_status_from: ProductUnitStatus.IN_STOCK,
      unit_status_to: ProductUnitStatus.SOLD,
    });
  });

  it('a stock purchase records one row per unit and one for the rest, chained', async () => {
    const ctx = await setup();
    const a = await seedUnit(ctx, '356938035643809');
    const b = await seedUnit(ctx, '490154203237518');
    const itemId = randomUUID();

    await dataSource.transaction((manager) =>
      stockService.receivePurchase(manager, ctx.phone.id, ctx.branch.id, 3, {
        type: StockMovementType.PURCHASE,
        referenceType: StockMovementReferenceType.STOCK_PURCHASE_ITEM,
        referenceId: itemId,
        createdById: ctx.manager.id,
        unitIds: [a.id, b.id],
      }),
    );

    expect(await stockQty(ctx.phoneStock)).toBe(4);
    const rows = await movements();
    expect(
      rows.map((r) => [
        r.product_unit_id,
        r.quantity_delta,
        r.quantity_before,
        r.quantity_after,
        r.unit_status_to,
      ]),
    ).toEqual([
      [a.id, 1, 1, 2, ProductUnitStatus.IN_STOCK],
      [b.id, 1, 2, 3, ProductUnitStatus.IN_STOCK],
      [null, 1, 3, 4, null],
    ]);
  });

  it('a status-only unit event records delta 0 with the stock quantity as before and after', async () => {
    const ctx = await setup();
    const unit = await seedUnit(ctx, '356938035643809', ProductUnitStatus.SOLD);

    await dataSource.transaction((manager) =>
      stockService.recordUnitEvent(manager, ctx.phone.id, ctx.branch.id, {
        type: StockMovementType.CUSTOMER_RETURN,
        referenceType: StockMovementReferenceType.SALE_RETURN_LINE,
        referenceId: randomUUID(),
        createdById: ctx.cashier.id,
        approvedById: ctx.manager.id,
        unit: {
          id: unit.id,
          from: ProductUnitStatus.SOLD,
          to: ProductUnitStatus.INSPECTION,
        },
      }),
    );

    expect(await stockQty(ctx.phoneStock)).toBe(1);
    expect(await movements()).toEqual([
      expect.objectContaining({
        movement_type: StockMovementType.CUSTOMER_RETURN,
        quantity_delta: 0,
        quantity_before: 1,
        quantity_after: 1,
        unit_status_from: ProductUnitStatus.SOLD,
        unit_status_to: ProductUnitStatus.INSPECTION,
        created_by_id: ctx.cashier.id,
        approved_by_id: ctx.manager.id,
      }),
    ]);
  });

  it('on an untracked stock row a unit event is recorded with delta 0 and stock_managed false', async () => {
    const ctx = await setup();
    await dataSource
      .getRepository(Stock)
      .update(ctx.phoneStock.id, { manage_stock: false });
    const unit = await seedUnit(ctx, '356938035643809');

    await dataSource.transaction((manager) =>
      stockService.decrementForSale(
        manager,
        ctx.phone.id,
        ctx.branch.id,
        1,
        ctx.phone.name,
        {
          ...sale(ctx),
          unit: {
            id: unit.id,
            from: ProductUnitStatus.IN_STOCK,
            to: ProductUnitStatus.SOLD,
          },
        },
      ),
    );

    expect(await stockQty(ctx.phoneStock)).toBe(1);
    expect(await movements()).toEqual([
      expect.objectContaining({
        quantity_delta: 0,
        quantity_before: 1,
        quantity_after: 1,
        stock_managed: false,
        unit_status_to: ProductUnitStatus.SOLD,
      }),
    ]);
  });

  it('a rolled-back transaction leaves neither the stock change nor its ledger row', async () => {
    const ctx = await setup();

    await expect(
      dataSource.transaction(async (manager) => {
        await stockService.decrementForSale(
          manager,
          ctx.cable.id,
          ctx.branch.id,
          2,
          ctx.cable.name,
          sale(ctx),
        );
        throw new Error('a later step failed');
      }),
    ).rejects.toThrow('a later step failed');

    expect(await stockQty(ctx.cableStock)).toBe(10);
    expect(await movements()).toEqual([]);
  });

  it('a refused ledger row rolls back the stock change it records', async () => {
    const ctx = await setup();
    const referenceId = randomUUID();
    await insertRaw(ctx, { reference_id: referenceId });

    // The same sale line again: the unique index refuses the row, and the
    // decrement made just before it in the transaction goes with it.
    await failure(
      dataSource.transaction((manager) =>
        stockService.decrementForSale(
          manager,
          ctx.cable.id,
          ctx.branch.id,
          1,
          ctx.cable.name,
          sale(ctx, referenceId),
        ),
      ),
    );

    expect(await stockQty(ctx.cableStock)).toBe(10);
    expect(await movements()).toHaveLength(1);
  });

  it('concurrent sales of one stock row leave an unbroken chain', async () => {
    const ctx = await setup();

    await Promise.all(
      [1, 2, 3].map((qty) =>
        dataSource.transaction((manager) =>
          stockService.decrementForSale(
            manager,
            ctx.cable.id,
            ctx.branch.id,
            qty,
            ctx.cable.name,
            sale(ctx),
          ),
        ),
      ),
    );

    const rows = await movements();
    expect(rows).toHaveLength(3);
    expect(rows[0].quantity_before).toBe(10);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].quantity_before).toBe(rows[i - 1].quantity_after);
    }
    expect(rows[rows.length - 1].quantity_after).toBe(4);
    expect(await stockQty(ctx.cableStock)).toBe(4);
  });

  // ---- Append-only ----

  it('refuses UPDATE and DELETE of a ledger row', async () => {
    const ctx = await setup();
    const [{ id }] = (await insertRaw(ctx)) as { id: string }[];

    const update = await failure(
      dataSource.query(
        `UPDATE stock_movements SET note = 'edited' WHERE id = $1`,
        [id],
      ),
    );
    expect(update.message).toBe(
      'stock_movements is append-only: UPDATE is not allowed',
    );
    const del = await failure(
      dataSource.query(`DELETE FROM stock_movements WHERE id = $1`, [id]),
    );
    expect(del.message).toBe(
      'stock_movements is append-only: DELETE is not allowed',
    );
    expect(await movements()).toHaveLength(1);
  });

  it('refuses TRUNCATE unless the transaction sets the reset flag, and the flag ends with it', async () => {
    const ctx = await setup();
    await insertRaw(ctx);

    const plain = await failure(dataSource.query(`TRUNCATE stock_movements`));
    expect(plain.message).toBe(
      'stock_movements is append-only: TRUNCATE is not allowed',
    );
    // Reached through CASCADE from a referenced table: refused too.
    await failure(dataSource.query(`TRUNCATE products CASCADE`));
    expect(await movements()).toHaveLength(1);

    const runner = dataSource.createQueryRunner();
    await runner.connect();
    try {
      await runner.startTransaction();
      await runner.query(`SET LOCAL socio.allow_ledger_truncate = 'on'`);
      await runner.query(`TRUNCATE stock_movements`);
      await runner.commitTransaction();
      expect(await movements()).toEqual([]);

      // SET LOCAL ended with that transaction: the same connection is
      // refused again.
      await insertRaw(ctx);
      await runner.startTransaction();
      await failure(runner.query(`TRUNCATE stock_movements`));
      await runner.rollbackTransaction();
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
    }
    expect(await movements()).toHaveLength(1);
  });

  it('the e2e reset clears the ledger', async () => {
    const ctx = await setup();
    await insertRaw(ctx);

    await truncateAllTables(app);

    expect(await movements()).toEqual([]);
  });

  // ---- Constraints ----

  it.each([
    [
      'quantity_after must equal before + delta',
      { quantity_after: 8 },
      'CHK_stock_movements_chain',
    ],
    [
      'quantities never go negative',
      { quantity_before: 0, quantity_after: -1 },
      'CHK_stock_movements_chain',
    ],
    [
      'a movement needs a known type',
      { movement_type: 'GIFT' },
      'CHK_stock_movements_type',
    ],
    [
      'a reference needs a known type',
      { reference_type: 'INVOICE' },
      'CHK_stock_movements_reference_type',
    ],
    [
      'unit statuses need no unit only when both are empty',
      { unit_status_to: 'SOLD' },
      'CHK_stock_movements_unit',
    ],
    [
      'a unit movement needs its new status',
      { product_unit_id: 'UNIT' },
      'CHK_stock_movements_unit',
    ],
    [
      'a zero change needs a status change',
      { quantity_delta: 0, quantity_after: 10 },
      'CHK_stock_movements_nonzero',
    ],
    [
      'an adjustment needs a reason',
      { movement_type: 'ADJUSTMENT_OUT', reference_type: 'STOCK_ADJUSTMENT' },
      'CHK_stock_movements_adjustment',
    ],
    [
      'ADJUSTMENT_IN must add',
      {
        movement_type: 'ADJUSTMENT_IN',
        reference_type: 'STOCK_ADJUSTMENT',
        reason_code: 'MANUAL_ADJUSTMENT',
      },
      'CHK_stock_movements_adjustment',
    ],
    [
      'only a REVERSAL reverses',
      { reverses_movement_id: 'PREVIOUS' },
      'CHK_stock_movements_reverses',
    ],
    [
      'every movement after the backfill has an actor',
      { created_by_id: null },
      'CHK_stock_movements_created_by',
    ],
    [
      'a SALE has no approver',
      { approved_by_id: 'MANAGER' },
      'CHK_stock_movements_approved_by',
    ],
    [
      'a REVERSAL needs its approver',
      { movement_type: 'REVERSAL', quantity_delta: 1, quantity_after: 11 },
      'CHK_stock_movements_approved_by',
    ],
    [
      'a CUSTOMER_RETURN needs its approver',
      {
        movement_type: 'CUSTOMER_RETURN',
        reference_type: 'SALE_RETURN_LINE',
        quantity_delta: 1,
        quantity_after: 11,
      },
      'CHK_stock_movements_approved_by',
    ],
  ])('refuses a row: %s', async (_name, overrides, constraint) => {
    const ctx = await setup();
    const unit = await seedUnit(ctx, '356938035643809');
    const [{ id: previous }] = (await insertRaw(ctx)) as { id: string }[];
    const resolved = Object.fromEntries(
      Object.entries(overrides).map(([key, value]) => [
        key,
        value === 'UNIT'
          ? unit.id
          : value === 'PREVIOUS'
            ? previous
            : value === 'MANAGER'
              ? ctx.manager.id
              : value,
      ]),
    );

    const err = await failure(insertRaw(ctx, resolved));

    expect(constraintOf(err)).toBe(constraint);
  });

  it('accepts the rows the design allows', async () => {
    const ctx = await setup();
    const unit = await seedUnit(ctx, '356938035643809');
    const [{ id: saleId }] = (await insertRaw(ctx)) as { id: string }[];

    // The backfill's opening balance: no actor, may be 0.
    await insertRaw(ctx, {
      movement_type: 'OPENING_BALANCE',
      reference_type: 'STOCK',
      reference_id: ctx.cableStock.id,
      quantity_delta: 0,
      quantity_before: 0,
      quantity_after: 0,
      created_by_id: null,
    });
    // A void with its approver, pointing at the sale it reverses.
    await insertRaw(ctx, {
      movement_type: 'REVERSAL',
      quantity_delta: 1,
      quantity_after: 11,
      approved_by_id: ctx.manager.id,
      reverses_movement_id: saleId,
    });
    // A manual adjustment with its reason.
    await insertRaw(ctx, {
      movement_type: 'ADJUSTMENT_OUT',
      reference_type: 'STOCK_ADJUSTMENT',
      reason_code: 'MANUAL_ADJUSTMENT',
    });
    // A unit created in stock (no previous status).
    await insertRaw(ctx, {
      product_id: ctx.phone.id,
      movement_type: 'PURCHASE',
      reference_type: 'PHONE_PURCHASE',
      product_unit_id: unit.id,
      quantity_delta: 1,
      quantity_before: 0,
      quantity_after: 1,
      unit_status_from: null,
      unit_status_to: 'IN_STOCK',
    });

    expect(await movements()).toHaveLength(5);
  });

  // ---- One row per business event (the two partial unique indexes) ----

  it('refuses a second quantity row for the same event', async () => {
    const ctx = await setup();
    const referenceId = randomUUID();
    await insertRaw(ctx, { reference_id: referenceId });

    const err = await failure(insertRaw(ctx, { reference_id: referenceId }));

    expect(constraintOf(err)).toBe('uq_stock_movements_event_quantity');
  });

  it('refuses a second row for the same unit in the same event', async () => {
    const ctx = await setup();
    const unit = await seedUnit(ctx, '356938035643809');
    const referenceId = randomUUID();
    const unitSale = {
      product_id: ctx.phone.id,
      reference_id: referenceId,
      product_unit_id: unit.id,
      unit_status_from: 'IN_STOCK',
      unit_status_to: 'SOLD',
      quantity_before: 1,
      quantity_after: 0,
    };
    await insertRaw(ctx, unitSale);

    const err = await failure(insertRaw(ctx, unitSale));

    expect(constraintOf(err)).toBe('uq_stock_movements_event_unit');
  });

  it('allows the legitimate rows that share a reference', async () => {
    const ctx = await setup();
    const a = await seedUnit(ctx, '356938035643809');
    const b = await seedUnit(ctx, '490154203237518');
    const item = randomUUID();
    const purchase = {
      product_id: ctx.phone.id,
      movement_type: 'PURCHASE',
      reference_type: 'STOCK_PURCHASE_ITEM',
      reference_id: item,
      quantity_delta: 1,
      unit_status_from: null,
      unit_status_to: 'IN_STOCK',
    };

    // One purchase line: two units and the untracked remainder.
    await insertRaw(ctx, {
      ...purchase,
      product_unit_id: a.id,
      quantity_before: 0,
      quantity_after: 1,
    });
    await insertRaw(ctx, {
      ...purchase,
      product_unit_id: b.id,
      quantity_before: 1,
      quantity_after: 2,
    });
    await insertRaw(ctx, {
      ...purchase,
      unit_status_to: null,
      quantity_before: 2,
      quantity_after: 3,
    });
    // The same reference under another type: a sale line and its void.
    const line = randomUUID();
    await insertRaw(ctx, { reference_id: line });
    await insertRaw(ctx, {
      reference_id: line,
      movement_type: 'REVERSAL',
      quantity_before: 9,
      quantity_delta: 1,
      quantity_after: 10,
      approved_by_id: ctx.manager.id,
    });

    expect(await movements()).toHaveLength(5);
  });

  // ---- History can't disappear ----

  it('refuses to delete a product, unit or user that has ledger rows', async () => {
    const ctx = await setup();
    const unit = await seedUnit(ctx, '356938035643809');
    await insertRaw(ctx, {
      product_id: ctx.phone.id,
      product_unit_id: unit.id,
      unit_status_from: 'IN_STOCK',
      unit_status_to: 'SOLD',
      quantity_before: 1,
      quantity_after: 0,
    });

    const product = await failure(
      dataSource.query(`DELETE FROM products WHERE id = $1`, [ctx.phone.id]),
    );
    expect(constraintOf(product)).toBe('FK_stock_movements_product');
    const unitDelete = await failure(
      dataSource.query(`DELETE FROM product_units WHERE id = $1`, [unit.id]),
    );
    expect(constraintOf(unitDelete)).toBe('FK_stock_movements_product_unit');
    const user = await failure(
      dataSource.query(`DELETE FROM users WHERE id = $1`, [ctx.cashier.id]),
    );
    expect(constraintOf(user)).toBe('FK_stock_movements_created_by');
  });
});
