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
import { WarrantyPeriod } from '../src/products/enums/warranty-period.enum';

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

  async function getOrCreateMainShop(): Promise<Branch> {
    const repo = dataSource.getRepository(Branch);
    const existing = await repo.findOne({ where: { name: 'Main Shop' } });
    if (existing) return existing;
    return repo.save(repo.create({ name: 'Main Shop', is_active: true }));
  }

  async function seedUser(role: UserRole, email: string, branchId?: string) {
    const password = 'testpass123';
    const password_hash = await bcrypt.hash(password, 4);

    let resolvedBranchId: string | null = null;
    if (role !== UserRole.ADMIN) {
      resolvedBranchId = branchId ?? (await getOrCreateMainShop()).id;
    }

    const userRepo = dataSource.getRepository(User);
    const user = await userRepo.save(
      userRepo.create({
        email,
        password_hash,
        full_name: `Test ${role}`,
        role,
        is_active: true,
        branch_id: resolvedBranchId,
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

    describe('default_warranty (P5-18)', () => {
      const body = (
        refs: Awaited<ReturnType<typeof seedReferences>>,
        extra = {},
      ) => ({
        product_type: ProductType.PHONE,
        name: 'iPhone 15',
        brand_id: refs.brand.id,
        category_id: refs.category.id,
        branch_id: refs.branch.id,
        buying_price: '100',
        selling_price: '200',
        ...extra,
      });

      it('stores the given default warranty, and no longer returns the old warranty fields', async () => {
        const { user, password } = await seedUser(
          UserRole.ADMIN,
          'admin@t.com',
        );
        const refs = await seedReferences();
        const cookies = await loginAndGetCookies(user.email, password);

        const response = await request(app.getHttpServer())
          .post('/api/v1/products')
          .set('Cookie', cookies)
          .send(body(refs, { default_warranty: WarrantyPeriod.MONTH_12 }))
          .expect(201);

        expect(response.body.default_warranty).toBe(WarrantyPeriod.MONTH_12);
        expect(response.body).not.toHaveProperty('warranty_months');
        expect(response.body).not.toHaveProperty('checking_warranty_days');
      });

      it('defaults to NO_WARRANTY when omitted (P5-19)', async () => {
        const { user, password } = await seedUser(
          UserRole.ADMIN,
          'admin@t.com',
        );
        const refs = await seedReferences();
        const cookies = await loginAndGetCookies(user.email, password);

        const response = await request(app.getHttpServer())
          .post('/api/v1/products')
          .set('Cookie', cookies)
          .send(body(refs))
          .expect(201);

        expect(response.body.default_warranty).toBe(WarrantyPeriod.NO_WARRANTY);
      });

      it('rejects an unknown code with 400', async () => {
        const { user, password } = await seedUser(
          UserRole.ADMIN,
          'admin@t.com',
        );
        const refs = await seedReferences();
        const cookies = await loginAndGetCookies(user.email, password);

        const response = await request(app.getHttpServer())
          .post('/api/v1/products')
          .set('Cookie', cookies)
          .send(body(refs, { default_warranty: 'MONTH_5' }))
          .expect(400);

        expect(JSON.stringify(response.body.message)).toMatch(
          /default_warranty must be one of/,
        );
      });

      it('changes it on PATCH, and rejects null (NO_WARRANTY is the "no warranty")', async () => {
        const { user, password } = await seedUser(
          UserRole.ADMIN,
          'admin@t.com',
        );
        const refs = await seedReferences();
        const cookies = await loginAndGetCookies(user.email, password);
        const created = await request(app.getHttpServer())
          .post('/api/v1/products')
          .set('Cookie', cookies)
          .send(body(refs))
          .expect(201);

        const patched = await request(app.getHttpServer())
          .patch(`/api/v1/products/${created.body.id}`)
          .set('Cookie', cookies)
          .send({ default_warranty: WarrantyPeriod.WEEK_2 })
          .expect(200);
        expect(patched.body.default_warranty).toBe(WarrantyPeriod.WEEK_2);

        await request(app.getHttpServer())
          .patch(`/api/v1/products/${created.body.id}`)
          .set('Cookie', cookies)
          .send({ default_warranty: null })
          .expect(400);
      });
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

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].brand.name).toBe('Apple');
      expect(response.body.data[0].category.name).toBe('Phones');
      expect(response.body.data[0].branch.name).toBe('Main Shop');
      expect(response.body.meta).toEqual({
        total: 1,
        page: 1,
        limit: 50,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      });
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

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].name).toBe('iPhone');
    });
  });

  describe('GET /api/v1/products — search and pagination', () => {
    let cookies: string[];
    let refs: Awaited<ReturnType<typeof seedReferences>>;

    beforeEach(async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      refs = await seedReferences();
      cookies = await loginAndGetCookies(user.email, password);
    });

    async function createProduct(name: string, branchId = refs.branch.id) {
      await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Cookie', cookies)
        .send({
          product_type: ProductType.PHONE,
          name,
          brand_id: refs.brand.id,
          category_id: refs.category.id,
          branch_id: branchId,
          buying_price: '100',
          selling_price: '200',
        })
        .expect(201);
    }

    function list(query: string) {
      return request(app.getHttpServer())
        .get(`/api/v1/products${query}`)
        .set('Cookie', cookies);
    }

    const names = (body: { data: { name: string }[] }) =>
      body.data.map((p) => p.name).sort();

    it('matches a partial name, case-insensitively', async () => {
      await createProduct('iPhone 15 Pro');
      await createProduct('IPHONE 13 Mini');
      await createProduct('Galaxy S24');

      const response = await list('?search=PhOnE').expect(200);

      expect(names(response.body)).toEqual(['IPHONE 13 Mini', 'iPhone 15 Pro']);
      expect(response.body.meta.total).toBe(2);
    });

    it('combines search with branchId using AND', async () => {
      const cityShop = await dataSource
        .getRepository(Branch)
        .save({ name: 'City Shop', is_active: true } as Branch);
      await createProduct('iPhone 15 Main');
      await createProduct('iPhone 15 City', cityShop.id);
      await createProduct('Galaxy S24 City', cityShop.id);

      const response = await list(
        `?search=iphone&branchId=${cityShop.id}`,
      ).expect(200);

      expect(names(response.body)).toEqual(['iPhone 15 City']);
    });

    it('rejects a search shorter than 2 characters after trimming', async () => {
      await createProduct('iPhone 15');

      const response = await list('?search=%20i%20').expect(400);

      expect(JSON.stringify(response.body.message)).toMatch(/search/);
    });

    it('treats empty or whitespace-only search as no filter', async () => {
      await createProduct('iPhone 15');
      await createProduct('Galaxy S24');

      const empty = await list('?search=').expect(200);
      const blank = await list('?search=%20%20%20').expect(200);

      expect(empty.body.meta.total).toBe(2);
      expect(blank.body.meta.total).toBe(2);
    });

    it('returns an empty page when nothing matches', async () => {
      await createProduct('iPhone 15');

      const response = await list('?search=nokia').expect(200);

      expect(response.body.data).toEqual([]);
      expect(response.body.meta).toMatchObject({ total: 0, totalPages: 0 });
    });

    it('treats LIKE wildcards in search literally', async () => {
      await createProduct('Charger 50% off');
      await createProduct('Charger 500W');

      const response = await list('?search=50%25').expect(200);

      expect(names(response.body)).toEqual(['Charger 50% off']);
    });

    it('paginates with page and limit', async () => {
      await createProduct('Phone A');
      await createProduct('Phone B');
      await createProduct('Phone C');

      const response = await list('?page=2&limit=2').expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.meta).toEqual({
        total: 3,
        page: 2,
        limit: 2,
        totalPages: 2,
        hasNext: false,
        hasPrev: true,
      });
    });

    it('rejects a limit above 200', async () => {
      await list('?limit=201').expect(400);
    });

    it('still validates includeInactive as a boolean', async () => {
      await list('?includeInactive=true').expect(200);
      await list('?includeInactive=yes').expect(400);
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
