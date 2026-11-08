import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { createTestApp, truncateAllTables } from './setup';
import { openToday } from './cash-day.helper';
import { AuthService } from '../src/auth/auth.service';
import { User } from '../src/users/entities/user.entity';
import { UserRole } from '../src/users/enums/user-role.enum';
import { Branch } from '../src/branches/entities/branch.entity';
import { Brand } from '../src/brands/entities/brand.entity';
import { Category } from '../src/categories/entities/category.entity';
import { Product } from '../src/products/entities/product.entity';
import { TrackingMethod } from '../src/products/enums/tracking-method.enum';
import { WarrantyPeriod } from '../src/products/enums/warranty-period.enum';
import { Customer } from '../src/customers/entities/customer.entity';
import { Supplier } from '../src/suppliers/entities/supplier.entity';
import { Sale } from '../src/sales/entities/sale.entity';
import { SaleLine } from '../src/sales/entities/sale-line.entity';
import { Payment } from '../src/sales/entities/payment.entity';
import { PaymentMethod } from '../src/sales/enums/payment-method.enum';
import { SaleStatus } from '../src/sales/enums/sale-status.enum';
import { SaleType } from '../src/sales/enums/sale-type.enum';
import { ProductUnit } from '../src/product-units/entities/product-unit.entity';
import { ProductUnitStatus } from '../src/product-units/enums/product-unit-status.enum';
import { AddProductUnitCodes1793800000000 } from '../src/database/migrations/1793800000000-AddProductUnitCodes';

type Response = request.Response;

/**
 * Unit codes (product_units.unit_code): what only a real database can show.
 * The database generates them, so this checks the default, the backfill,
 * the sequence and all three intake paths, then scanning a code through the
 * real endpoints. The rules around them are unit-tested in unit-code.spec.ts
 * and the service specs.
 *
 * The backfill runs the migration's own down and up inside a transaction
 * that is rolled back, so the test database keeps its schema.
 *
 * Sessions come from AuthService.login: no HTTP logins.
 */
