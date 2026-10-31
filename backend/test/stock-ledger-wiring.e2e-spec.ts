import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
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
import { Customer } from '../src/customers/entities/customer.entity';
import { Supplier } from '../src/suppliers/entities/supplier.entity';
import { Sale } from '../src/sales/entities/sale.entity';
import { SaleLine } from '../src/sales/entities/sale-line.entity';
import { SaleReturnLine } from '../src/sales/entities/sale-return-line.entity';
import { Payment } from '../src/sales/entities/payment.entity';
import { PaymentMethod } from '../src/sales/enums/payment-method.enum';
import { SaleStatus } from '../src/sales/enums/sale-status.enum';
import { SaleType } from '../src/sales/enums/sale-type.enum';
import { ProductUnit } from '../src/product-units/entities/product-unit.entity';
import { StockMovementType } from '../src/stock/enums/stock-movement-type.enum';
import { PhonePurchase } from '../src/phone-purchases/entities/phone-purchase.entity';
import { StockPurchaseItem } from '../src/stock-purchases/entities/stock-purchase-item.entity';
import { approvalFor, giveApprovalPin } from './approval-pin.helper';
import { openToday } from './cash-day.helper';
import {
  NO_PROBLEMS,
  reconcileStockLedger,
  reconciliationProblems,
} from './stock-ledger.helper';

type Response = request.Response;

/**
 * The stock movement ledger, wired (Phase 1 T1b): every path that changes
 * stock or a unit's status records its movement, through the real
 * endpoints, with the right actor, approver, reference and quantities,
 * and the ledger reconciles afterwards.
 *
 * Each test starts like a freshly deployed shop: the opening-balance
 * backfill has run (on an empty database, so it only writes its marker),
 * and every stock row created after it begins its chain at 0.
 *
 * Sessions come from AuthService.login: no HTTP logins.
 */
