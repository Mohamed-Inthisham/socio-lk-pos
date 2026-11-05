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
import { Stock } from '../src/stock/entities/stock.entity';
import type {
  StockOverviewResponse,
  StockOverviewRow,
} from '../src/stock/stock-overview';

/**
 * GET /stock/overview (INV-F4): the real SQL against real rows. Mocked unit
 * tests can't show that the joins, sums and filters give the right numbers.
 *
 * One app, seeded once; the `it` blocks read that data and change nothing.
 * Names start with a different capital word so the expected order doesn't
 * depend on the database's collation.
 *
 * The catalogue, with the status it has across every branch:
 *
 *   Alpha    no stock row                     OUT_OF_STOCK
 *   Bravo    Main 0                           OUT_OF_STOCK
 *   Charlie  Main 10/2, City 1/2              IN_STOCK 11/4, City is low
 *   Delta    Main 3/5                         LOW_STOCK
 *   Echo     Main 5/5, at the threshold       LOW_STOCK
 *   Foxtrot  Main 6/5, just above it          IN_STOCK
 *   Golf     Main and City, both untracked    NOT_TRACKED
 *   Hotel    Main 4/1, City untracked         IN_STOCK 4/1
 *   India    IMEI: Main 2, City 1, five units IN_STOCK 3
 *   Juliet   SERIAL: Main 3, one unit         IN_STOCK 3
 *   Kilo     IMEI: no stock row, no units     OUT_OF_STOCK
 *   Lima     Closed Shop (inactive) 8         IN_STOCK 8
 *   Mike     inactive product, Main 5         hidden by default
 *   November soft-deleted, Main 100           never shown
 *   Oscar, Papa, Quebec    wildcards in the name, each with a near miss
 *   Romeo    no selling price, own SKU and barcode
 *   Sierra   three products of the same name
 *
 * (quantity/min_quantity; the ones without a stock row are OUT_OF_STOCK.)
 */