describe('Product unit codes (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  const IMEI = '356938035643809';
  const IMEI_2 = '490154203237518';
  const SERIAL = 'SN-HUB-001';
  const NO_MATCH = 'No item matches that unit code at this branch.';

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
    branchA: Branch;
    branchB: Branch;
    admin: User;
    cashierA: User;
    cookies: {
      admin: string[];
      managerA: string[];
      cashierA: string[];
      cashierB: string[];
    };
    customer: Customer;
    supplier: Supplier;
    phone: Product;
    hub: Product;
    cable: Product;
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
    const products = dataSource.getRepository(Product);
    return products.save(
      products.create({
        product_type: null,
        name,
        sku: `SKU-CODE-${suffix}`,
        barcode: `BC-CODE-${suffix}`,
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
    const branches = dataSource.getRepository(Branch);
    const branchA = await branches.save({
      name: 'Main Shop',
      is_active: true,
    } as Branch);
    const branchB = await branches.save({
      name: 'Kandy Branch',
      is_active: true,
    } as Branch);
    const admin = await seedUser('admin@code.test', UserRole.ADMIN, branchA);
    const managerA = await seedUser(
      'manager@code.test',
      UserRole.MANAGER,
      branchA,
    );
    const cashierA = await seedUser(
      'cashier-a@code.test',
      UserRole.CASHIER,
      branchA,
    );
    const cashierB = await seedUser(
      'cashier-b@code.test',
      UserRole.CASHIER,
      branchB,
    );
    await openToday(dataSource, branchA.id, admin.id);
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
      .save({ name: 'CodeBrand', is_active: true } as Brand);
    const category = await dataSource
      .getRepository(Category)
      .save({ name: 'CodeCategory', is_active: true } as Category);
    return {
      branchA,
      branchB,
      admin,
      cashierA,
      cookies: {
        admin: await sessionFor(admin),
        managerA: await sessionFor(managerA),
        cashierA: await sessionFor(cashierA),
        cashierB: await sessionFor(cashierB),
      },
      customer,
      supplier,
      phone: await seedProduct(
        'Galaxy A15',
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
      cable: await seedProduct(
        'USB Cable',
        TrackingMethod.QUANTITY,
        brand,
        category,
      ),
    };
  }

  /** A unit inserted directly; unit_code is left to the database. */
  const seedUnit = (ctx: Ctx, overrides: Partial<ProductUnit> = {}) => {
    const units = dataSource.getRepository(ProductUnit);
    return units.save(
      units.create({
        product_id: ctx.phone.id,
        branch_id: ctx.branchA.id,
        imei: IMEI,
        imei_number: IMEI,
        serial_number: null,
        status: ProductUnitStatus.IN_STOCK,
        buying_price: '500.00',
        selling_price: '1000.00',
        phone_purchase_id: null,
        ...overrides,
      }),
    );
  };

  /** An empty DRAFT sale at branch A, rung up by the cashier. */
  const seedDraft = (ctx: Ctx, customerId: string | null = null) => {
    const sales = dataSource.getRepository(Sale);
    return sales.save(
      sales.create({
        sale_type: SaleType.RETAIL,
        status: SaleStatus.DRAFT,
        branch_id: ctx.branchA.id,
        cashier_id: ctx.cashierA.id,
        customer_id: customerId,
        subtotal: '0',
        discount_total: '0',
        tax_total: '0',
        total: '0',
        amount_paid: '0',
        change_due: '0',
      }),
    );
  };

  // ---- Requests ----

  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /** Paced so a run stays under the per-route throttle. */
  const http = async (
    method: 'get' | 'post',
    path: string,
    cookies: string[],
    body?: object,
  ): Promise<Response> => {
    await pause(120);
    const call = request(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set('Cookie', cookies);
    return body ? call.send(body) : call;
  };

  const lookup = (identifier: string, branch: Branch, cookies: string[]) =>
    http(
      'get',
      `/product-units/sellable/by-identifier/${identifier}?branchId=${branch.id}`,
      cookies,
    );

  const stockPurchase = (ctx: Ctx, items: object[]) =>
    http('post', '/stock-purchases', ctx.cookies.managerA, {
      client_request_id: randomUUID(),
      supplier_id: ctx.supplier.id,
      branch_id: ctx.branchA.id,
      items,
    });

  const addLine = (saleId: string, cookies: string[], body: object) =>
    http('post', `/sales/${saleId}/lines`, cookies, body);

  const unitsOf = (product: Product) =>
    dataSource
      .getRepository(ProductUnit)
      .find({ where: { product_id: product.id } });

  const lineOf = (saleId: string) =>
    dataSource.getRepository(SaleLine).findOneByOrFail({ sale_id: saleId });

  // ---- The schema ----

  describe('the column', () => {
    it('defaults to the function, exactly as the entity declares it', async () => {
      const [column] = await dataSource.query(
        `SELECT column_default, is_nullable, data_type
           FROM information_schema.columns
          WHERE table_name = 'product_units' AND column_name = 'unit_code'`,
      );

      expect(column).toEqual({
        column_default: 'next_product_unit_code()',
        is_nullable: 'NO',
        data_type: 'text',
      });
    });

    it('has a full unique index, not a partial one', async () => {
      const [index] = await dataSource.query(
        `SELECT indexdef FROM pg_indexes
          WHERE indexname = 'uq_product_units_unit_code'`,
      );

      expect(index.indexdef).toContain('UNIQUE');
      expect(index.indexdef).not.toContain('WHERE');
    });

    it('owns its sequence', async () => {
      const [{ sequence }] = await dataSource.query(
        `SELECT pg_get_serial_sequence('product_units', 'unit_code') AS sequence`,
      );

      expect(sequence).toContain('product_unit_code_seq');
    });

    it('restarts the sequence on the test reset: the first code is 1', async () => {
      const ctx = await setup();

      expect((await seedUnit(ctx)).unit_code).toBe('SLU00000001');
    });

    it('refuses a duplicate code, even against a sold unit', async () => {
      const ctx = await setup();
      const sold = await seedUnit(ctx, { status: ProductUnitStatus.SOLD });
      const live = await seedUnit(ctx, {
        imei: IMEI_2,
        imei_number: IMEI_2,
      });

      await expect(
        dataSource.query(
          `UPDATE product_units SET unit_code = $1 WHERE id = $2`,
          [sold.unit_code, live.id],
        ),
      ).rejects.toMatchObject({ constraint: 'uq_product_units_unit_code' });
    });

    it.each(['slu00000001', 'SLU1234567', 'SLU-00000001', 'ABC'])(
      'refuses the badly formed code %s',
      async (code) => {
        const ctx = await setup();
        const unit = await seedUnit(ctx);

        await expect(
          dataSource.query(
            `UPDATE product_units SET unit_code = $1 WHERE id = $2`,
            [code, unit.id],
          ),
        ).rejects.toMatchObject({ constraint: 'CHK_product_units_unit_code' });
      },
    );

    it('grows past eight digits without truncating', async () => {
      const ctx = await setup();
      await dataSource.query(
        `SELECT setval('product_unit_code_seq', 99999999)`,
      );

      const first = await seedUnit(ctx);
      const second = await seedUnit(ctx, {
        imei: IMEI_2,
        imei_number: IMEI_2,
      });

      expect(first.unit_code).toBe('SLU100000000');
      expect(second.unit_code).toBe('SLU100000001');
    });

    it('gives concurrent inserts different codes', async () => {
      const ctx = await setup();

      const units = await Promise.all(
        Array.from({ length: 20 }, (_, i) => {
          const imei = `3569380356${String(i).padStart(5, '0')}`;
          return seedUnit(ctx, { imei, imei_number: imei });
        }),
      );

      const codes = units.map((unit) => unit.unit_code);
      expect(new Set(codes).size).toBe(20);
      expect(codes.every((code) => /^SLU[0-9]{8,}$/.test(code))).toBe(true);
    });

    it('does not reuse the number of a rolled-back insert', async () => {
      const ctx = await setup();
      const first = await seedUnit(ctx);

      await dataSource
        .transaction(async (manager) => {
          await manager.query(`SELECT next_product_unit_code()`);
          throw new Error('rolled back');
        })
        .catch(() => undefined);
      const next = await seedUnit(ctx, {
        imei: IMEI_2,
        imei_number: IMEI_2,
      });

      expect(first.unit_code).toBe('SLU00000001');
      expect(next.unit_code).toBe('SLU00000003');
    });

    it('keeps the code out of entity updates', async () => {
      const ctx = await setup();
      const unit = await seedUnit(ctx);
      const units = dataSource.getRepository(ProductUnit);

      await units.save({ ...unit, unit_code: 'SLU99999999' });

      const reloaded = await units.findOneByOrFail({ id: unit.id });
      expect(reloaded.unit_code).toBe(unit.unit_code);
    });

    it('survives a status change', async () => {
      const ctx = await setup();
      const unit = await seedUnit(ctx);
      const units = dataSource.getRepository(ProductUnit);

      await units.update(unit.id, { status: ProductUnitStatus.SOLD });

      const reloaded = await units.findOneByOrFail({ id: unit.id });
      expect(reloaded.unit_code).toBe(unit.unit_code);
    });
  });

  // ---- The backfill ----

  describe('the migration', () => {
    const migration = new AddProductUnitCodes1793800000000();

    /** down then up, on these rows, undone again whatever happens. */
    const reapplied = async <T>(
      read: (query: (sql: string) => Promise<any[]>) => Promise<T>,
    ): Promise<T> => {
      const runner = dataSource.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        await migration.down(runner);
        await migration.up(runner);
        return await read((sql) => runner.query(sql));
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
    };

    it('backfills every row in created_at, id order, sold ones included', async () => {
      const ctx = await setup();
      const newest = await seedUnit(ctx);
      const oldest = await seedUnit(ctx, {
        imei: IMEI_2,
        imei_number: IMEI_2,
        status: ProductUnitStatus.SOLD,
      });
      const middle = await seedUnit(ctx, {
        product_id: ctx.hub.id,
        imei: SERIAL,
        imei_number: null,
        serial_number: SERIAL,
        status: ProductUnitStatus.RETURNED,
      });
      await dataSource.query(
        `UPDATE product_units SET created_at = CASE id
           WHEN $1::uuid THEN '2026-01-01T00:00:00Z'::timestamptz
           WHEN $2::uuid THEN '2026-02-01T00:00:00Z'::timestamptz
           ELSE '2026-03-01T00:00:00Z'::timestamptz END`,
        [oldest.id, middle.id],
      );

      const rows = await reapplied((query) =>
        query(`SELECT id, unit_code FROM product_units ORDER BY unit_code`),
      );

      expect(rows).toEqual([
        { id: oldest.id, unit_code: 'SLU00000001' },
        { id: middle.id, unit_code: 'SLU00000002' },
        { id: newest.id, unit_code: 'SLU00000003' },
      ]);
    });

    it('moves the sequence past the backfill', async () => {
      const ctx = await setup();
      await seedUnit(ctx);
      await seedUnit(ctx, { imei: IMEI_2, imei_number: IMEI_2 });

      const [next] = await reapplied((query) =>
        query(`SELECT next_product_unit_code() AS code`),
      );

      expect(next.code).toBe('SLU00000003');
    });

    it('starts at 1 on an empty table', async () => {
      const [next] = await reapplied((query) =>
        query(`SELECT next_product_unit_code() AS code`),
      );

      expect(next.code).toBe('SLU00000001');
    });

    it('leaves no row without a code', async () => {
      const ctx = await setup();
      await seedUnit(ctx, { status: ProductUnitStatus.SOLD });

      const [{ missing }] = await reapplied((query) =>
        query(
          `SELECT count(*)::int AS missing FROM product_units
            WHERE unit_code IS NULL`,
        ),
      );

      expect(missing).toBe(0);
    });
  });

  // ---- Intake ----

  describe('intake', () => {
    it('a stock purchase gives each unit its own code', async () => {
      const ctx = await setup();

      const res = await stockPurchase(ctx, [
        {
          product_id: ctx.phone.id,
          quantity: 2,
          unit_buying_price: '500.00',
          unit_identifiers: [{ imei_number: IMEI }, { imei_number: IMEI_2 }],
        },
        {
          product_id: ctx.hub.id,
          quantity: 1,
          unit_buying_price: '500.00',
          unit_identifiers: [{ serial_number: SERIAL }],
        },
      ]);

      expect(res.status).toBe(201);
      const codes = [
        ...(await unitsOf(ctx.phone)),
        ...(await unitsOf(ctx.hub)),
      ].map((unit) => unit.unit_code);
      expect(new Set(codes).size).toBe(3);
      expect(codes.every((code) => /^SLU[0-9]{8,}$/.test(code))).toBe(true);
    });

    it('a phone purchase gives its unit a code', async () => {
      const ctx = await setup();

      const res = await http('post', '/phone-purchases', ctx.cookies.cashierA, {
        customer_id: ctx.customer.id,
        branch_id: ctx.branchA.id,
        product_id: ctx.phone.id,
        imei: IMEI,
        buying_price: 500,
      });

      expect(res.status).toBe(201);
      const [unit] = await unitsOf(ctx.phone);
      expect(unit.unit_code).toMatch(/^SLU[0-9]{8,}$/);
    });

    it('a trade-in gives its unit a code when the sale completes', async () => {
      const ctx = await setup();
      expect(
        (
          await stockPurchase(ctx, [
            {
              product_id: ctx.cable.id,
              quantity: 5,
              unit_buying_price: '500.00',
            },
          ])
        ).status,
      ).toBe(201);
      const sale = await seedDraft(ctx, ctx.customer.id);
      expect(
        (
          await addLine(sale.id, ctx.cookies.cashierA, {
            product_id: ctx.cable.id,
            quantity: 1,
          })
        ).status,
      ).toBe(201);
      await dataSource.getRepository(Payment).save(
        dataSource.getRepository(Payment).create({
          sale_id: sale.id,
          payment_method: PaymentMethod.TRADE_IN,
          amount: '1000.00',
          cash_received: null,
          trade_in_product_id: ctx.phone.id,
          trade_in_imei: IMEI,
          trade_in_buying_price: '1000.00',
          trade_in_selling_price: '1500.00',
          trade_in_notes: null,
        }),
      );
      await dataSource
        .getRepository(Sale)
        .update(sale.id, { amount_paid: '1000.00' });

      const res = await http(
        'post',
        `/sales/${sale.id}/complete`,
        ctx.cookies.cashierA,
      );

      expect(res.status).toBe(200);
      const [unit] = await unitsOf(ctx.phone);
      expect(unit.unit_code).toMatch(/^SLU[0-9]{8,}$/);
    });

    it('a bought-back phone gets a new code on its new row', async () => {
      const ctx = await setup();
      const sold = await seedUnit(ctx, { status: ProductUnitStatus.SOLD });

      const back = await seedUnit(ctx);

      expect(back.id).not.toBe(sold.id);
      expect(back.unit_code).not.toBe(sold.unit_code);
    });

    it('refuses a code as a stock purchase identifier', async () => {
      const ctx = await setup();

      const res = await stockPurchase(ctx, [
        {
          product_id: ctx.hub.id,
          quantity: 1,
          unit_buying_price: '500.00',
          unit_identifiers: [{ serial_number: 'SLU00000123' }],
        },
      ]);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/is a unit code/);
      expect(await unitsOf(ctx.hub)).toHaveLength(0);
    });

    it('accepts a serial number that only resembles a code', async () => {
      const ctx = await setup();

      const res = await stockPurchase(ctx, [
        {
          product_id: ctx.hub.id,
          quantity: 1,
          unit_buying_price: '500.00',
          unit_identifiers: [{ serial_number: 'SLU1234567' }],
        },
      ]);

      expect(res.status).toBe(201);
    });

    it('refuses a code as a phone purchase IMEI', async () => {
      const ctx = await setup();

      const res = await http('post', '/phone-purchases', ctx.cookies.cashierA, {
        customer_id: ctx.customer.id,
        branch_id: ctx.branchA.id,
        product_id: ctx.phone.id,
        imei: 'SLU00000123',
        buying_price: 500,
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/is a unit code/);
    });

    it('refuses a code as a trade-in IMEI', async () => {
      const ctx = await setup();
      const sale = await seedDraft(ctx, ctx.customer.id);
      await addLine(sale.id, ctx.cookies.cashierA, {
        product_id: ctx.cable.id,
        quantity: 1,
      });

      const res = await http(
        'post',
        `/sales/${sale.id}/payments`,
        ctx.cookies.cashierA,
        {
          payment_method: PaymentMethod.TRADE_IN,
          amount: 500,
          trade_in_product_id: ctx.phone.id,
          trade_in_imei: 'SLU00000123',
          trade_in_buying_price: 500,
        },
      );

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/is a unit code/);
    });

    it('refuses a code on an external sale line', async () => {
      const ctx = await setup();
      const sale = await seedDraft(ctx);

      const res = await addLine(sale.id, ctx.cookies.cashierA, {
        product_id: ctx.phone.id,
        quantity: 1,
        external_supplier_id: ctx.supplier.id,
        imei_snapshot: 'SLU00000123',
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/is a unit code/);
    });
  });

  // ---- The till lookup ----

  describe('GET /product-units/sellable/by-identifier/:identifier', () => {
    it('resolves a code to the real IMEI, and does not return the code', async () => {
      const ctx = await setup();
      const unit = await seedUnit(ctx);

      const res = await lookup(
        unit.unit_code,
        ctx.branchA,
        ctx.cookies.cashierA,
      );

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        identifier: IMEI,
        identifierType: TrackingMethod.IMEI,
        unitId: unit.id,
      });
      expect(JSON.stringify(res.body)).not.toContain(unit.unit_code);
    });

    it('resolves a code to the real serial number', async () => {
      const ctx = await setup();
      const unit = await seedUnit(ctx, {
        product_id: ctx.hub.id,
        imei: SERIAL,
        imei_number: null,
        serial_number: SERIAL,
      });

      const res = await lookup(
        unit.unit_code,
        ctx.branchA,
        ctx.cookies.cashierA,
      );

      expect(res.body).toMatchObject({
        identifier: SERIAL,
        identifierType: TrackingMethod.SERIAL_NUMBER,
      });
    });

    it('reads a code in lower case', async () => {
      const ctx = await setup();
      const unit = await seedUnit(ctx);

      const res = await lookup(
        unit.unit_code.toLowerCase(),
        ctx.branchA,
        ctx.cookies.cashierA,
      );

      expect(res.status).toBe(200);
      expect(res.body.unitId).toBe(unit.id);
    });

    it.each([ProductUnitStatus.SOLD, ProductUnitStatus.INSPECTION])(
      'refuses the code of a %s unit',
      async (status) => {
        const ctx = await setup();
        const unit = await seedUnit(ctx, { status });

        const res = await lookup(
          unit.unit_code,
          ctx.branchA,
          ctx.cookies.cashierA,
        );

        expect(res.status).toBe(409);
        expect(res.body.existing_unit.status).toBe(status);
      },
    );

    it('refuses a sold code, not redirecting to a newer row of the same IMEI', async () => {
      const ctx = await setup();
      const sold = await seedUnit(ctx, { status: ProductUnitStatus.SOLD });
      const back = await seedUnit(ctx);

      const byCode = await lookup(
        sold.unit_code,
        ctx.branchA,
        ctx.cookies.cashierA,
      );
      const byImei = await lookup(IMEI, ctx.branchA, ctx.cookies.cashierA);

      expect(byCode.status).toBe(409);
      expect(byCode.body.existing_unit.id).toBe(sold.id);
      expect(byImei.status).toBe(200);
      expect(byImei.body.unitId).toBe(back.id);
    });

    it('answers a code at another branch exactly like an unknown one', async () => {
      const ctx = await setup();
      const unit = await seedUnit(ctx);

      const elsewhere = await lookup(
        unit.unit_code,
        ctx.branchB,
        ctx.cookies.cashierB,
      );
      const unknown = await lookup(
        'SLU99999999',
        ctx.branchB,
        ctx.cookies.cashierB,
      );

      expect(elsewhere.status).toBe(404);
      expect(elsewhere.body.message).toBe(NO_MATCH);
      expect(unknown.status).toBe(404);
      expect(unknown.body.message).toBe(elsewhere.body.message);
    });

    it('still finds an older unit whose serial number looks like a code', async () => {
      const ctx = await setup();
      const older = await seedUnit(ctx, {
        product_id: ctx.hub.id,
        imei: 'SLU99999998',
        imei_number: null,
        serial_number: 'SLU99999998',
      });

      const res = await lookup(
        'SLU99999998',
        ctx.branchA,
        ctx.cookies.cashierA,
      );

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        identifier: 'SLU99999998',
        unitId: older.id,
      });
    });

    it('still finds an IMEI and a serial number', async () => {
      const ctx = await setup();
      const phone = await seedUnit(ctx);
      const hub = await seedUnit(ctx, {
        product_id: ctx.hub.id,
        imei: SERIAL,
        imei_number: null,
        serial_number: SERIAL,
      });

      const byImei = await lookup(IMEI, ctx.branchA, ctx.cookies.cashierA);
      const bySerial = await lookup(SERIAL, ctx.branchA, ctx.cookies.cashierA);

      expect(byImei.body.unitId).toBe(phone.id);
      expect(bySerial.body.unitId).toBe(hub.id);
    });
  });

  // ---- The sale ----

  describe('selling by code', () => {
    it('the IMEI prompt: stores the real IMEI on the line, not the code', async () => {
      const ctx = await setup();
      const unit = await seedUnit(ctx);
      const sale = await seedDraft(ctx);

      const res = await addLine(sale.id, ctx.cookies.cashierA, {
        product_id: ctx.phone.id,
        quantity: 1,
        imei_snapshot: unit.unit_code,
      });

      expect(res.status).toBe(201);
      const line = await lineOf(sale.id);
      expect(line.imei_snapshot).toBe(IMEI);
      expect(line.product_unit_id).toBe(unit.id);
      expect(line.identifier_type_snapshot).toBe(TrackingMethod.IMEI);
    });

    it('the serial prompt: stores the real serial number', async () => {
      const ctx = await setup();
      const unit = await seedUnit(ctx, {
        product_id: ctx.hub.id,
        imei: SERIAL,
        imei_number: null,
        serial_number: SERIAL,
      });
      const sale = await seedDraft(ctx);

      await addLine(sale.id, ctx.cookies.cashierA, {
        product_id: ctx.hub.id,
        quantity: 1,
        identifier_snapshot: unit.unit_code,
      });

      const line = await lineOf(sale.id);
      expect(line.imei_snapshot).toBe(SERIAL);
      expect(line.identifier_type_snapshot).toBe(TrackingMethod.SERIAL_NUMBER);
    });

    it('refuses a sold code, leaving the newer row of the same IMEI alone', async () => {
      const ctx = await setup();
      const sold = await seedUnit(ctx, { status: ProductUnitStatus.SOLD });
      await seedUnit(ctx);
      const sale = await seedDraft(ctx);

      const res = await addLine(sale.id, ctx.cookies.cashierA, {
        product_id: ctx.phone.id,
        quantity: 1,
        imei_snapshot: sold.unit_code,
      });

      expect(res.status).toBe(409);
      expect(
        await dataSource.getRepository(SaleLine).countBy({ sale_id: sale.id }),
      ).toBe(0);
    });

    it('answers a code at another branch exactly like an unknown one', async () => {
      const ctx = await setup();
      const unit = await seedUnit(ctx, { branch_id: ctx.branchB.id });
      const sale = await seedDraft(ctx);

      const elsewhere = await addLine(sale.id, ctx.cookies.cashierA, {
        product_id: ctx.phone.id,
        quantity: 1,
        imei_snapshot: unit.unit_code,
      });
      const unknown = await addLine(sale.id, ctx.cookies.cashierA, {
        product_id: ctx.phone.id,
        quantity: 1,
        imei_snapshot: 'SLU99999999',
      });

      expect(elsewhere.status).toBe(400);
      expect(elsewhere.body.message).toBe(NO_MATCH);
      expect(unknown.status).toBe(400);
      expect(unknown.body.message).toBe(elsewhere.body.message);
    });

    it('scan to completed sale: the record shows the IMEI, and the old code then fails', async () => {
      const ctx = await setup();
      expect(
        (
          await stockPurchase(ctx, [
            {
              product_id: ctx.phone.id,
              quantity: 1,
              unit_buying_price: '500.00',
              unit_selling_price: '1000.00',
              unit_identifiers: [{ imei_number: IMEI }],
            },
          ])
        ).status,
      ).toBe(201);
      const [unit] = await unitsOf(ctx.phone);

      // As the till does: resolve the code, then add the real identifier.
      const scanned = await lookup(
        unit.unit_code,
        ctx.branchA,
        ctx.cookies.cashierA,
      );
      const sale = await seedDraft(ctx);
      expect(
        (
          await addLine(sale.id, ctx.cookies.cashierA, {
            product_id: ctx.phone.id,
            quantity: 1,
            imei_snapshot: scanned.body.identifier,
            product_unit_id: scanned.body.unitId,
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await http(
            'post',
            `/sales/${sale.id}/payments`,
            ctx.cookies.cashierA,
            {
              payment_method: PaymentMethod.CASH,
              amount: 1000,
              cash_received: 1000,
            },
          )
        ).status,
      ).toBe(201);
      expect(
        (await http('post', `/sales/${sale.id}/complete`, ctx.cookies.cashierA))
          .status,
      ).toBe(200);

      const record = await http(
        'get',
        `/sales/${sale.id}`,
        ctx.cookies.cashierA,
      );

      expect(record.body.lines[0].imei_snapshot).toBe(IMEI);
      expect(record.body.lines[0].product_unit_id).toBe(unit.id);
      expect(JSON.stringify(record.body)).not.toContain(unit.unit_code);
      expect(
        (await lookup(unit.unit_code, ctx.branchA, ctx.cookies.cashierA))
          .status,
      ).toBe(409);
    });
  });

  describe('selling the exact unit scanned', () => {
    const addExact = (ctx: Ctx, saleId: string, unit: ProductUnit) =>
      addLine(saleId, ctx.cookies.cashierA, {
        product_id: ctx.phone.id,
        quantity: 1,
        imei_snapshot: IMEI,
        product_unit_id: unit.id,
      });

    it('refuses a unit sold since the scan, though the same phone is back in stock', async () => {
      const ctx = await setup();
      const scanned = await seedUnit(ctx);
      await dataSource
        .getRepository(ProductUnit)
        .update(scanned.id, { status: ProductUnitStatus.SOLD });
      await seedUnit(ctx);
      const sale = await seedDraft(ctx);

      const res = await addExact(ctx, sale.id, scanned);

      expect(res.status).toBe(409);
      expect(
        await dataSource.getRepository(SaleLine).countBy({ sale_id: sale.id }),
      ).toBe(0);
    });

    it('answers a unit at another branch exactly like an unknown id', async () => {
      const ctx = await setup();
      const elsewhere = await seedUnit(ctx, { branch_id: ctx.branchB.id });
      const sale = await seedDraft(ctx);

      const atOtherBranch = await addExact(ctx, sale.id, elsewhere);
      const unknown = await addExact(ctx, sale.id, {
        ...elsewhere,
        id: randomUUID(),
      });

      expect(atOtherBranch.status).toBe(400);
      expect(unknown.status).toBe(400);
      expect(unknown.body.message).toBe(atOtherBranch.body.message);
    });

    it("refuses an identifier that is not the unit's own", async () => {
      const ctx = await setup();
      const unit = await seedUnit(ctx, {
        imei: IMEI_2,
        imei_number: IMEI_2,
      });
      const sale = await seedDraft(ctx);

      const res = await addExact(ctx, sale.id, unit);

      expect(res.status).toBe(400);
    });
  });

  // ---- Staff reads ----

  describe('search and details', () => {
    it('search finds part of a code and returns it', async () => {
      const ctx = await setup();
      const unit = await seedUnit(ctx);

      const res = await http(
        'get',
        `/product-units/search?q=${unit.unit_code.slice(-6)}`,
        ctx.cookies.admin,
      );

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].unit_code).toBe(unit.unit_code);
    });

    it('details return the code', async () => {
      const ctx = await setup();
      const unit = await seedUnit(ctx);

      const res = await http(
        'get',
        `/product-units/${unit.id}/details`,
        ctx.cookies.managerA,
      );

      expect(res.status).toBe(200);
      expect(res.body.unit.unit_code).toBe(unit.unit_code);
    });
  });
});
