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
import { PhonePurchase } from '../src/phone-purchases/entities/phone-purchase.entity';
import { Customer } from '../src/customers/entities/customer.entity';

/**
 * GET /product-units/search (INV-F3): partial, case-insensitive search over
 * a unit's identifiers and its product's SKU and name, inside the caller's
 * branch scope, across every status.
 *
 * The units are inserted directly: only their columns matter here, and the
 * chosen values are what each test searches for. The customer and prices
 * hold values the response must never carry, and the privacy check looks for
 * those values as well as the keys, so it can't pass because they were empty.
 *
 * One app, seeded once; the `it` blocks read that data and change nothing.
 */
describe('Product unit search (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  let branchA: Branch;
  let branchB: Branch;
  let galaxy: Product;
  let percentCase: Product;
  let tied: Product;

  const cookies = {} as Record<
    'admin' | 'managerA' | 'managerB' | 'cashierA',
    string[]
  >;

  const BUYING = '81234.00';
  const SELLING = '101234.00';
  const CUSTOMER_PHONE = '0771234567';
  const CUSTOMER_NIC = '199300000001';
  const CUSTOMER_EMAIL = 'kamal@search.test';
  const NOTE = 'Private note about the seller';

  const ALLOWED_ROW_KEYS = [
    'branch',
    'created_at',
    'id',
    'imei',
    'imei_number',
    'product',
    'product_id',
    'serial_number',
    'status',
  ];

  const http = () => request(app.getHttpServer());
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

  interface Row {
    id: string;
    imei: string;
    status: string;
    branch: { name: string };
  }

  async function search(
    params: Record<string, string | number>,
    as: keyof typeof cookies = 'admin',
  ): Promise<Response> {
    await pause(150); // stay under the 10 req/s throttler
    return http()
      .get('/api/v1/product-units/search')
      .query(params)
      .set('Cookie', cookies[as]);
  }

  const rowsOf = (res: Response): Row[] => (res.body as { data: Row[] }).data;
  const imeisOf = (res: Response): string[] =>
    rowsOf(res)
      .map((row) => row.imei)
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
    name: string,
    sku: string,
    brandId: string,
    categoryId: string,
  ): Promise<Product> {
    const repo = dataSource.getRepository(Product);
    return repo.save(
      repo.create({
        name,
        sku,
        barcode: `BC-${sku}`,
        brand_id: brandId,
        category_id: categoryId,
        buying_price: BUYING,
        selling_price: SELLING,
        is_active: true,
        is_serialized: true,
        tracking_method: TrackingMethod.IMEI,
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
    return repo.save(
      repo.create({
        product_id: product.id,
        branch_id: branch.id,
        status: ProductUnitStatus.IN_STOCK,
        buying_price: BUYING,
        selling_price: SELLING,
        phone_purchase_id: null,
        imei_number: null,
        serial_number: null,
        ...identifiers,
        ...overrides,
      }),
    );
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
    const admin = await seedUser(UserRole.ADMIN, 'admin@search.test', null);
    const managerA = await seedUser(
      UserRole.MANAGER,
      'manager-a@search.test',
      branchA,
    );
    const managerB = await seedUser(
      UserRole.MANAGER,
      'manager-b@search.test',
      branchB,
    );
    const cashierA = await seedUser(
      UserRole.CASHIER,
      'cashier-a@search.test',
      branchA,
    );
    cookies.admin = await sessionFor(admin);
    cookies.managerA = await sessionFor(managerA);
    cookies.managerB = await sessionFor(managerB);
    cookies.cashierA = await sessionFor(cashierA);

    const brand = await dataSource
      .getRepository(Brand)
      .save({ name: 'Brand', is_active: true } as Brand);
    const category = await dataSource
      .getRepository(Category)
      .save({ name: 'Category', is_active: true } as Category);
    galaxy = await seedProduct(
      'Galaxy A15 Blue',
      'SKU-GALAXY',
      brand.id,
      category.id,
    );
    percentCase = await seedProduct(
      'Case 50% Off',
      'SKU-CASE_1',
      brand.id,
      category.id,
    );
    tied = await seedProduct('Tied Batch', 'SKU-TIED', brand.id, category.id);

    const customer = await dataSource.getRepository(Customer).save({
      name: 'Kamal Perera',
      phone: CUSTOMER_PHONE,
      nic: CUSTOMER_NIC,
      email: CUSTOMER_EMAIL,
      notes: NOTE,
    });
    const purchases = dataSource.getRepository(PhonePurchase);
    const purchase = await purchases.save(
      purchases.create({
        customer_id: customer.id,
        branch_id: branchA.id,
        cashier_id: cashierA.id,
        total_amount: BUYING,
        notes: NOTE,
      }),
    );

    // Paired IMEI and serial, bought from the customer above.
    await seedUnit(
      galaxy,
      branchA,
      {
        imei: '356789000000011',
        imei_number: '356789000000011',
        serial_number: 'R58N-PAIRED-A',
      },
      { phone_purchase_id: purchase.id },
    );
    // Only the legacy column.
    await seedUnit(galaxy, branchA, { imei: 'LEGACY-IMEI-777' });
    // Serial only.
    await seedUnit(galaxy, branchA, {
      imei: 'SERIAL-ONLY-A',
      serial_number: 'SERIAL-ONLY-A',
    });
    // Another branch: same product, its own identifiers.
    await seedUnit(galaxy, branchB, {
      imei: '356789000000099',
      imei_number: '356789000000099',
      serial_number: 'SERIAL-AT-CITY',
    });
    // A bought-back IMEI: an old SOLD record, and the unit now in stock.
    await seedUnit(
      galaxy,
      branchA,
      { imei: '356789000000055', imei_number: '356789000000055' },
      { status: ProductUnitStatus.SOLD },
    );
    await seedUnit(galaxy, branchA, {
      imei: '356789000000055',
      imei_number: '356789000000055',
    });
    // Wildcards in the data, and a near miss for each.
    await seedUnit(percentCase, branchA, { imei: 'PCT-50%-OFF' });
    await seedUnit(percentCase, branchA, { imei: 'PCT-500-OFF' });
    await seedUnit(percentCase, branchA, { imei: 'UND_ER-SCORE' });
    await seedUnit(percentCase, branchA, { imei: 'UNDXER-SCORE' });
    await seedUnit(percentCase, branchA, { imei: 'BACK\\SLASH' });

    for (let i = 0; i < 30; i++) {
      await seedUnit(tied, branchA, {
        imei: `TIED-${String(i).padStart(3, '0')}`,
      });
    }
    await dataSource.query(
      `UPDATE product_units SET created_at = '2026-10-01T04:00:00Z'
        WHERE product_id = $1`,
      [tied.id],
    );
  });

  // Spaces tests out to stay under the 10 req/s throttler.
  beforeEach(() => pause(150));

  afterAll(async () => {
    await app.close();
  });

  describe('matching', () => {
    it.each([
      ['part of an IMEI', '789000000011', '356789000000011'],
      ['part of the legacy column', 'ACY-IMEI', 'LEGACY-IMEI-777'],
      ['part of a serial number', 'ONLY-A', 'SERIAL-ONLY-A'],
      ['a serial number paired with an IMEI', 'PAIRED', '356789000000011'],
    ])('finds a unit by %s', async (_, q, imei) => {
      const res = await search({ q });

      expect(res.status).toBe(200);
      expect(imeisOf(res)).toEqual([imei]);
    });

    it.each([
      ['an IMEI', '356789000000011'],
      ['the legacy column', 'legacy-imei-777'],
      ['a serial number', 'r58n-paired-a'],
    ])('ignores case on %s', async (_, q) => {
      const res = await search({ q });

      expect(rowsOf(res)).toHaveLength(1);
    });

    it('finds every unit of a product by part of its SKU, in any case', async () => {
      const res = await search({ q: 'sku-gal' });

      expect((res.body as { meta: { total: number } }).meta.total).toBe(6);
    });

    it('finds every unit of a product by part of its name, in any case', async () => {
      const res = await search({ q: 'GALAXY a15' });

      expect((res.body as { meta: { total: number } }).meta.total).toBe(6);
    });

    it('finds nothing for text no unit has', async () => {
      const res = await search({ q: 'no-such-thing' });

      expect(res.status).toBe(200);
      expect(rowsOf(res)).toEqual([]);
      expect(res.body.meta).toMatchObject({ total: 0, totalPages: 0 });
    });
  });

  describe('wildcards are literal', () => {
    it('% in a product name matches that product, and nothing by wildcard', async () => {
      const res = await search({ q: '50%' });

      expect(imeisOf(res)).toEqual([
        'BACK\\SLASH',
        'PCT-50%-OFF',
        'PCT-500-OFF',
        'UNDXER-SCORE',
        'UND_ER-SCORE',
      ]);
    });

    it('% on an identifier alone is not a wildcard', async () => {
      const res = await search({ q: 'PCT-50%' });

      expect(imeisOf(res)).toEqual(['PCT-50%-OFF']);
    });

    it('_ matches an underscore only', async () => {
      const res = await search({ q: 'UND_ER' });

      expect(imeisOf(res)).toEqual(['UND_ER-SCORE']);
    });

    it('a backslash matches a backslash', async () => {
      const res = await search({ q: 'K\\S' });

      expect(imeisOf(res)).toEqual(['BACK\\SLASH']);
    });
  });

  describe('statuses and bought-back phones', () => {
    it('returns each record of a bought-back IMEI, in every status', async () => {
      const res = await search({ q: '356789000000055' });

      expect(
        rowsOf(res)
          .map((row) => row.status)
          .sort(),
      ).toEqual([ProductUnitStatus.IN_STOCK, ProductUnitStatus.SOLD]);
      expect(new Set(rowsOf(res).map((row) => row.id)).size).toBe(2);
    });

    it('has no status filter: sending one is a 400', async () => {
      const res = await search({ q: '356789', status: 'SOLD' });

      expect(res.status).toBe(400);
    });
  });

  describe('access and branch isolation', () => {
    it('an admin searches every branch', async () => {
      const res = await search({ q: 'SERIAL-' });

      expect(imeisOf(res)).toEqual(['356789000000099', 'SERIAL-ONLY-A']);
    });

    it('an admin can narrow to one branch', async () => {
      const res = await search({ q: 'SKU-GALAXY', branchId: branchB.id });

      expect(imeisOf(res)).toEqual(['356789000000099']);
    });

    it.each([
      ['its serial number', 'SERIAL-AT-CITY'],
      ['its IMEI', '356789000000099'],
    ])('a manager finds nothing at another branch by %s', async (_, q) => {
      const res = await search({ q }, 'managerA');

      expect(res.status).toBe(200);
      expect(rowsOf(res)).toEqual([]);
    });

    it.each([
      ['SKU', 'SKU-GALAXY'],
      ['name', 'Galaxy'],
    ])(
      'a manager searching a shared product by %s gets only their branch',
      async (_, q) => {
        const res = await search({ q, limit: 200 }, 'managerA');

        expect(rowsOf(res).length).toBeGreaterThan(0);
        expect(new Set(rowsOf(res).map((row) => row.branch.name))).toEqual(
          new Set(['Main Shop']),
        );
      },
    );

    it('the other branch’s manager sees the reverse', async () => {
      const res = await search({ q: 'SKU-GALAXY' }, 'managerB');

      expect(imeisOf(res)).toEqual(['356789000000099']);
    });

    it('a manager asking for another branch gets 403 WRONG_BRANCH', async () => {
      const res = await search(
        { q: 'SKU-GALAXY', branchId: branchB.id },
        'managerA',
      );

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 'WRONG_BRANCH' });
    });

    it('a cashier gets 403', async () => {
      const res = await search({ q: 'SKU-GALAXY' }, 'cashierA');

      expect(res.status).toBe(403);
    });

    it('no session gets 401', async () => {
      await http()
        .get('/api/v1/product-units/search')
        .query({ q: 'SKU-GALAXY' })
        .expect(401);
    });

    it('a search too short is a 400, and "search" isn’t read as an id', async () => {
      const res = await search({ q: 'a' });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toContain('uuid');
    });
  });

  describe('sorting and paging', () => {
    const walk = async (
      url: string,
      params: Record<string, string>,
    ): Promise<string[]> => {
      const ids: string[] = [];
      for (let page = 1; page <= 3; page++) {
        await pause(150);
        const res = await http()
          .get(`/api/v1${url}`)
          .query({ ...params, page, limit: 10 })
          .set('Cookie', cookies.admin)
          .expect(200);
        ids.push(...rowsOf(res).map((row) => row.id));
      }
      return ids;
    };

    it('search pages neither repeat nor skip units with the same timestamp', async () => {
      const ids = await walk('/product-units/search', { q: 'SKU-TIED' });

      expect(ids).toHaveLength(30);
      expect(new Set(ids).size).toBe(30);
      expect(ids).toEqual([...ids].sort().reverse());
    });

    it('the list’s pages do the same', async () => {
      const ids = await walk('/product-units', { productId: tied.id });

      expect(ids).toHaveLength(30);
      expect(new Set(ids).size).toBe(30);
      expect(ids).toEqual([...ids].sort().reverse());
    });

    it('answers with the paging metadata', async () => {
      const res = await search({ q: 'SKU-TIED', page: 2, limit: 10 });

      expect(res.body.meta).toEqual({
        total: 30,
        page: 2,
        limit: 10,
        totalPages: 3,
        hasNext: true,
        hasPrev: true,
      });
    });
  });

  describe('privacy', () => {
    it('a row holds the permitted fields and nothing else', async () => {
      const res = await search({ q: 'PAIRED' });

      const [row] = (res.body as { data: Record<string, unknown>[] }).data;
      expect(Object.keys(row).sort()).toEqual(ALLOWED_ROW_KEYS);
      expect(row.product).toEqual({
        name: 'Galaxy A15 Blue',
        sku: 'SKU-GALAXY',
        tracking_method: TrackingMethod.IMEI,
      });
      expect(row.branch).toEqual({ name: 'Main Shop' });
    });

    it('carries no customer detail, price or note, even for a purchased unit', async () => {
      const res = await search({ q: 'SKU-GALAXY', limit: 200 });

      const text = JSON.stringify(res.body);
      expect(rowsOf(res).length).toBeGreaterThan(0);
      for (const value of [
        BUYING,
        SELLING,
        CUSTOMER_PHONE,
        CUSTOMER_NIC,
        CUSTOMER_EMAIL,
        NOTE,
        'Kamal',
      ]) {
        expect(text).not.toContain(value);
      }
      for (const key of [
        'buying_price',
        'selling_price',
        'phone_purchase',
        'sale_lines',
        'customer',
      ]) {
        expect(text).not.toContain(`"${key}"`);
      }
    });
  });

  describe('the list is unchanged', () => {
    it('GET /product-units keeps its exact imei filter and its fuller answer', async () => {
      await pause(150);
      const res = await http()
        .get('/api/v1/product-units')
        .query({ imei: '356789000000011' })
        .set('Cookie', cookies.admin)
        .expect(200);

      const body = res.body as {
        data: {
          imei: string;
          buying_price: string;
          phone_purchase: { customer: { phone: string } };
        }[];
      };
      expect(body.data).toHaveLength(1);
      expect(body.data[0].buying_price).toBe(BUYING);
      expect(body.data[0].phone_purchase.customer.phone).toBe(CUSTOMER_PHONE);
    });

    it('its exact filter doesn’t match part of an IMEI', async () => {
      await pause(150);
      const res = await http()
        .get('/api/v1/product-units')
        .query({ imei: '356789' })
        .set('Cookie', cookies.admin)
        .expect(200);

      expect(rowsOf(res)).toEqual([]);
    });
  });
});
