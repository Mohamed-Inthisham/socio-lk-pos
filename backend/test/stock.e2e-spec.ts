import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { createTestApp, truncateAllTables } from './setup';
import { User } from '../src/users/entities/user.entity';
import { UserRole } from '../src/users/enums/user-role.enum';
import { Brand } from '../src/brands/entities/brand.entity';
import { Category } from '../src/categories/entities/category.entity';
import { Branch } from '../src/branches/entities/branch.entity';
import { Stock } from '../src/stock/entities/stock.entity';
import { SkuBarcodeCounter } from '../src/sku-barcode-counters/entities/sku-barcode-counter.entity';
import { ProductType } from '../src/products/enums/product-type.enum';

describe('Stock (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await truncateAllTables(app);
    // Re-seed counter rows (same reason as products.e2e-spec.ts)
    await dataSource.getRepository(SkuBarcodeCounter).save([
      {
        counter_type: 'SKU',
        prefix: 'SKU-',
        current_value: 0,
      } as SkuBarcodeCounter,
      {
        counter_type: 'BARCODE',
        prefix: 'SLP-',
        current_value: 0,
      } as SkuBarcodeCounter,
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  async function seedUser(role: UserRole, email: string) {
    const password = 'testpass123';
    const password_hash = await bcrypt.hash(password, 4);
    const userRepo = dataSource.getRepository(User);
    const user = await userRepo.save(
      userRepo.create({
        email,
        password_hash,
        full_name: `Test ${role}`,
        role,
        is_active: true,
      }),
    );
    return { user, password };
  }

  async function seedReferences() {
    const brand = await dataSource
      .getRepository(Brand)
      .save({ name: 'Apple', is_active: true } as Brand);
    const category = await dataSource
      .getRepository(Category)
      .save({ name: 'Phones', is_active: true } as Category);
    const branch = await dataSource
      .getRepository(Branch)
      .save({ name: 'Main Shop', is_active: true } as Branch);
    return { brand, category, branch };
  }

  async function loginAndGetCookies(
    email: string,
    password: string,
  ): Promise<string[]> {
    await new Promise((r) => setTimeout(r, 110));
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return response.headers['set-cookie'] as unknown as string[];
  }

  /** Convenience — create a product via the API. Returns { productId, refs }. */
  async function createProductViaApi(
    cookies: string[],
    refs: { brand: Brand; category: Category; branch: Branch },
    overrides: Record<string, unknown> = {},
  ) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/products')
      .set('Cookie', cookies)
      .send({
        product_type: ProductType.PHONE,
        name: 'iPhone',
        brand_id: refs.brand.id,
        category_id: refs.category.id,
        branch_id: refs.branch.id,
        buying_price: '100.00',
        selling_price: '200.00',
        ...overrides,
      })
      .expect(201);
    return response.body.id as string;
  }

  describe('Auto-create hook (integration with Products)', () => {
    it('creating a product auto-creates a stock row with quantity=0', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const refs = await seedReferences();
      const cookies = await loginAndGetCookies(user.email, password);

      const productId = await createProductViaApi(cookies, refs);

      // Verify a stock row exists in the DB
      const stockRow = await dataSource
        .getRepository(Stock)
        .findOne({ where: { product_id: productId } });

      expect(stockRow).not.toBeNull();
      expect(stockRow!.quantity).toBe(0);
      expect(stockRow!.branch_id).toBe(refs.branch.id);
      expect(stockRow!.manage_stock).toBe(true);
    });

    it('creating multiple products creates multiple stock rows', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const refs = await seedReferences();
      const cookies = await loginAndGetCookies(user.email, password);

      await createProductViaApi(cookies, refs, { name: 'Product A' });
      await createProductViaApi(cookies, refs, { name: 'Product B' });
      await createProductViaApi(cookies, refs, { name: 'Product C' });

      const stockCount = await dataSource.getRepository(Stock).count();
      expect(stockCount).toBe(3);
    });
  });

  describe('GET /api/v1/stock', () => {
    it('returns stock rows with nested product+branch and low_stock_alert', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const refs = await seedReferences();
      const cookies = await loginAndGetCookies(user.email, password);
      const productId = await createProductViaApi(cookies, refs);

      const response = await request(app.getHttpServer())
        .get('/api/v1/stock')
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].product.id).toBe(productId);
      expect(response.body[0].branch.name).toBe('Main Shop');
      // quantity=0 <= min_quantity=0, so low_stock_alert should be true
      expect(response.body[0].low_stock_alert).toBe(true);
    });

    it('all roles can read stock', async () => {
      const { user: admin, password: aPass } = await seedUser(
        UserRole.ADMIN,
        'admin@t.com',
      );
      const refs = await seedReferences();
      const aCookies = await loginAndGetCookies(admin.email, aPass);
      await createProductViaApi(aCookies, refs);

      const { user: cashier, password: cPass } = await seedUser(
        UserRole.CASHIER,
        'c@t.com',
      );
      const cCookies = await loginAndGetCookies(cashier.email, cPass);

      await request(app.getHttpServer())
        .get('/api/v1/stock')
        .set('Cookie', cCookies)
        .expect(200);
    });

    it('lowStockOnly=true filters to alert rows', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const refs = await seedReferences();
      const cookies = await loginAndGetCookies(user.email, password);
      const productId = await createProductViaApi(cookies, refs);

      // Set the stock quantity high enough to not trigger the alert
      const stock = await dataSource
        .getRepository(Stock)
        .findOne({ where: { product_id: productId } });
      await request(app.getHttpServer())
        .patch(`/api/v1/stock/${stock!.id}`)
        .set('Cookie', cookies)
        .send({ quantity: 100, min_quantity: 3 })
        .expect(200);

      // Not in low-stock list
      const notLowResponse = await request(app.getHttpServer())
        .get('/api/v1/stock?lowStockOnly=true')
        .set('Cookie', cookies)
        .expect(200);
      expect(notLowResponse.body).toHaveLength(0);

      // Now drop stock below min
      await request(app.getHttpServer())
        .patch(`/api/v1/stock/${stock!.id}`)
        .set('Cookie', cookies)
        .send({ quantity: 2 })
        .expect(200);

      const lowResponse = await request(app.getHttpServer())
        .get('/api/v1/stock?lowStockOnly=true')
        .set('Cookie', cookies)
        .expect(200);
      expect(lowResponse.body).toHaveLength(1);
    });
  });

  describe('PATCH /api/v1/stock/:id', () => {
    it('admin can update stock quantity', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const refs = await seedReferences();
      const cookies = await loginAndGetCookies(user.email, password);
      const productId = await createProductViaApi(cookies, refs);

      const stock = await dataSource
        .getRepository(Stock)
        .findOne({ where: { product_id: productId } });

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/stock/${stock!.id}`)
        .set('Cookie', cookies)
        .send({ quantity: 25 })
        .expect(200);

      expect(response.body.quantity).toBe(25);
    });

    it('rejects negative quantity via DTO validation', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const refs = await seedReferences();
      const cookies = await loginAndGetCookies(user.email, password);
      const productId = await createProductViaApi(cookies, refs);

      const stock = await dataSource
        .getRepository(Stock)
        .findOne({ where: { product_id: productId } });

      await request(app.getHttpServer())
        .patch(`/api/v1/stock/${stock!.id}`)
        .set('Cookie', cookies)
        .send({ quantity: -5 })
        .expect(400);
    });

    it('cashier is forbidden from updating stock', async () => {
      const { user: admin, password: aPass } = await seedUser(
        UserRole.ADMIN,
        'admin@t.com',
      );
      const refs = await seedReferences();
      const aCookies = await loginAndGetCookies(admin.email, aPass);
      const productId = await createProductViaApi(aCookies, refs);
      const stock = await dataSource
        .getRepository(Stock)
        .findOne({ where: { product_id: productId } });

      const { user: cashier, password: cPass } = await seedUser(
        UserRole.CASHIER,
        'c@t.com',
      );
      const cCookies = await loginAndGetCookies(cashier.email, cPass);

      await request(app.getHttpServer())
        .patch(`/api/v1/stock/${stock!.id}`)
        .set('Cookie', cCookies)
        .send({ quantity: 999 })
        .expect(403);
    });
  });

  describe('GET /api/v1/stock/by-product/:productId', () => {
    it('returns all stock rows for the product', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const refs = await seedReferences();
      const cookies = await loginAndGetCookies(user.email, password);
      const productId = await createProductViaApi(cookies, refs);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/stock/by-product/${productId}`)
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].product_id).toBe(productId);
    });

    it('returns empty array when product has no stock rows', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      await seedReferences();
      const cookies = await loginAndGetCookies(user.email, password);
      const fakeId = '00000000-0000-0000-0000-000000000000';

      const response = await request(app.getHttpServer())
        .get(`/api/v1/stock/by-product/${fakeId}`)
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body).toEqual([]);
    });
  });
});
