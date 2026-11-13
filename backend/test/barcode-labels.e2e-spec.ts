import { INestApplication } from '@nestjs/common';
import request, { Response } from 'supertest';
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
import { ProductUnit } from '../src/product-units/entities/product-unit.entity';
import { ProductUnitStatus } from '../src/product-units/enums/product-unit-status.enum';

/**
 * Barcode Labels (Stage 2): GET /barcode-labels/products, GET
 * /barcode-labels/units and POST /barcode-labels/resolve against the test
 * database, through the full app (guards, ValidationPipe, serializer).
 *
 * Products and units are inserted directly: only their columns matter. Every
 * one carries a buying price the responses must never hold, and the check
 * looks for that value as well as the key. unit_code comes from the
 * database default, as in production.
 *
 * One app, seeded once; the `it` blocks read that data and change nothing.
 * Sessions are minted with AuthService.login, not the login endpoint, to
 * stay inside the login throttle.
 */
describe('Barcode labels (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  let branchA: Branch;
  let branchB: Branch;
  let charger: Product;
  let chargerLookalike: Product;
  let cable: Product;
  let inactiveCharger: Product;
  let phone: Product;
  let laptop: Product;
  let inactivePhone: Product;
  let phoneAtA: ProductUnit;
  let soldPhoneAtA: ProductUnit;
  let phoneAtB: ProductUnit;
  let laptopAtA: ProductUnit;
  let inactivePhoneAtA: ProductUnit;

  const cookies = {} as Record<'admin' | 'managerA' | 'cashierA', string[]>;

  const BUYING = '81234.00';

  const http = () => request(app.getHttpServer());
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function get(
    path: string,
    params: Record<string, string | number> = {},
    as: keyof typeof cookies | null = 'admin',
  ): Promise<Response> {
    await pause(150); // stay under the 10 req/s throttler
    const req = http().get(`/api/v1/barcode-labels/${path}`).query(params);
    return as ? req.set('Cookie', cookies[as]) : req;
  }

  async function resolve(
    body: unknown,
    as: keyof typeof cookies | null = 'admin',
  ): Promise<Response> {
    await pause(150);
    const req = http()
      .post('/api/v1/barcode-labels/resolve')
      .send(body as object);
    return as ? req.set('Cookie', cookies[as]) : req;
  }

  interface Page<T> {
    data: T[];
    meta: { total: number; page: number; limit: number; hasNext: boolean };
  }
  const pageOf = <T>(res: Response) => res.body as Page<T>;
  const ids = (res: Response, key: 'product_id' | 'unit_id') =>
    pageOf<Record<string, string>>(res)
      .data.map((row) => row[key])
      .sort();

  async function seedUser(
    role: UserRole,
    email: string,
    branch: Branch | null,
  ): Promise<User> {
    const repo = dataSource.getRepository(User);
    return repo.save(
      repo.create({
        email,
        password_hash: 'not-used',
        full_name: `Test ${email.split('@')[0]}`,
        role,
        is_active: true,
        branch_id: branch?.id ?? null,
      }),
    );
  }

  async function sessionFor(user: User): Promise<string[]> {
    const tokens = await app.get(AuthService).login(user, null, null);
    return [
      `access_token=${tokens.access_token}`,
      `refresh_token=${tokens.refresh_token}`,
    ];
  }

  async function seedProduct(
    fields: Partial<Product> & {
      name: string;
      sku: string;
      tracking_method: TrackingMethod;
    },
    brandId: string,
    categoryId: string,
  ): Promise<Product> {
    const repo = dataSource.getRepository(Product);
    return repo.save(
      repo.create({
        barcode: `BC-${fields.sku}`,
        brand_id: brandId,
        category_id: categoryId,
        buying_price: BUYING,
        selling_price: '4500.00',
        is_active: true,
        is_serialized: fields.tracking_method !== TrackingMethod.QUANTITY,
        ...fields,
      }),
    );
  }

  async function seedUnit(
    product: Product,
    branch: Branch,
    identifiers: {
      imei: string;
      imei_number?: string | null;
      serial_number?: string | null;
    },
    overrides: Partial<ProductUnit> = {},
  ): Promise<ProductUnit> {
    const repo = dataSource.getRepository(ProductUnit);
    const saved = await repo.save(
      repo.create({
        product_id: product.id,
        branch_id: branch.id,
        status: ProductUnitStatus.IN_STOCK,
        buying_price: BUYING,
        selling_price: null,
        phone_purchase_id: null,
        imei_number: null,
        serial_number: null,
        ...identifiers,
        ...overrides,
      }),
    );
    // Re-read for the database-generated unit_code.
    return repo.findOneByOrFail({ id: saved.id });
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
      .save({ name: 'City Shop', is_active: true } as Branch);
    const admin = await seedUser(UserRole.ADMIN, 'admin@labels.test', null);
    const managerA = await seedUser(
      UserRole.MANAGER,
      'manager-a@labels.test',
      branchA,
    );
    const cashierA = await seedUser(
      UserRole.CASHIER,
      'cashier-a@labels.test',
      branchA,
    );
    cookies.admin = await sessionFor(admin);
    cookies.managerA = await sessionFor(managerA);
    cookies.cashierA = await sessionFor(cashierA);

    const brand = await dataSource
      .getRepository(Brand)
      .save({ name: 'Brand', is_active: true } as Brand);
    const category = await dataSource
      .getRepository(Category)
      .save({ name: 'Category', is_active: true } as Category);
    const b = brand.id;
    const c = category.id;

    charger = await seedProduct(
      {
        name: 'Charger 50% Off',
        sku: 'SKU-CHG_1',
        tracking_method: TrackingMethod.QUANTITY,
      },
      b,
      c,
    );
    // Would match "50%" and "CHG_1" if % and _ were wildcards.
    chargerLookalike = await seedProduct(
      {
        name: 'Charger 50X Off',
        sku: 'SKU-CHGX1',
        tracking_method: TrackingMethod.QUANTITY,
      },
      b,
      c,
    );
    cable = await seedProduct(
      {
        name: 'Plain Cable',
        sku: 'SKU-CABLE',
        barcode: 'CABLE-BARCODE-77',
        selling_price: null,
        tracking_method: TrackingMethod.QUANTITY,
      },
      b,
      c,
    );
    inactiveCharger = await seedProduct(
      {
        name: 'Inactive Charger',
        sku: 'SKU-OLD',
        is_active: false,
        tracking_method: TrackingMethod.QUANTITY,
      },
      b,
      c,
    );
    phone = await seedProduct(
      {
        name: 'Galaxy Phone',
        sku: 'SKU-PHONE',
        selling_price: '190000.00',
        tracking_method: TrackingMethod.IMEI,
      },
      b,
      c,
    );
    laptop = await seedProduct(
      {
        name: 'Work Laptop',
        sku: 'SKU-LAPTOP',
        selling_price: '240000.00',
        tracking_method: TrackingMethod.SERIAL_NUMBER,
      },
      b,
      c,
    );
    inactivePhone = await seedProduct(
      {
        name: 'Retired Phone',
        sku: 'SKU-RETIRED',
        is_active: false,
        tracking_method: TrackingMethod.IMEI,
      },
      b,
      c,
    );

    phoneAtA = await seedUnit(phone, branchA, {
      imei: '356789000000011',
      imei_number: '356789000000011',
    });
    soldPhoneAtA = await seedUnit(
      phone,
      branchA,
      { imei: '356789000000022', imei_number: '356789000000022' },
      { status: ProductUnitStatus.SOLD },
    );
    phoneAtB = await seedUnit(phone, branchB, {
      imei: '356789000000033',
      imei_number: '356789000000033',
    });
    laptopAtA = await seedUnit(
      laptop,
      branchA,
      { imei: 'LAP-SN-0001', serial_number: 'LAP-SN-0001' },
      { selling_price: '250000.00' },
    );
    inactivePhoneAtA = await seedUnit(inactivePhone, branchA, {
      imei: '356789000000044',
      imei_number: '356789000000044',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('access', () => {
    it.each([
      ['GET', 'products'],
      ['GET', 'units'],
      ['POST', 'resolve'],
    ])('refuses %s %s without a session (401)', async (method, path) => {
      const res =
        method === 'GET'
          ? await get(path, {}, null)
          : await resolve({ items: [] }, null);
      expect(res.status).toBe(401);
    });

    it.each([
      ['GET', 'products'],
      ['GET', 'units'],
      ['POST', 'resolve'],
    ])('refuses %s %s for a cashier (403)', async (method, path) => {
      const res =
        method === 'GET'
          ? await get(path, {}, 'cashierA')
          : await resolve(
              {
                items: [
                  { type: 'PRODUCT', productId: charger.id, quantity: 1 },
                ],
              },
              'cashierA',
            );
      expect(res.status).toBe(403);
    });

    it('lets a manager search products and units', async () => {
      expect((await get('products', {}, 'managerA')).status).toBe(200);
      expect((await get('units', {}, 'managerA')).status).toBe(200);
    });
  });

  describe('GET /barcode-labels/products', () => {
    it('lists active QUANTITY products only', async () => {
      const res = await get('products');

      expect(res.status).toBe(200);
      expect(ids(res, 'product_id')).toEqual(
        [charger.id, chargerLookalike.id, cable.id].sort(),
      );
      expect(ids(res, 'product_id')).not.toContain(inactiveCharger.id);
      expect(ids(res, 'product_id')).not.toContain(phone.id);
      expect(ids(res, 'product_id')).not.toContain(laptop.id);
    });

    it('returns exactly the label fields, a decimal string or null price, and no cost', async () => {
      const res = await get('products', { search: 'charger 50%' });

      expect(pageOf(res).data).toEqual([
        {
          kind: 'PRODUCT',
          product_id: charger.id,
          name: 'Charger 50% Off',
          model: null,
          sku: 'SKU-CHG_1',
          barcode: 'BC-SKU-CHG_1',
          barcode_type: 'CODE_128',
          selling_price: '4500.00',
        },
      ]);
      const cableRow = pageOf<{ selling_price: string | null }>(
        await get('products', { search: 'plain cable' }),
      ).data[0];
      expect(cableRow.selling_price).toBeNull();
      expect(JSON.stringify(res.body)).not.toContain(BUYING);
      expect(JSON.stringify(res.body)).not.toContain('buying_price');
    });

    it('matches name, SKU and barcode in any case', async () => {
      expect(
        ids(await get('products', { search: 'PLAIN' }), 'product_id'),
      ).toEqual([cable.id]);
      expect(
        ids(await get('products', { search: 'sku-cable' }), 'product_id'),
      ).toEqual([cable.id]);
      expect(
        ids(await get('products', { search: 'cable-barcode' }), 'product_id'),
      ).toEqual([cable.id]);
    });

    it('treats % and _ as literal characters', async () => {
      expect(
        ids(await get('products', { search: '50%' }), 'product_id'),
      ).toEqual([charger.id]);
      expect(
        ids(await get('products', { search: 'CHG_1' }), 'product_id'),
      ).toEqual([charger.id]);
    });

    it('pages with limit and page', async () => {
      const first = pageOf(await get('products', { limit: 2, page: 1 }));
      const second = pageOf(await get('products', { limit: 2, page: 2 }));

      expect(first.meta).toMatchObject({
        total: 3,
        page: 1,
        limit: 2,
        hasNext: true,
      });
      expect(first.data).toHaveLength(2);
      expect(second.data).toHaveLength(1);
    });

    it('refuses a 1-character search, limit over 200 and unknown params', async () => {
      expect((await get('products', { search: 'a' })).status).toBe(400);
      expect((await get('products', { limit: 201 })).status).toBe(400);
      expect((await get('products', { trackingMethod: 'IMEI' })).status).toBe(
        400,
      );
    });
  });

  describe('GET /barcode-labels/units', () => {
    it('lists IN_STOCK units of active serialized products at every branch for an admin', async () => {
      const res = await get('units');

      expect(ids(res, 'unit_id')).toEqual(
        [phoneAtA.id, phoneAtB.id, laptopAtA.id].sort(),
      );
      expect(ids(res, 'unit_id')).not.toContain(soldPhoneAtA.id);
      expect(ids(res, 'unit_id')).not.toContain(inactivePhoneAtA.id);
    });

    it('holds a manager to their own branch', async () => {
      const own = await get('units', {}, 'managerA');
      expect(ids(own, 'unit_id')).toEqual([phoneAtA.id, laptopAtA.id].sort());

      const other = await get('units', { branchId: branchB.id }, 'managerA');
      expect(other.status).toBe(403);
      expect(other.body).toMatchObject({ code: 'WRONG_BRANCH' });
    });

    it('lets an admin narrow to one branch', async () => {
      expect(
        ids(await get('units', { branchId: branchB.id }), 'unit_id'),
      ).toEqual([phoneAtB.id]);
    });

    it('maps an IMEI unit: the generated unit_code, the IMEI as text, the product price as fallback', async () => {
      const res = await get('units', { search: '356789000000011' });

      expect(phoneAtA.unit_code).toMatch(/^SLU[0-9]{8,}$/);
      expect(pageOf(res).data).toEqual([
        {
          kind: 'UNIT',
          unit_id: phoneAtA.id,
          unit_code: phoneAtA.unit_code,
          product_id: phone.id,
          name: 'Galaxy Phone',
          tracking_method: 'IMEI',
          identifier_type: 'IMEI',
          identifier: '356789000000011',
          selling_price: '190000.00',
          branch: { id: branchA.id, name: 'Main Shop' },
        },
      ]);
      expect(JSON.stringify(res.body)).not.toContain(BUYING);
    });

    it('maps a serial unit to its serial number and its own price', async () => {
      const [row] = pageOf<Record<string, unknown>>(
        await get('units', { search: 'lap-sn' }),
      ).data;

      expect(row).toMatchObject({
        unit_id: laptopAtA.id,
        unit_code: laptopAtA.unit_code,
        tracking_method: 'SERIAL_NUMBER',
        identifier_type: 'SERIAL_NUMBER',
        identifier: 'LAP-SN-0001',
        selling_price: '250000.00',
      });
    });

    it('finds a unit by its unit code', async () => {
      expect(
        ids(
          await get('units', { search: phoneAtB.unit_code.toLowerCase() }),
          'unit_id',
        ),
      ).toEqual([phoneAtB.id]);
    });
  });

  describe('POST /barcode-labels/resolve', () => {
    interface Problem {
      index: number;
      reason: string;
    }
    const reasonsOf = (res: Response) =>
      (res.body as { errors: Problem[] }).errors.map((p) => [
        p.index,
        p.reason,
      ]);

    it('resolves a mixed queue in order with total_labels (200, not 201)', async () => {
      const res = await resolve(
        {
          items: [
            { type: 'UNIT', unitId: laptopAtA.id },
            { type: 'PRODUCT', productId: charger.id, quantity: 2 },
            { type: 'UNIT', unitId: phoneAtA.id },
            { type: 'PRODUCT', productId: cable.id, quantity: 3 },
          ],
        },
        'managerA',
      );

      expect(res.status).toBe(200);
      const body = res.body as {
        data: Record<string, unknown>[];
        total_labels: number;
      };
      expect(body.data.map((row) => row.kind)).toEqual([
        'UNIT',
        'PRODUCT',
        'UNIT',
        'PRODUCT',
      ]);
      expect(body.data[0]).toMatchObject({ unit_code: laptopAtA.unit_code });
      expect(body.data[1]).toMatchObject({
        product_id: charger.id,
        quantity: 2,
      });
      expect(body.data[3]).toMatchObject({
        product_id: cable.id,
        quantity: 3,
        selling_price: null,
      });
      expect(body.total_labels).toBe(7);
      expect(JSON.stringify(res.body)).not.toContain(BUYING);
    });

    it('refuses the whole queue and names every bad item', async () => {
      const res = await resolve(
        {
          items: [
            { type: 'PRODUCT', productId: charger.id, quantity: 1 },
            { type: 'UNIT', unitId: phoneAtB.id },
            { type: 'UNIT', unitId: soldPhoneAtA.id },
            { type: 'UNIT', unitId: inactivePhoneAtA.id },
            { type: 'PRODUCT', productId: inactiveCharger.id, quantity: 1 },
            { type: 'PRODUCT', productId: phone.id, quantity: 1 },
            { type: 'UNIT', unitId: phoneAtA.id },
            { type: 'UNIT', unitId: phoneAtA.id },
          ],
        },
        'managerA',
      );

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'INVALID_LABEL_ITEMS' });
      expect(res.body).not.toHaveProperty('data');
      expect(reasonsOf(res)).toEqual([
        [1, 'UNIT_NOT_FOUND'],
        [2, 'UNIT_NOT_IN_STOCK'],
        [3, 'UNIT_PRODUCT_INACTIVE'],
        [4, 'PRODUCT_INACTIVE'],
        [5, 'PRODUCT_NOT_QUANTITY_TRACKED'],
        [7, 'DUPLICATE_UNIT'],
      ]);
    });

    it('lets an admin resolve a unit at any branch, and refuses a manager naming another', async () => {
      const admin = await resolve({
        items: [{ type: 'UNIT', unitId: phoneAtB.id }],
      });
      expect(admin.status).toBe(200);

      const manager = await resolve(
        {
          branchId: branchB.id,
          items: [{ type: 'UNIT', unitId: phoneAtB.id }],
        },
        'managerA',
      );
      expect(manager.status).toBe(403);
      expect(manager.body).toMatchObject({ code: 'WRONG_BRANCH' });
    });

    it('refuses more than 500 labels in all', async () => {
      const res = await resolve({
        items: [
          { type: 'PRODUCT', productId: charger.id, quantity: 500 },
          { type: 'UNIT', unitId: phoneAtA.id },
        ],
      });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        code: 'LABEL_LIMIT_EXCEEDED',
        total_labels: 501,
        max_labels: 500,
      });
    });

    it.each([
      ['a zero quantity', [{ type: 'PRODUCT', quantity: 0 }]],
      ['a string quantity', [{ type: 'PRODUCT', quantity: '2' }]],
      ['quantity on a unit', [{ type: 'UNIT', quantity: 2 }]],
      ['a null item', [null]],
      ['an unknown type', [{ type: 'BOTH' }]],
    ])('refuses %s with a 400', async (_label, items) => {
      const fixed = (items as Record<string, unknown>[]).map((item) =>
        item && item.type === 'PRODUCT'
          ? { productId: charger.id, ...item }
          : item && item.type === 'UNIT'
            ? { unitId: phoneAtA.id, ...item }
            : item,
      );
      const res = await resolve({ items: fixed });
      expect(res.status).toBe(400);
    });
  });
});