describe('Stock ledger wiring (e2e)', () => {
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
    admin: User;
    manager: User;
    cashier: User;
    cookies: { admin: string[]; manager: string[]; cashier: string[] };
    customer: Customer;
    supplier: Supplier;
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
        sku: `SKU-WIRE-${suffix}`,
        barcode: `BC-WIRE-${suffix}`,
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
    const admin = await seedUser('admin@wire.test', UserRole.ADMIN, branch);
    const manager = await seedUser(
      'manager@wire.test',
      UserRole.MANAGER,
      branch,
    );
    const cashier = await seedUser(
      'cashier@wire.test',
      UserRole.CASHIER,
      branch,
    );
    await giveApprovalPin(dataSource, manager.id);
    await openToday(dataSource, branch.id, admin.id);
    const customer = await dataSource.getRepository(Customer).save(
      dataSource.getRepository(Customer).create({
        name: 'Kamal Perera',
        phone: '0771234567',
        nic: '199000000001',
        notes: null,
      }),
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
      admin,
      manager,
      cashier,
      cookies: {
        admin: await sessionFor(admin),
        manager: await sessionFor(manager),
        cashier: await sessionFor(cashier),
      },
      customer,
      supplier,
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

  interface DraftItem {
    product: Product;
    quantity: number;
    unit?: ProductUnit;
  }

  /**
   * A fully paid DRAFT rung up by the cashier, one line per item (12-month
   * warranty), paid with an optional trade-in and cash for the rest.
   */
  async function seedDraft(
    ctx: Ctx,
    items: DraftItem[],
    tradeIn?: { product: Product; imei: string; value: number },
  ): Promise<{ sale: Sale; lines: SaleLine[]; tradeInPayment?: Payment }> {
    const cents = items.map(
      ({ product, quantity }) =>
        Math.round(Number(product.selling_price) * 100) * quantity,
    );
    const totalCents = cents.reduce((a, b) => a + b, 0);
    const total = (totalCents / 100).toFixed(2);
    const sale = await dataSource.getRepository(Sale).save(
      dataSource.getRepository(Sale).create({
        sale_type: SaleType.RETAIL,
        status: SaleStatus.DRAFT,
        branch_id: ctx.branch.id,
        cashier_id: ctx.cashier.id,
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
    for (const [i, { product, quantity, unit }] of items.entries()) {
      lines.push(
        await dataSource.getRepository(SaleLine).save(
          dataSource.getRepository(SaleLine).create({
            sale_id: sale.id,
            line_number: i + 1,
            product_id: product.id,
            product_sku_snapshot: product.sku,
            product_name_snapshot: product.name,
            unit_price: product.selling_price!,
            cost_price_snapshot: product.buying_price!,
            quantity,
            discount_type: null,
            discount_value: null,
            discount_amount: '0',
            line_total: (cents[i] / 100).toFixed(2),
            external_supplier_id: null,
            imei_snapshot: unit?.imei ?? null,
            product_unit_id: unit?.id ?? null,
            warranty: WarrantyPeriod.MONTH_12,
          }),
        ),
      );
    }
    let tradeInPayment: Payment | undefined;
    const tradeInCents = tradeIn ? tradeIn.value * 100 : 0;
    if (tradeIn) {
      const value = tradeIn.value.toFixed(2);
      tradeInPayment = await dataSource.getRepository(Payment).save(
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
    return { sale, lines, tradeInPayment };
  }

  // ---- Requests ----

  const send = (test: request.Test): Promise<Response> =>
    new Promise((resolve, reject) => {
      void test.end((err: unknown, res?: Response) => {
        if (res) resolve(res);
        else reject(err instanceof Error ? err : new Error(String(err)));
      });
    });

  const http = (
    method: 'post' | 'patch',
    path: string,
    cookies: string[],
    body: object = {},
  ) =>
    send(
      request(app.getHttpServer())
        [method](`/api/v1${path}`)
        .set('Cookie', cookies)
        .send(body),
    );

  function expectOk(res: Response, status: number) {
    if (res.status !== status) {
      throw new Error(
        `Expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`,
      );
    }
    return res;
  }

  const stockPurchase = (
    ctx: Ctx,
    items: {
      product: Product;
      quantity: number;
      imeis?: string[];
      serials?: string[];
    }[],
  ) =>
    http('post', '/stock-purchases', ctx.cookies.manager, {
      supplier_id: ctx.supplier.id,
      branch_id: ctx.branch.id,
      items: items.map((item) => ({
        product_id: item.product.id,
        quantity: item.quantity,
        unit_buying_price: '100.00',
        ...((item.imeis || item.serials) && {
          unit_identifiers: [
            ...(item.imeis ?? []).map((imei_number) => ({ imei_number })),
            ...(item.serials ?? []).map((serial_number) => ({
              serial_number,
            })),
          ],
        }),
      })),
    });

  const complete = (saleId: string, cookies: string[]) =>
    http('post', `/sales/${saleId}/complete`, cookies);

  const voidSale = (ctx: Ctx, saleId: string) =>
    http('post', `/sales/${saleId}/void`, ctx.cookies.cashier, {
      void_reason: 'Rung up by mistake',
      approval: approvalFor(ctx.manager.id),
    });

  const returnBody = (
    ctx: Ctx,
    lines: { sale_line_id: string; quantity: number; condition?: string }[],
    clientRequestId = randomUUID(),
  ) => ({
    client_request_id: clientRequestId,
    lines,
    refunds: [],
    reason: 'Customer changed their mind',
    approval: approvalFor(ctx.manager.id),
  });

  const postReturn = (ctx: Ctx, saleId: string, body: object) =>
    http('post', `/sales/${saleId}/returns`, ctx.cookies.cashier, body);

  const passInspection = (ctx: Ctx, unitId: string) =>
    http(
      'post',
      `/product-units/${unitId}/inspection-pass`,
      ctx.cookies.manager,
    );

  // ---- Reads ----

  const movementsOf = (product: Product) =>
    dataSource.getRepository(StockMovement).find({
      where: { product_id: product.id },
      order: { seq: 'ASC' },
    });

  const allMovements = () =>
    dataSource.getRepository(StockMovement).find({ order: { seq: 'ASC' } });

  const stockRow = (ctx: Ctx, product: Product) =>
    dataSource.getRepository(Stock).findOneByOrFail({
      product_id: product.id,
      branch_id: ctx.branch.id,
    });

  const unitByImei = (imei: string) =>
    dataSource.getRepository(ProductUnit).findOneByOrFail({ imei });

  const pick = (m: StockMovement) => ({
    type: m.movement_type,
    delta: m.quantity_delta,
    before: m.quantity_before,
    after: m.quantity_after,
    unit: m.product_unit_id,
    from: m.unit_status_from,
    to: m.unit_status_to,
    ref: m.reference_type,
  });

  async function expectReconciled() {
    expect(
      reconciliationProblems(await reconcileStockLedger(dataSource)),
    ).toEqual(NO_PROBLEMS);
  }

  /** Receive 2 phones, 3 hubs (1 with a serial) and 10 cables. */
  async function receiveStock(ctx: Ctx) {
    expectOk(
      await stockPurchase(ctx, [
        {
          product: ctx.phone,
          quantity: 2,
          imeis: ['356938035643809', '490154203237518'],
        },
        { product: ctx.hub, quantity: 3, serials: ['SN-HUB-001'] },
        { product: ctx.cable, quantity: 10 },
      ]),
      201,
    );
    return {
      phoneA: await unitByImei('356938035643809'),
      phoneB: await unitByImei('490154203237518'),
    };
  }

  // ---- Purchases ----

  it('a stock purchase records one PURCHASE per unit and one for the rest, by the purchaser', async () => {
    const ctx = await setup();
    const { phoneA, phoneB } = await receiveStock(ctx);
    const hubUnit = await unitByImei('SN-HUB-001');
    const items = await dataSource.getRepository(StockPurchaseItem).find();
    const itemOf = (p: Product) => items.find((i) => i.product_id === p.id)!.id;

    expect((await movementsOf(ctx.phone)).map(pick)).toEqual([
      {
        type: 'PURCHASE',
        delta: 1,
        before: 0,
        after: 1,
        unit: phoneA.id,
        from: null,
        to: 'IN_STOCK',
        ref: 'STOCK_PURCHASE_ITEM',
      },
      {
        type: 'PURCHASE',
        delta: 1,
        before: 1,
        after: 2,
        unit: phoneB.id,
        from: null,
        to: 'IN_STOCK',
        ref: 'STOCK_PURCHASE_ITEM',
      },
    ]);
    expect((await movementsOf(ctx.hub)).map(pick)).toEqual([
      {
        type: 'PURCHASE',
        delta: 1,
        before: 0,
        after: 1,
        unit: hubUnit.id,
        from: null,
        to: 'IN_STOCK',
        ref: 'STOCK_PURCHASE_ITEM',
      },
      {
        type: 'PURCHASE',
        delta: 2,
        before: 1,
        after: 3,
        unit: null,
        from: null,
        to: null,
        ref: 'STOCK_PURCHASE_ITEM',
      },
    ]);
    expect((await movementsOf(ctx.cable)).map(pick)).toEqual([
      {
        type: 'PURCHASE',
        delta: 10,
        before: 0,
        after: 10,
        unit: null,
        from: null,
        to: null,
        ref: 'STOCK_PURCHASE_ITEM',
      },
    ]);
    for (const m of await allMovements()) {
      expect(m.created_by_id).toBe(ctx.manager.id);
      expect(m.approved_by_id).toBeNull();
      expect(m.stock_managed).toBe(true);
      expect(m.reference_id).toBe(
        itemOf(
          [ctx.phone, ctx.hub, ctx.cable].find((p) => p.id === m.product_id)!,
        ),
      );
    }
    await expectReconciled();
  });

  it('a phone purchase records a PURCHASE by the cashier, referencing the phone purchase', async () => {
    const ctx = await setup();

    expectOk(
      await http('post', '/phone-purchases', ctx.cookies.cashier, {
        customer_id: ctx.customer.id,
        branch_id: ctx.branch.id,
        product_id: ctx.phone.id,
        imei: '356938035643809',
        buying_price: 80000,
      }),
      201,
    );

    const purchase = await dataSource
      .getRepository(PhonePurchase)
      .findOneByOrFail({});
    const unit = await unitByImei('356938035643809');
    const [m] = await movementsOf(ctx.phone);
    expect(pick(m)).toEqual({
      type: 'PURCHASE',
      delta: 1,
      before: 0,
      after: 1,
      unit: unit.id,
      from: null,
      to: 'IN_STOCK',
      ref: 'PHONE_PURCHASE',
    });
    expect(m.reference_id).toBe(purchase.id);
    expect(m.created_by_id).toBe(ctx.cashier.id);
    await expectReconciled();
  });

  // ---- Sale, trade-in, void ----

  it('completing a sale records SALE and TRADE_IN by the completing user, not the draft cashier', async () => {
    const ctx = await setup();
    const { phoneA } = await receiveStock(ctx);
    const { sale, lines, tradeInPayment } = await seedDraft(
      ctx,
      [
        { product: ctx.phone, quantity: 1, unit: phoneA },
        { product: ctx.cable, quantity: 2 },
      ],
      { product: ctx.phone, imei: '012345678901237', value: 400 },
    );

    expectOk(await complete(sale.id, ctx.cookies.manager), 200);

    const tradeInUnit = await unitByImei('012345678901237');
    const phoneRows = (await movementsOf(ctx.phone)).slice(2);
    expect(phoneRows.map(pick)).toEqual([
      {
        type: 'SALE',
        delta: -1,
        before: 2,
        after: 1,
        unit: phoneA.id,
        from: 'IN_STOCK',
        to: 'SOLD',
        ref: 'SALE_LINE',
      },
      {
        type: 'TRADE_IN',
        delta: 1,
        before: 1,
        after: 2,
        unit: tradeInUnit.id,
        from: null,
        to: 'IN_STOCK',
        ref: 'PAYMENT',
      },
    ]);
    expect(phoneRows[0].reference_id).toBe(lines[0].id);
    expect(phoneRows[1].reference_id).toBe(tradeInPayment!.id);
    const [, cableSale] = await movementsOf(ctx.cable);
    expect(pick(cableSale)).toMatchObject({
      type: 'SALE',
      delta: -2,
      before: 10,
      after: 8,
    });
    expect(cableSale.reference_id).toBe(lines[1].id);
    for (const m of [...phoneRows, cableSale]) {
      expect(m.created_by_id).toBe(ctx.manager.id);
      expect(m.approved_by_id).toBeNull();
    }
    // The trade-in's phone purchase keeps the sale's cashier.
    const pp = await dataSource.getRepository(PhonePurchase).findOneByOrFail({
      id: (await unitByImei('012345678901237')).phone_purchase_id!,
    });
    expect(pp.cashier_id).toBe(ctx.cashier.id);
    await expectReconciled();
  });

  it('voiding records each REVERSAL by the requester with the approver, linked to what it undoes', async () => {
    const ctx = await setup();
    const { phoneA } = await receiveStock(ctx);
    const { sale } = await seedDraft(
      ctx,
      [
        { product: ctx.phone, quantity: 1, unit: phoneA },
        { product: ctx.cable, quantity: 3 },
      ],
      { product: ctx.phone, imei: '012345678901237', value: 400 },
    );
    expectOk(await complete(sale.id, ctx.cookies.cashier), 200);
    const before = await allMovements();
    const sold = before.filter(
      (m) => m.movement_type === StockMovementType.SALE,
    );
    const tradeIn = before.find(
      (m) => m.movement_type === StockMovementType.TRADE_IN,
    )!;

    expectOk(await voidSale(ctx, sale.id), 200);

    const reversals = (await allMovements()).filter(
      (m) => m.movement_type === StockMovementType.REVERSAL,
    );
    expect(reversals).toHaveLength(3);
    const byRef = (id: string) =>
      reversals.find((r) => r.reverses_movement_id === id)!;
    const phoneSale = sold.find((m) => m.product_unit_id === phoneA.id)!;
    const cableSale = sold.find((m) => m.product_id === ctx.cable.id)!;
    expect(pick(byRef(phoneSale.id))).toMatchObject({
      delta: 1,
      unit: phoneA.id,
      from: 'SOLD',
      to: 'IN_STOCK',
      ref: 'SALE_LINE',
    });
    expect(pick(byRef(cableSale.id))).toMatchObject({
      delta: 3,
      ref: 'SALE_LINE',
    });
    expect(pick(byRef(tradeIn.id))).toMatchObject({
      delta: -1,
      unit: tradeIn.product_unit_id,
      from: 'IN_STOCK',
      to: 'RETURNED',
      ref: 'PAYMENT',
    });
    for (const r of reversals) {
      expect(r.created_by_id).toBe(ctx.cashier.id);
      expect(r.approved_by_id).toBe(ctx.manager.id);
    }
    await expectReconciled();
  });

  it('voiding a sale completed before the ledger records its reversal with no original', async () => {
    const ctx = await setup();
    await receiveStock(ctx);
    const { sale } = await seedDraft(ctx, [
      { product: ctx.cable, quantity: 4 },
    ]);
    expectOk(await complete(sale.id, ctx.cookies.cashier), 200);
    // The ledger goes live now: clear it and its marker (the e2e reset's
    // flag), then backfill the openings from today's stock.
    await dataSource.transaction(async (m) => {
      await m.query(`SET LOCAL socio.allow_ledger_truncate = 'on'`);
      await m.query(`TRUNCATE stock_movements, stock_ledger_backfill`);
    });
    await dataSource.query(`SELECT backfill_stock_opening_balances()`);

    expectOk(await voidSale(ctx, sale.id), 200);

    const cable = await movementsOf(ctx.cable);
    expect(cable.map(pick)).toEqual([
      {
        type: 'OPENING_BALANCE',
        delta: 6,
        before: 0,
        after: 6,
        unit: null,
        from: null,
        to: null,
        ref: 'STOCK',
      },
      {
        type: 'REVERSAL',
        delta: 4,
        before: 6,
        after: 10,
        unit: null,
        from: null,
        to: null,
        ref: 'SALE_LINE',
      },
    ]);
    expect(cable[1].reverses_movement_id).toBeNull();
    await expectReconciled();
  });

  // ---- Returns and inspection ----

  it('a return records a phone as a zero-change CUSTOMER_RETURN and an item back in stock, with requester and approver', async () => {
    const ctx = await setup();
    const { phoneA } = await receiveStock(ctx);
    const { sale, lines } = await seedDraft(ctx, [
      { product: ctx.phone, quantity: 1, unit: phoneA },
      { product: ctx.cable, quantity: 3 },
    ]);
    expectOk(await complete(sale.id, ctx.cookies.cashier), 200);

    expectOk(
      await postReturn(
        ctx,
        sale.id,
        returnBody(ctx, [
          { sale_line_id: lines[0].id, quantity: 1 },
          { sale_line_id: lines[1].id, quantity: 1, condition: 'RESALEABLE' },
        ]),
      ),
      201,
    );

    const returnLines = await dataSource.getRepository(SaleReturnLine).find();
    const lineFor = (saleLine: SaleLine) =>
      returnLines.find((l) => l.sale_line_id === saleLine.id)!.id;
    const returns = (await allMovements()).filter(
      (m) => m.movement_type === StockMovementType.CUSTOMER_RETURN,
    );
    const phoneReturn = returns.find((m) => m.product_id === ctx.phone.id)!;
    const cableReturn = returns.find((m) => m.product_id === ctx.cable.id)!;
    expect(pick(phoneReturn)).toEqual({
      type: 'CUSTOMER_RETURN',
      delta: 0,
      before: 1,
      after: 1,
      unit: phoneA.id,
      from: 'SOLD',
      to: 'INSPECTION',
      ref: 'SALE_RETURN_LINE',
    });
    expect(phoneReturn.reference_id).toBe(lineFor(lines[0]));
    expect(pick(cableReturn)).toMatchObject({ delta: 1, before: 7, after: 8 });
    expect(cableReturn.reference_id).toBe(lineFor(lines[1]));
    for (const m of returns) {
      expect(m.created_by_id).toBe(ctx.cashier.id);
      expect(m.approved_by_id).toBe(ctx.manager.id);
    }
    await expectReconciled();
  });

  it('partial returns of one line record one movement per return line', async () => {
    const ctx = await setup();
    await receiveStock(ctx);
    const { sale, lines } = await seedDraft(ctx, [
      { product: ctx.cable, quantity: 3 },
    ]);
    expectOk(await complete(sale.id, ctx.cookies.cashier), 200);

    for (const quantity of [1, 2]) {
      expectOk(
        await postReturn(
          ctx,
          sale.id,
          returnBody(ctx, [
            { sale_line_id: lines[0].id, quantity, condition: 'RESALEABLE' },
          ]),
        ),
        201,
      );
    }

    const returns = (await movementsOf(ctx.cable)).filter(
      (m) => m.movement_type === StockMovementType.CUSTOMER_RETURN,
    );
    expect(
      returns.map((m) => [
        m.quantity_delta,
        m.quantity_before,
        m.quantity_after,
      ]),
    ).toEqual([
      [1, 7, 8],
      [2, 8, 10],
    ]);
    expect(new Set(returns.map((m) => m.reference_id)).size).toBe(2);
    await expectReconciled();
  });

  it('each inspection pass references the return that sent the phone to inspection, over two cycles', async () => {
    const ctx = await setup();
    const { phoneA } = await receiveStock(ctx);

    for (let cycle = 0; cycle < 2; cycle++) {
      const { sale, lines } = await seedDraft(ctx, [
        { product: ctx.phone, quantity: 1, unit: phoneA },
      ]);
      expectOk(await complete(sale.id, ctx.cookies.cashier), 200);
      expectOk(
        await postReturn(
          ctx,
          sale.id,
          returnBody(ctx, [{ sale_line_id: lines[0].id, quantity: 1 }]),
        ),
        201,
      );
      const res = await passInspection(ctx, phoneA.id);
      expect([200, 201]).toContain(res.status);
    }

    const rows = await movementsOf(ctx.phone);
    const returned = rows.filter(
      (m) => m.movement_type === StockMovementType.CUSTOMER_RETURN,
    );
    const passed = rows.filter(
      (m) => m.movement_type === StockMovementType.INSPECTION_PASSED,
    );
    expect(passed.map(pick)).toEqual([
      {
        type: 'INSPECTION_PASSED',
        delta: 1,
        before: 1,
        after: 2,
        unit: phoneA.id,
        from: 'INSPECTION',
        to: 'IN_STOCK',
        ref: 'SALE_RETURN_LINE',
      },
      {
        type: 'INSPECTION_PASSED',
        delta: 1,
        before: 1,
        after: 2,
        unit: phoneA.id,
        from: 'INSPECTION',
        to: 'IN_STOCK',
        ref: 'SALE_RETURN_LINE',
      },
    ]);
    expect(passed.map((m) => m.reference_id)).toEqual(
      returned.map((m) => m.reference_id),
    );
    expect(passed[0].reference_id).not.toBe(passed[1].reference_id);
    for (const m of passed) {
      expect(m.created_by_id).toBe(ctx.manager.id);
      expect(m.approved_by_id).toBeNull();
    }
    await expectReconciled();
  });

  // ---- Untracked rows ----

  it('selling a phone from an untracked stock row records the unit change with no quantity change', async () => {
    const ctx = await setup();
    const { phoneA } = await receiveStock(ctx);
    await dataSource
      .getRepository(Stock)
      .update({ product_id: ctx.phone.id }, { manage_stock: false });
    const { sale } = await seedDraft(ctx, [
      { product: ctx.phone, quantity: 1, unit: phoneA },
    ]);

    expectOk(await complete(sale.id, ctx.cookies.cashier), 200);

    const last = (await movementsOf(ctx.phone)).at(-1)!;
    expect(pick(last)).toEqual({
      type: 'SALE',
      delta: 0,
      before: 2,
      after: 2,
      unit: phoneA.id,
      from: 'IN_STOCK',
      to: 'SOLD',
      ref: 'SALE_LINE',
    });
    expect(last.stock_managed).toBe(false);
    const recon = await reconcileStockLedger(dataSource);
    expect(reconciliationProblems(recon)).toEqual(NO_PROBLEMS);
    expect(recon.informational.unmanagedUnitEvents).toEqual([
      expect.objectContaining({ movement_id: last.id }),
    ]);
  });

  // ---- Rollback and repeats ----

  it('a refused completion or purchase leaves no ledger rows', async () => {
    const ctx = await setup();
    const { phoneA } = await receiveStock(ctx);
    const before = (await allMovements()).length;
    const { sale } = await seedDraft(ctx, [
      { product: ctx.phone, quantity: 1, unit: phoneA },
      { product: ctx.cable, quantity: 50 },
    ]);

    expect((await complete(sale.id, ctx.cookies.cashier)).status).toBe(409);
    expect(
      (
        await stockPurchase(ctx, [
          { product: ctx.cable, quantity: 5 },
          { product: ctx.phone, quantity: 1, imeis: ['356938035643809'] },
        ])
      ).status,
    ).toBe(409);

    expect(await allMovements()).toHaveLength(before);
    expect((await stockRow(ctx, ctx.cable)).quantity).toBe(10);
    await expectReconciled();
  });

  it('repeated operations add no ledger rows', async () => {
    const ctx = await setup();
    const { phoneA } = await receiveStock(ctx);
    const { sale, lines } = await seedDraft(ctx, [
      { product: ctx.phone, quantity: 1, unit: phoneA },
    ]);
    expectOk(await complete(sale.id, ctx.cookies.cashier), 200);
    const body = returnBody(ctx, [{ sale_line_id: lines[0].id, quantity: 1 }]);
    expectOk(await postReturn(ctx, sale.id, body), 201);
    await passInspection(ctx, phoneA.id);
    const count = (await allMovements()).length;

    expect((await complete(sale.id, ctx.cookies.cashier)).status).toBe(400);
    expect((await postReturn(ctx, sale.id, body)).status).toBe(200);
    expect((await passInspection(ctx, phoneA.id)).status).toBe(409);

    expect(await allMovements()).toHaveLength(count);
    await expectReconciled();
  });

  it('concurrent sales of one stock row leave an unbroken chain', async () => {
    const ctx = await setup();
    await receiveStock(ctx);
    const drafts: { sale: Sale }[] = [];
    for (const quantity of [1, 2, 3]) {
      drafts.push(await seedDraft(ctx, [{ product: ctx.cable, quantity }]));
    }

    const results = await Promise.all(
      drafts.map(({ sale }) => complete(sale.id, ctx.cookies.cashier)),
    );

    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect((await stockRow(ctx, ctx.cable)).quantity).toBe(4);
    await expectReconciled();
  });

  // ---- Manual stock changes ----

  it('PATCH /stock records adjustments, refuses a stale quantity and writes nothing then', async () => {
    const ctx = await setup();
    await receiveStock(ctx);
    const row = await stockRow(ctx, ctx.cable);
    const { sale } = await seedDraft(ctx, [
      { product: ctx.cable, quantity: 2 },
    ]);
    expectOk(await complete(sale.id, ctx.cookies.cashier), 200);
    const count = (await allMovements()).length;

    // The admin saw 10; a sale made it 8.
    const stale = await http('patch', `/stock/${row.id}`, ctx.cookies.admin, {
      quantity: 7,
      expected_quantity: 10,
    });
    expect(stale.status).toBe(409);
    expect(stale.body).toEqual({
      message:
        'The stock for this product changed to 8 while you were editing. ' +
        'Check the new quantity and save again.',
      code: 'STOCK_QUANTITY_CHANGED',
      stock_id: row.id,
      expected_quantity: 10,
      current_quantity: 8,
    });
    expect((await stockRow(ctx, ctx.cable)).quantity).toBe(8);
    expect(await allMovements()).toHaveLength(count);

    expectOk(
      await http('patch', `/stock/${row.id}`, ctx.cookies.admin, {
        quantity: 7,
        expected_quantity: 8,
      }),
      200,
    );
    expectOk(
      await http('patch', `/stock/${row.id}`, ctx.cookies.admin, {
        quantity: 12,
      }),
      200,
    );
    expectOk(
      await http('patch', `/stock/${row.id}`, ctx.cookies.admin, {
        min_quantity: 4,
      }),
      200,
    );

    const adjustments = (await movementsOf(ctx.cable)).slice(-2);
    expect(adjustments.map(pick)).toEqual([
      {
        type: 'ADJUSTMENT_OUT',
        delta: -1,
        before: 8,
        after: 7,
        unit: null,
        from: null,
        to: null,
        ref: 'STOCK_ADJUSTMENT',
      },
      {
        type: 'ADJUSTMENT_IN',
        delta: 5,
        before: 7,
        after: 12,
        unit: null,
        from: null,
        to: null,
        ref: 'STOCK_ADJUSTMENT',
      },
    ]);
    for (const m of adjustments) {
      expect(m.reason_code).toBe('MANUAL_ADJUSTMENT');
      expect(m.created_by_id).toBe(ctx.admin.id);
    }
    expect(await allMovements()).toHaveLength(count + 2);
    await expectReconciled();
  });

  it('POST /stock records a starting quantity as the row opening balance, and none for 0', async () => {
    const ctx = await setup();

    const res = expectOk(
      await http('post', '/stock', ctx.cookies.admin, {
        product_id: ctx.cable.id,
        branch_id: ctx.branch.id,
        quantity: 5,
      }),
      201,
    );
    expectOk(
      await http('post', '/stock', ctx.cookies.admin, {
        product_id: ctx.hub.id,
        branch_id: ctx.branch.id,
      }),
      201,
    );

    const [opening] = await movementsOf(ctx.cable);
    expect(pick(opening)).toEqual({
      type: 'OPENING_BALANCE',
      delta: 5,
      before: 0,
      after: 5,
      unit: null,
      from: null,
      to: null,
      ref: 'STOCK',
    });
    expect(opening.reference_id).toBe((res.body as { id: string }).id);
    expect(opening.created_by_id).toBe(ctx.admin.id);
    expect(await movementsOf(ctx.hub)).toEqual([]);
    await expectReconciled();
  });
});
