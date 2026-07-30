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
import { Product } from '../src/products/entities/product.entity';
import { SkuBarcodeCounter } from '../src/sku-barcode-counters/entities/sku-barcode-counter.entity';
import { ProductType } from '../src/products/enums/product-type.enum';

describe('Products (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await truncateAllTables(app);
    // Re-seed the two counter rows after truncation (they're schema
    // invariants — Products cannot be created without them)
    await dataSource
      .getRepository(SkuBarcodeCounter)
      .save([
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

  /** Seed the three required references and return their IDs. */
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

  describe('POST /api/v1/products', () => {
    it('auto-generates SKU and barcode, admin can create', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const refs = await seedReferences();
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Cookie', cookies)
        .send({
          product_type: ProductType.PHONE,
          name: 'iPhone 15 Pro Max',
          brand_id: refs.brand.id,
          category_id: refs.category.id,
          branch_id: refs.branch.id,
          buying_price: '180000.00',
          selling_price: '199900.00',
        })
        .expect(201);

      expect(response.body.sku).toBe('SKU-000001');
      expect(response.body.barcode).toBe('SLP-000001');
      expect(response.body.brand.name).toBe('Apple');
      expect(response.body.category.name).toBe('Phones');
      expect(response.body.branch.name).toBe('Main Shop');
    });

    it('uses provided barcode instead of auto-generating', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const refs = await seedReferences();
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Cookie', cookies)
        .send({
          product_type: ProductType.PHONE,
          name: 'iPhone with manufacturer barcode',
          barcode: '194252056387',
          brand_id: refs.brand.id,
          category_id: refs.category.id,
          branch_id: refs.branch.id,
          buying_price: '180000.00',
          selling_price: '199900.00',
        })
        .expect(201);

      expect(response.body.barcode).toBe('194252056387');
      // SKU still auto-generated
      expect(response.body.sku).toBe('SKU-000001');
    });

    it('rejects with 409 when provided barcode is duplicate', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const refs = await seedReferences();
      const cookies = await loginAndGetCookies(user.email, password);

      // First product with barcode
      await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Cookie', cookies)
        .send({
          product_type: ProductType.PHONE,
          name: 'First',
          barcode: 'DUPLICATE',
          brand_id: refs.brand.id,
          category_id: refs.category.id,
          branch_id: refs.branch.id,
          buying_price: '100.00',
          selling_price: '200.00',
        })
        .expect(201);

      // Second product with same barcode → 409
      await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Cookie', cookies)
        .send({
          product_type: ProductType.PHONE,
          name: 'Second',
          barcode: 'DUPLICATE',
          brand_id: refs.brand.id,
          category_id: refs.category.id,
          branch_id: refs.branch.id,
          buying_price: '100.00',
          selling_price: '200.00',
        })
        .expect(409);
    });

    it('rejects with 400 when brand is inactive', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const refs = await seedReferences();
      // Deactivate the brand
      await dataSource
        .getRepository(Brand)
        .update(refs.brand.id, { is_active: false });
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Cookie', cookies)
        .send({
          product_type: ProductType.PHONE,
          name: 'Test',
          brand_id: refs.brand.id,
          category_id: refs.category.id,
          branch_id: refs.branch.id,
          buying_price: '100.00',
          selling_price: '200.00',
        })
        .expect(400);
    });

    it('rejects with 400 when brand_id does not exist', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const refs = await seedReferences();
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Cookie', cookies)
        .send({
          product_type: ProductType.PHONE,
          name: 'Test',
          brand_id: '00000000-0000-0000-0000-000000000000',
          category_id: refs.category.id,
          branch_id: refs.branch.id,
          buying_price: '100.00',
          selling_price: '200.00',
        })
        .expect(400);
    });

    it('cashier is forbidden from creating', async () => {
      const { user, password } = await seedUser(UserRole.CASHIER, 'c@t.com');
      const refs = await seedReferences();
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Cookie', cookies)
        .send({
          product_type: ProductType.PHONE,
          name: 'Test',
          brand_id: refs.brand.id,
          category_id: refs.category.id,
          branch_id: refs.branch.id,
          buying_price: '100.00',
          selling_price: '200.00',
        })
        .expect(403);
    });

    it('rejects invalid product_type via DB check constraint (should be blocked by DTO first)', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const refs = await seedReferences();
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Cookie', cookies)
        .send({
          product_type: 'INVALID_TYPE',
          name: 'Test',
          brand_id: refs.brand.id,
          category_id: refs.category.id,
          branch_id: refs.branch.id,
          buying_price: '100.00',
          selling_price: '200.00',
        })
        .expect(400);
    });
  });

  describe('GET /api/v1/products', () => {
    it('returns products with nested relations, all roles can read', async () => {
      const { user: admin, password: adminPass } = await seedUser(
        UserRole.ADMIN,
        'admin@t.com',
      );
      const refs = await seedReferences();
      const adminCookies = await loginAndGetCookies(admin.email, adminPass);

      // Create one product first
      await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Cookie', adminCookies)
        .send({
          product_type: ProductType.PHONE,
          name: 'iPhone',
          brand_id: refs.brand.id,
          category_id: refs.category.id,
          branch_id: refs.branch.id,
          buying_price: '100.00',
          selling_price: '200.00',
        })
        .expect(201);

      // Cashier can list
      const { user: cashier, password: cashPass } = await seedUser(
        UserRole.CASHIER,
        'c@t.com',
      );
      const cashCookies = await loginAndGetCookies(cashier.email, cashPass);

      const response = await request(app.getHttpServer())
        .get('/api/v1/products')
        .set('Cookie', cashCookies)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].brand.name).toBe('Apple');
      expect(response.body[0].category.name).toBe('Phones');
      expect(response.body[0].branch.name).toBe('Main Shop');
    });

    it('filters by brandId', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const refs = await seedReferences();
      const otherBrand = await dataSource
        .getRepository(Brand)
        .save({ name: 'Samsung', is_active: true } as Brand);
      const cookies = await loginAndGetCookies(user.email, password);

      // Two products, different brands
      await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Cookie', cookies)
        .send({
          product_type: ProductType.PHONE,
          name: 'iPhone',
          brand_id: refs.brand.id,
          category_id: refs.category.id,
          branch_id: refs.branch.id,
          buying_price: '100',
          selling_price: '200',
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Cookie', cookies)
        .send({
          product_type: ProductType.PHONE,
          name: 'Galaxy S24',
          brand_id: otherBrand.id,
          category_id: refs.category.id,
          branch_id: refs.branch.id,
          buying_price: '100',
          selling_price: '200',
        })
        .expect(201);

      // Filter to Apple only
      const response = await request(app.getHttpServer())
        .get(`/api/v1/products?brandId=${refs.brand.id}`)
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].name).toBe('iPhone');
    });
  });

  describe('GET /api/v1/products/by-barcode/:barcode', () => {
    it('finds a product by exact barcode', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const refs = await seedReferences();
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Cookie', cookies)
        .send({
          product_type: ProductType.PHONE,
          name: 'iPhone',
          barcode: 'SCAN-TEST-001',
          brand_id: refs.brand.id,
          category_id: refs.category.id,
          branch_id: refs.branch.id,
          buying_price: '100',
          selling_price: '200',
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get('/api/v1/products/by-barcode/SCAN-TEST-001')
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.name).toBe('iPhone');
      expect(response.body.brand.name).toBe('Apple');
    });

    it('returns 404 when barcode does not match', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      await seedReferences();
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .get('/api/v1/products/by-barcode/DOES-NOT-EXIST')
        .set('Cookie', cookies)
        .expect(404);
    });

    it('cashier can look up by barcode (needed for POS)', async () => {
      const { user: admin, password: adminPass } = await seedUser(
        UserRole.ADMIN,
        'admin@t.com',
      );
      const refs = await seedReferences();
      const adminCookies = await loginAndGetCookies(admin.email, adminPass);

      await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Cookie', adminCookies)
        .send({
          product_type: ProductType.PHONE,
          name: 'iPhone',
          barcode: 'BC-001',
          brand_id: refs.brand.id,
          category_id: refs.category.id,
          branch_id: refs.branch.id,
          buying_price: '100',
          selling_price: '200',
        })
        .expect(201);

      const { user: cashier, password: cashPass } = await seedUser(
        UserRole.CASHIER,
        'c@t.com',
      );
      const cashCookies = await loginAndGetCookies(cashier.email, cashPass);

      await request(app.getHttpServer())
        .get('/api/v1/products/by-barcode/BC-001')
        .set('Cookie', cashCookies)
        .expect(200);
    });
  });

  describe('PATCH /api/v1/products/:id', () => {
    it('renames a product', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const refs = await seedReferences();
      const cookies = await loginAndGetCookies(user.email, password);

      const created = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Cookie', cookies)
        .send({
          product_type: ProductType.PHONE,
          name: 'iPhone 15',
          brand_id: refs.brand.id,
          category_id: refs.category.id,
          branch_id: refs.branch.id,
          buying_price: '100',
          selling_price: '200',
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/products/${created.body.id}`)
        .set('Cookie', cookies)
        .send({ name: 'iPhone 15 Pro' })
        .expect(200);

      expect(response.body.name).toBe('iPhone 15 Pro');
    });

    it('admin can override auto-generated SKU', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const refs = await seedReferences();
      const cookies = await loginAndGetCookies(user.email, password);

      const created = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Cookie', cookies)
        .send({
          product_type: ProductType.PHONE,
          name: 'iPhone',
          brand_id: refs.brand.id,
          category_id: refs.category.id,
          branch_id: refs.branch.id,
          buying_price: '100',
          selling_price: '200',
        })
        .expect(201);

      expect(created.body.sku).toBe('SKU-000001');

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/products/${created.body.id}`)
        .set('Cookie', cookies)
        .send({ sku: 'CUSTOM-SKU-XYZ' })
        .expect(200);

      expect(response.body.sku).toBe('CUSTOM-SKU-XYZ');
    });
  });

  describe('DELETE /api/v1/products/:id', () => {
    it('deactivates a product', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const refs = await seedReferences();
      const cookies = await loginAndGetCookies(user.email, password);

      const created = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Cookie', cookies)
        .send({
          product_type: ProductType.PHONE,
          name: 'iPhone',
          brand_id: refs.brand.id,
          category_id: refs.category.id,
          branch_id: refs.branch.id,
          buying_price: '100',
          selling_price: '200',
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .delete(`/api/v1/products/${created.body.id}`)
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.is_active).toBe(false);
    });
  });

  describe('POST /api/v1/products/:id/reactivate', () => {
    it('reactivates a deactivated product', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const refs = await seedReferences();
      const cookies = await loginAndGetCookies(user.email, password);

      const created = await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Cookie', cookies)
        .send({
          product_type: ProductType.PHONE,
          name: 'iPhone',
          brand_id: refs.brand.id,
          category_id: refs.category.id,
          branch_id: refs.branch.id,
          buying_price: '100',
          selling_price: '200',
        })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/api/v1/products/${created.body.id}`)
        .set('Cookie', cookies)
        .expect(200);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/products/${created.body.id}/reactivate`)
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.is_active).toBe(true);
    });
  });
});