describe('Stock overview (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  let main: Branch;
  let city: Branch;
  let closed: Branch;
  let brand: Brand;
  let category: Category;

  const cookies = {} as Record<
    'admin' | 'managerMain' | 'managerCity' | 'cashierMain',
    string[]
  >;

  // Values the response must never carry. The cost check looks for these
  // as well as the keys, so it can't pass because they were empty.
  const BUYING = '81234.00';
  const UNIT_BUYING = '71234.00';
  const UNIT_SELLING = '61234.00';
  const SELLING = '101234.00';

  const PRODUCTS_IN_ORDER = [
    'Alpha',
    'Bravo',
    'Charlie',
    'Delta',
    'Echo',
    'Foxtrot',
    'Golf',
    'Hotel',
    'India',
    'Juliet',
    'Kilo',
    'Lima',
    'Oscar',
    'Oscar',
    'Papa',
    'Papa',
    'Quebec',
    'Quebec',
    'Romeo',
    'Sierra',
    'Sierra',
    'Sierra',
  ];
  const ALL_BRANCHES = {
    total_products: 22,
    in_stock: 6,
    low_stock: 2,
    out_of_stock: 13,
    not_tracked: 1,
    total_quantity: 43,
  };
  const MAIN_SHOP = {
    total_products: 22,
    in_stock: 5,
    low_stock: 2,
    out_of_stock: 14,
    not_tracked: 1,
    total_quantity: 33,
  };

  const ROW_KEYS = [
    'branches',
    'brand',
    'category',
    'id',
    'is_active',
    'min_quantity',
    'name',
    'quantity',
    'selling_price',
    'sku',
    'stock_status',
    'tracking_method',
    'units',
  ];
  const BRANCH_KEYS = [
    'id',
    'is_active',
    'manage_stock',
    'min_quantity',
    'name',
    'quantity',
    'stock_status',
  ];

  const http = () => request(app.getHttpServer());
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function get(
    params: Record<string, string | number | boolean> = {},
    as: keyof typeof cookies = 'admin',
  ): Promise<Response> {
    await pause(150); // stay under the 10 req/s throttler
    return http()
      .get('/api/v1/stock/overview')
      .query(params)
      .set('Cookie', cookies[as]);
  }

  async function overview(
    params: Record<string, string | number | boolean> = {},
    as: keyof typeof cookies = 'admin',
  ): Promise<StockOverviewResponse> {
    const res = await get(params, as);
    expect(res.status).toBe(200);
    return res.body as StockOverviewResponse;
  }

  /** The one row whose name starts with this word. */
  const row = (body: StockOverviewResponse, word: string): StockOverviewRow => {
    const rows = body.data.filter((item) => item.name.startsWith(word));
    expect(rows).toHaveLength(1);
    return rows[0];
  };
  const wordsOf = (body: StockOverviewResponse): string[] =>
    body.data.map((item) => item.name.split(' ')[0]);

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

  let productCount = 0;

  async function seedProduct(
    name: string,
    overrides: Partial<Product> = {},
  ): Promise<Product> {
    const repo = dataSource.getRepository(Product);
    productCount += 1;
    const sku = `SKU-${String(productCount).padStart(3, '0')}`;
    const tracking = overrides.tracking_method ?? TrackingMethod.QUANTITY;
    return repo.save(
      repo.create({
        name,
        sku,
        barcode: `BC-${sku}`,
        brand_id: brand.id,
        category_id: category.id,
        buying_price: BUYING,
        selling_price: SELLING,
        is_active: true,
        tracking_method: tracking,
        is_serialized: tracking !== TrackingMethod.QUANTITY,
        ...overrides,
      }),
    );
  }

  async function seedStock(
    product: Product,
    branch: Branch,
    quantity: number,
    minQuantity = 0,
    manageStock = true,
  ): Promise<void> {
    const repo = dataSource.getRepository(Stock);
    await repo.save(
      repo.create({
        product_id: product.id,
        branch_id: branch.id,
        quantity,
        min_quantity: minQuantity,
        manage_stock: manageStock,
      }),
    );
  }

  async function seedUnit(
    product: Product,
    branch: Branch,
    identifier: string,
    status = ProductUnitStatus.IN_STOCK,
  ): Promise<void> {
    const repo = dataSource.getRepository(ProductUnit);
    await repo.save(
      repo.create({
        product_id: product.id,
        branch_id: branch.id,
        status,
        imei: identifier,
        imei_number: null,
        serial_number: null,
        buying_price: UNIT_BUYING,
        selling_price: UNIT_SELLING,
        phone_purchase_id: null,
      }),
    );
  }

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);

    // truncateAllTables has no guard of its own, and without .env.test the
    // app falls back to .env. Refuse before anything is written.
    const [{ current_database: database }]: { current_database: string }[] =
      await dataSource.query('SELECT current_database()');
    if (database !== 'socio_lk_pos_test') {
      throw new Error(`Refusing to truncate database "${database}".`);
    }
    await truncateAllTables(app);

    const branches = dataSource.getRepository(Branch);
    main = await branches.save({
      name: 'Main Shop',
      is_active: true,
    } as Branch);
    city = await branches.save({
      name: 'City Shop',
      is_active: true,
    } as Branch);
    closed = await branches.save({
      name: 'Closed Shop',
      is_active: false,
    } as Branch);

    cookies.admin = await sessionFor(
      await seedUser(UserRole.ADMIN, 'admin@overview.test', null),
    );
    cookies.managerMain = await sessionFor(
      await seedUser(UserRole.MANAGER, 'manager-main@overview.test', main),
    );
    cookies.managerCity = await sessionFor(
      await seedUser(UserRole.MANAGER, 'manager-city@overview.test', city),
    );
    cookies.cashierMain = await sessionFor(
      await seedUser(UserRole.CASHIER, 'cashier-main@overview.test', main),
    );

    brand = await dataSource
      .getRepository(Brand)
      .save({ name: 'Brand', is_active: true } as Brand);
    category = await dataSource
      .getRepository(Category)
      .save({ name: 'Category', is_active: true } as Category);

    await seedProduct('Alpha Cable');

    await seedStock(await seedProduct('Bravo Case'), main, 0);

    const charlie = await seedProduct('Charlie Charger');
    await seedStock(charlie, main, 10, 2);
    await seedStock(charlie, city, 1, 2);

    await seedStock(await seedProduct('Delta Earbuds'), main, 3, 5);
    await seedStock(await seedProduct('Echo Hub'), main, 5, 5);
    await seedStock(await seedProduct('Foxtrot Mouse'), main, 6, 5);

    // The stored quantities are stale: an untracked row doesn't move.
    const golf = await seedProduct('Golf Reload');
    await seedStock(golf, main, 99, 3, false);
    await seedStock(golf, city, 7, 3, false);

    const hotel = await seedProduct('Hotel SIM');
    await seedStock(hotel, main, 4, 1);
    await seedStock(hotel, city, 50, 9, false);

    // Two stock rows and five units: joined directly, they would multiply.
    const india = await seedProduct('India Phone', {
      tracking_method: TrackingMethod.IMEI,
    });
    await seedStock(india, main, 2);
    await seedStock(india, city, 1);
    await seedUnit(india, main, '356789000000001');
    await seedUnit(india, main, '356789000000002');
    await seedUnit(
      india,
      main,
      '356789000000003',
      ProductUnitStatus.INSPECTION,
    );
    await seedUnit(india, main, '356789000000004', ProductUnitStatus.SOLD);
    await seedUnit(india, city, '356789000000005');

    const juliet = await seedProduct('Juliet Tablet', {
      tracking_method: TrackingMethod.SERIAL_NUMBER,
    });
    await seedStock(juliet, main, 3);
    await seedUnit(juliet, main, 'SERIAL-JULIET-1');

    await seedProduct('Kilo Watch', { tracking_method: TrackingMethod.IMEI });

    await seedStock(await seedProduct('Lima Speaker'), closed, 8);

    await seedStock(
      await seedProduct('Mike Stand', { is_active: false }),
      main,
      5,
    );

    const november = await seedProduct('November Case');
    await seedStock(november, main, 100);
    await dataSource.getRepository(Product).softDelete(november.id);

    await seedProduct('Oscar 50% Off');
    await seedProduct('Oscar 500 Off');
    await seedProduct('Papa Under_Score');
    await seedProduct('Papa UnderXScore');
    await seedProduct('Quebec Back\\Slash');
    await seedProduct('Quebec BackXSlash');

    await seedProduct('Romeo Lens', {
      sku: 'SKU-ROMEO',
      barcode: 'BAR-7788',
      selling_price: null,
    });

    await seedProduct('Sierra Twin');
    await seedProduct('Sierra Twin');
    await seedProduct('Sierra Twin');
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('one row per product', () => {
    it('lists every eligible product once, by name', async () => {
      const body = await overview();

      expect(wordsOf(body)).toEqual(PRODUCTS_IN_ORDER);
      expect(new Set(body.data.map((item) => item.id)).size).toBe(22);
    });

    it('shows a product with no stock row as quantity 0, out of stock', async () => {
      const alpha = row(await overview(), 'Alpha');

      expect(alpha).toMatchObject({
        stock_status: 'OUT_OF_STOCK',
        quantity: 0,
        min_quantity: 0,
        branches: [],
      });
    });

    it('shows a product at zero stock as out of stock, with its row', async () => {
      const bravo = row(await overview(), 'Bravo');

      expect(bravo).toMatchObject({
        stock_status: 'OUT_OF_STOCK',
        quantity: 0,
      });
      expect(bravo.branches).toHaveLength(1);
      expect(bravo.branches[0]).toMatchObject({
        name: 'Main Shop',
        quantity: 0,
        stock_status: 'OUT_OF_STOCK',
      });
    });

    it('carries the product’s own fields', async () => {
      const body = await overview();

      expect(row(body, 'Alpha')).toMatchObject({
        sku: 'SKU-001',
        tracking_method: 'QUANTITY',
        is_active: true,
        selling_price: SELLING,
        brand: { id: brand.id, name: 'Brand' },
        category: { id: category.id, name: 'Category' },
      });
      expect(row(body, 'Romeo').selling_price).toBeNull();
    });
  });

  describe('stock status', () => {
    it('is low at the threshold and in stock just above it', async () => {
      const body = await overview();

      expect(row(body, 'Delta')).toMatchObject({
        stock_status: 'LOW_STOCK',
        quantity: 3,
        min_quantity: 5,
      });
      expect(row(body, 'Echo').stock_status).toBe('LOW_STOCK');
      expect(row(body, 'Foxtrot').stock_status).toBe('IN_STOCK');
    });

    it('sums tracked branches, and keeps one branch’s shortage in the breakdown', async () => {
      const charlie = row(await overview(), 'Charlie');

      expect(charlie).toMatchObject({
        stock_status: 'IN_STOCK',
        quantity: 11,
        min_quantity: 4,
      });
      expect(charlie.branches).toEqual([
        {
          id: city.id,
          name: 'City Shop',
          is_active: true,
          quantity: 1,
          min_quantity: 2,
          manage_stock: true,
          stock_status: 'LOW_STOCK',
        },
        {
          id: main.id,
          name: 'Main Shop',
          is_active: true,
          quantity: 10,
          min_quantity: 2,
          manage_stock: true,
          stock_status: 'IN_STOCK',
        },
      ]);
    });

    it('reads NOT_TRACKED only when every row is untracked, with no quantity', async () => {
      const golf = row(await overview(), 'Golf');

      expect(golf).toMatchObject({
        stock_status: 'NOT_TRACKED',
        quantity: null,
      });
      expect(golf.branches.map((branch) => branch.quantity)).toEqual([
        null,
        null,
      ]);
      expect(golf.branches.map((branch) => branch.stock_status)).toEqual([
        'NOT_TRACKED',
        'NOT_TRACKED',
      ]);
    });

    it('takes a mixed product from its tracked rows only', async () => {
      const hotel = row(await overview(), 'Hotel');

      expect(hotel).toMatchObject({
        stock_status: 'IN_STOCK',
        quantity: 4,
        min_quantity: 1,
      });
      expect(hotel.branches).toEqual([
        expect.objectContaining({
          name: 'City Shop',
          quantity: null,
          manage_stock: false,
          stock_status: 'NOT_TRACKED',
        }),
        expect.objectContaining({
          name: 'Main Shop',
          quantity: 4,
          manage_stock: true,
          stock_status: 'IN_STOCK',
        }),
      ]);
    });
  });

  describe('units', () => {
    it('counts an IMEI product’s units without multiplying them by its stock rows', async () => {
      const india = row(await overview(), 'India');

      expect(india.quantity).toBe(3);
      expect(india.units).toEqual({ in_stock: 3, inspection: 1 });
      expect(india.branches).toHaveLength(2);
    });

    it('lets a serial product hold more stock than it has units', async () => {
      const juliet = row(await overview(), 'Juliet');

      expect(juliet.tracking_method).toBe('SERIAL_NUMBER');
      expect(juliet.quantity).toBe(3);
      expect(juliet.units).toEqual({ in_stock: 1, inspection: 0 });
    });

    it('gives a tracked product without units zero counts', async () => {
      expect(row(await overview(), 'Kilo').units).toEqual({
        in_stock: 0,
        inspection: 0,
      });
    });

    it('gives a QUANTITY product null units', async () => {
      const body = await overview();

      expect(row(body, 'Alpha').units).toBeNull();
      expect(row(body, 'Charlie').units).toBeNull();
    });

    it('counts only the selected branch’s units', async () => {
      const india = row(await overview({ branchId: city.id }), 'India');

      expect(india.quantity).toBe(1);
      expect(india.units).toEqual({ in_stock: 1, inspection: 0 });
    });
  });

  describe('inactive and deleted', () => {
    it('hides inactive products by default', async () => {
      expect(wordsOf(await overview())).not.toContain('Mike');
    });

    it('adds them, and their stock, with includeInactive', async () => {
      const body = await overview({ includeInactive: true });

      expect(row(body, 'Mike')).toMatchObject({
        is_active: false,
        quantity: 5,
        stock_status: 'IN_STOCK',
      });
      expect(body.summary).toEqual({
        ...ALL_BRANCHES,
        total_products: 23,
        in_stock: 7,
        total_quantity: 48,
      });
      expect(body.meta.total).toBe(23);
    });

    it('never shows a soft-deleted product, or counts its stock', async () => {
      for (const includeInactive of [false, true]) {
        const body = await overview({ includeInactive });

        expect(wordsOf(body)).not.toContain('November');
        expect(body.summary.total_quantity).toBeLessThan(100);
      }
    });

    it('includes an inactive branch’s stock in All Branches, and says so', async () => {
      const lima = row(await overview(), 'Lima');

      expect(lima).toMatchObject({ stock_status: 'IN_STOCK', quantity: 8 });
      expect(lima.branches).toEqual([
        expect.objectContaining({
          id: closed.id,
          name: 'Closed Shop',
          is_active: false,
          quantity: 8,
        }),
      ]);
    });

    it('lets an admin select an inactive branch', async () => {
      const body = await overview({ branchId: closed.id });

      expect(row(body, 'Lima').quantity).toBe(8);
      expect(body.summary).toEqual({
        total_products: 22,
        in_stock: 1,
        low_stock: 0,
        out_of_stock: 21,
        not_tracked: 0,
        total_quantity: 8,
      });
    });
  });

  describe('branch scope', () => {
    it('gives an admin every branch by default', async () => {
      expect((await overview()).summary).toEqual(ALL_BRANCHES);
    });

    it('narrows an admin to the selected branch, in every figure', async () => {
      const body = await overview({ branchId: main.id });

      expect(body.summary).toEqual(MAIN_SHOP);
      expect(row(body, 'Charlie')).toMatchObject({
        stock_status: 'IN_STOCK',
        quantity: 10,
        min_quantity: 2,
      });
      expect(row(body, 'Charlie').branches).toEqual([
        expect.objectContaining({ id: main.id }),
      ]);
    });

    it('shows a branch’s shortage as the product’s status there', async () => {
      const body = await overview({ branchId: city.id });

      expect(row(body, 'Charlie')).toMatchObject({
        stock_status: 'LOW_STOCK',
        quantity: 1,
      });
      expect(body.summary).toEqual({
        total_products: 22,
        in_stock: 1,
        low_stock: 1,
        out_of_stock: 18,
        not_tracked: 2,
        total_quantity: 2,
      });
    });

    it('reads a product with no row at the selected branch as out of stock', async () => {
      const lima = row(await overview({ branchId: main.id }), 'Lima');

      expect(lima).toMatchObject({
        stock_status: 'OUT_OF_STOCK',
        quantity: 0,
        branches: [],
      });
    });

    it('reads a row untracked at the selected branch as NOT_TRACKED', async () => {
      const hotel = row(await overview({ branchId: city.id }), 'Hotel');

      expect(hotel).toMatchObject({
        stock_status: 'NOT_TRACKED',
        quantity: null,
      });
    });

    it('gives a manager exactly what an admin sees of their branch', async () => {
      const asAdmin = await overview({ branchId: main.id });

      await expect(overview({}, 'managerMain')).resolves.toEqual(asAdmin);
      await expect(
        overview({ branchId: main.id }, 'managerMain'),
      ).resolves.toEqual(asAdmin);
    });

    it('shows a manager no other branch in the breakdown', async () => {
      const body = await overview({}, 'managerCity');
      const branchIds = body.data.flatMap((item) =>
        item.branches.map((branch) => branch.id),
      );

      expect(new Set(branchIds)).toEqual(new Set([city.id]));
      expect(body.summary.total_quantity).toBe(2);
    });

    it('refuses a manager another branch with 403 WRONG_BRANCH', async () => {
      const res = await get({ branchId: city.id }, 'managerMain');

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 'WRONG_BRANCH' });
    });

    it('refuses a cashier', async () => {
      expect((await get({}, 'cashierMain')).status).toBe(403);
    });

    it('refuses a request without a session', async () => {
      await pause(150);
      const res = await http().get('/api/v1/stock/overview');

      expect(res.status).toBe(401);
    });

    it('answers 400 for a branchId that is not a UUID', async () => {
      expect((await get({ branchId: 'main' })).status).toBe(400);
    });

    it('answers 404 for a branch that does not exist', async () => {
      const res = await get({
        branchId: '11111111-1111-4111-8111-111111111111',
      });

      expect(res.status).toBe(404);
    });
  });

  describe('search', () => {
    it('finds part of a name, in any case', async () => {
      expect(wordsOf(await overview({ search: 'ROMEO l' }))).toEqual(['Romeo']);
    });

    it('finds part of a SKU, in any case', async () => {
      expect(wordsOf(await overview({ search: 'sku-rom' }))).toEqual(['Romeo']);
    });

    it('finds part of a barcode', async () => {
      expect(wordsOf(await overview({ search: '7788' }))).toEqual(['Romeo']);
    });

    it.each([
      ['%', '50%', 'Oscar 50% Off'],
      ['_', 'r_S', 'Papa Under_Score'],
      ['\\', 'k\\S', 'Quebec Back\\Slash'],
    ])('matches %s as itself, not its near miss', async (_, search, name) => {
      const body = await overview({ search });

      expect(body.data.map((item) => item.name)).toEqual([name]);
    });

    it('answers an empty page when nothing matches', async () => {
      const body = await overview({ search: 'no such product' });

      expect(body.data).toEqual([]);
      expect(body.meta.total).toBe(0);
      expect(body.summary).toEqual({
        total_products: 0,
        in_stock: 0,
        low_stock: 0,
        out_of_stock: 0,
        not_tracked: 0,
        total_quantity: 0,
      });
    });

    it('narrows the summary', async () => {
      const { summary } = await overview({ search: 'Charlie' });

      expect(summary).toMatchObject({
        total_products: 1,
        in_stock: 1,
        total_quantity: 11,
      });
    });
  });

  describe('pagination', () => {
    it('walks every product once, in order, with the same summary on each page', async () => {
      const everything = await overview({ limit: 200 });
      const ids: string[] = [];

      for (let page = 1; page <= 5; page++) {
        const body = await overview({ page, limit: 5 });
        ids.push(...body.data.map((item) => item.id));
        expect(body.summary).toEqual(ALL_BRANCHES);
        expect(body.meta).toEqual({
          total: 22,
          page,
          limit: 5,
          totalPages: 5,
          hasNext: page < 5,
          hasPrev: page > 1,
        });
      }

      expect(ids).toEqual(everything.data.map((item) => item.id));
    });

    it('breaks a tie on the name by id', async () => {
      const body = await overview({ search: 'Sierra' });
      const ids = body.data.map((item) => item.id);

      expect(ids).toHaveLength(3);
      expect(ids).toEqual([...ids].sort());
    });

    it('answers a page past the end with no rows and the full figures', async () => {
      const body = await overview({ page: 99, limit: 5 });

      expect(body.data).toEqual([]);
      expect(body.meta.total).toBe(22);
      expect(body.summary).toEqual(ALL_BRANCHES);
    });

    it('answers a page beyond the int range with no rows, not a 500', async () => {
      const body = await overview({ page: 100_000_000, limit: 50 });

      expect(body.data).toEqual([]);
      expect(body.summary).toEqual(ALL_BRANCHES);
      expect(body.meta).toEqual({
        total: 22,
        page: 100_000_000,
        limit: 50,
        totalPages: 1,
        hasNext: false,
        hasPrev: true,
      });
    });
  });

  describe('stockStatus', () => {
    it.each([
      ['IN_STOCK', 6],
      ['LOW_STOCK', 2],
      ['OUT_OF_STOCK', 13],
      ['NOT_TRACKED', 1],
    ])(
      'narrows the rows and meta to %s, and leaves the summary alone',
      async (stockStatus, total) => {
        const body = await overview({ stockStatus });

        expect(body.data).toHaveLength(total);
        expect(new Set(body.data.map((item) => item.stock_status))).toEqual(
          new Set([stockStatus]),
        );
        expect(body.meta.total).toBe(total);
        expect(body.summary).toEqual(ALL_BRANCHES);
      },
    );

    it('filters before paginating', async () => {
      const first = await overview({
        stockStatus: 'LOW_STOCK',
        page: 1,
        limit: 1,
      });
      const second = await overview({
        stockStatus: 'LOW_STOCK',
        page: 2,
        limit: 1,
      });

      expect(wordsOf(first)).toEqual(['Delta']);
      expect(wordsOf(second)).toEqual(['Echo']);
      expect(first.meta).toMatchObject({
        total: 2,
        totalPages: 2,
        hasNext: true,
      });
      expect(second.meta).toMatchObject({ hasNext: false, hasPrev: true });
    });

    it('applies to the selected branch', async () => {
      const body = await overview({
        branchId: city.id,
        stockStatus: 'NOT_TRACKED',
      });

      expect(wordsOf(body)).toEqual(['Golf', 'Hotel']);
    });

    it('combines with the search, which alone moves the summary', async () => {
      const body = await overview({
        search: 'Charlie',
        stockStatus: 'OUT_OF_STOCK',
      });

      expect(body.data).toEqual([]);
      expect(body.meta.total).toBe(0);
      expect(body.summary.total_products).toBe(1);
    });
  });

  describe('invalid parameters', () => {
    it.each([
      ['an unknown stockStatus', { stockStatus: 'SOLD' }],
      ['a one-character search', { search: 'a' }],
      ['a limit over 200', { limit: 201 }],
      ['a non-boolean includeInactive', { includeInactive: 'yes' }],
      ['an unknown parameter', { brandId: 'x' }],
    ])('refuses %s with 400', async (_, params) => {
      expect((await get(params)).status).toBe(400);
    });
  });

  describe('cost data', () => {
    it.each([
      ['an admin', 'admin'],
      ['a manager', 'managerMain'],
    ] as const)(
      'gives %s the selling price only, and only the listed fields',
      async (_, as) => {
        const body = await overview({ includeInactive: true, limit: 200 }, as);
        const text = JSON.stringify(body);

        expect(text).toContain(SELLING);
        for (const hidden of [
          BUYING,
          UNIT_BUYING,
          UNIT_SELLING,
          'buying',
          'cost',
          'snapshot',
          'payment',
          'trade_in',
        ]) {
          expect(text).not.toContain(hidden);
        }

        expect(Object.keys(body).sort()).toEqual(['data', 'meta', 'summary']);
        for (const item of body.data) {
          expect(Object.keys(item).sort()).toEqual(ROW_KEYS);
          for (const branch of item.branches) {
            expect(Object.keys(branch).sort()).toEqual(BRANCH_KEYS);
          }
        }
      },
    );
  });
});
