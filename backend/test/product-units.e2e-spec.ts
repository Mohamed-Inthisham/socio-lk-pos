import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { createTestApp, truncateAllTables } from './setup';
import { User } from '../src/users/entities/user.entity';
import { UserRole } from '../src/users/enums/user-role.enum';
import { Branch } from '../src/branches/entities/branch.entity';
import { Customer } from '../src/customers/entities/customer.entity';
import { Product } from '../src/products/entities/product.entity';
import { ProductType } from '../src/products/enums/product-type.enum';
import { Brand } from '../src/brands/entities/brand.entity';
import { Category } from '../src/categories/entities/category.entity';
import { Stock } from '../src/stock/entities/stock.entity';
import { ProductUnitStatus } from '../src/product-units/enums/product-unit-status.enum';

describe('Product Units (e2e)', () => {
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

  // ---- helpers (mirrored from phone-purchases.e2e-spec.ts) ----

  async function getOrCreateMainShop(): Promise<Branch> {
    const repo = dataSource.getRepository(Branch);
    const existing = await repo.findOne({ where: { name: 'Main Shop' } });
    if (existing) return existing;
    return repo.save(repo.create({ name: 'Main Shop', is_active: true }));
  }

  async function seedUser(role: UserRole, email: string) {
    const password = 'testpass123';
    const password_hash = await bcrypt.hash(password, 4);

    let resolvedBranchId: string | null = null;
    if (role !== UserRole.ADMIN) {
      resolvedBranchId = (await getOrCreateMainShop()).id;
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

  async function seedCustomer(): Promise<Customer> {
    const repo = dataSource.getRepository(Customer);
    return repo.save(
      repo.create({
        name: 'Kamal Perera',
        phone: '0771234567',
      }),
    );
  }

  async function seedBrand(): Promise<Brand> {
    const repo = dataSource.getRepository(Brand);
    const existing = await repo.findOne({ where: { name: 'Apple' } });
    if (existing) return existing;
    return repo.save(repo.create({ name: 'Apple', is_active: true }));
  }

  async function seedCategory(): Promise<Category> {
    const repo = dataSource.getRepository(Category);
    const existing = await repo.findOne({ where: { name: 'Used Phones' } });
    if (existing) return existing;
    return repo.save(repo.create({ name: 'Used Phones', is_active: true }));
  }

  async function seedSerializedProduct(branchId: string): Promise<Product> {
    const brand = await seedBrand();
    const category = await seedCategory();
    const productRepo = dataSource.getRepository(Product);
    const product = await productRepo.save(
      productRepo.create({
        product_type: ProductType.PHONE,
        name: 'Used iPhone 12 Pro Max 256GB',
        sku: `SKU-${Date.now()}${Math.floor(Math.random() * 1000)}`,
        barcode: `${Date.now()}${Math.floor(Math.random() * 1000)}`,
        branch_id: branchId,
        brand_id: brand.id,
        category_id: category.id,
        buying_price: '80000.00',
        selling_price: '100000.00',
        is_active: true,
        is_serialized: true,
      }),
    );
    const stockRepo = dataSource.getRepository(Stock);
    await stockRepo.save(
      stockRepo.create({
        product_id: product.id,
        branch_id: branchId,
        quantity: 0,
      }),
    );
    return product;
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
    const cookies = response.headers['set-cookie'];
    return Array.isArray(cookies) ? cookies : [cookies];
  }

  const validImei = () => `${Date.now()}${Math.floor(Math.random() * 100)}`;

  // Creates a phone purchase via the API, which is the only way to
  // create a ProductUnit in this slice. Returns the created unit.
  async function createPurchaseAndReturnUnit(
    cookies: string[],
    branchId: string,
    productId: string,
    customerId: string,
    imei: string,
    buyingPrice = 80000,
  ) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/phone-purchases')
      .set('Cookie', cookies)
      .send({
        customer_id: customerId,
        branch_id: branchId,
        product_id: productId,
        imei,
        buying_price: buyingPrice,
      })
      .expect(201);
    return response.body.product_units[0];
  }

  // ---- GET /product-units ----

  describe('GET /product-units', () => {
    it('returns paginated list for admin', async () => {
      const { user: admin, password } = await seedUser(
        UserRole.ADMIN,
        'admin@test.com',
      );
      const cookies = await loginAndGetCookies(admin.email, password);
      const branch = await getOrCreateMainShop();
      const product = await seedSerializedProduct(branch.id);
      const customer = await seedCustomer();

      // Create 3 units via intake
      for (let i = 0; i < 3; i++) {
        await createPurchaseAndReturnUnit(
          cookies,
          branch.id,
          product.id,
          customer.id,
          validImei(),
        );
      }

      const response = await request(app.getHttpServer())
        .get('/api/v1/product-units')
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.data).toHaveLength(3);
      expect(response.body.meta).toMatchObject({
        total: 3,
        page: 1,
        limit: 50,
      });
    });

    it('returns 403 when cashier tries to list', async () => {
      const { user: cashier, password } = await seedUser(
        UserRole.CASHIER,
        'cashier@test.com',
      );
      const cookies = await loginAndGetCookies(cashier.email, password);

      await request(app.getHttpServer())
        .get('/api/v1/product-units')
        .set('Cookie', cookies)
        .expect(403);
    });

    it('returns 401 when unauthenticated', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/product-units')
        .expect(401);
    });

    it('filters by status', async () => {
      const { user: admin, password } = await seedUser(
        UserRole.ADMIN,
        'admin2@test.com',
      );
      const cookies = await loginAndGetCookies(admin.email, password);
      const branch = await getOrCreateMainShop();
      const product = await seedSerializedProduct(branch.id);
      const customer = await seedCustomer();

      // Create 2 IN_STOCK units
      await createPurchaseAndReturnUnit(
        cookies,
        branch.id,
        product.id,
        customer.id,
        validImei(),
      );
      await createPurchaseAndReturnUnit(
        cookies,
        branch.id,
        product.id,
        customer.id,
        validImei(),
      );

      // Query IN_STOCK — should get 2
      const inStockResponse = await request(app.getHttpServer())
        .get(`/api/v1/product-units?status=${ProductUnitStatus.IN_STOCK}`)
        .set('Cookie', cookies)
        .expect(200);
      expect(inStockResponse.body.data).toHaveLength(2);

      // Query SOLD — should get 0 (no sold units exist yet)
      const soldResponse = await request(app.getHttpServer())
        .get(`/api/v1/product-units?status=${ProductUnitStatus.SOLD}`)
        .set('Cookie', cookies)
        .expect(200);
      expect(soldResponse.body.data).toHaveLength(0);
    });

    it('filters by imei (exact match)', async () => {
      const { user: admin, password } = await seedUser(
        UserRole.ADMIN,
        'admin3@test.com',
      );
      const cookies = await loginAndGetCookies(admin.email, password);
      const branch = await getOrCreateMainShop();
      const product = await seedSerializedProduct(branch.id);
      const customer = await seedCustomer();
      const targetImei = validImei();

      await createPurchaseAndReturnUnit(
        cookies,
        branch.id,
        product.id,
        customer.id,
        targetImei,
      );
      // Second unit with different IMEI
      await createPurchaseAndReturnUnit(
        cookies,
        branch.id,
        product.id,
        customer.id,
        validImei(),
      );

      const response = await request(app.getHttpServer())
        .get(`/api/v1/product-units?imei=${targetImei}`)
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].imei).toBe(targetImei);
    });

    it('hydrates nested product, branch, and phone_purchase with customer', async () => {
      const { user: admin, password } = await seedUser(
        UserRole.ADMIN,
        'admin4@test.com',
      );
      const cookies = await loginAndGetCookies(admin.email, password);
      const branch = await getOrCreateMainShop();
      const product = await seedSerializedProduct(branch.id);
      const customer = await seedCustomer();

      await createPurchaseAndReturnUnit(
        cookies,
        branch.id,
        product.id,
        customer.id,
        validImei(),
      );

      const response = await request(app.getHttpServer())
        .get('/api/v1/product-units')
        .set('Cookie', cookies)
        .expect(200);

      const unit = response.body.data[0];
      expect(unit.product).toMatchObject({ id: product.id });
      expect(unit.branch).toMatchObject({ id: branch.id });
      expect(unit.phone_purchase).toMatchObject({
        customer: { id: customer.id },
      });
    });
  });

  // ---- GET /product-units/:id ----

  describe('GET /product-units/:id', () => {
    it('returns the unit with all relations for admin', async () => {
      const { user: admin, password } = await seedUser(
        UserRole.ADMIN,
        'admin5@test.com',
      );
      const cookies = await loginAndGetCookies(admin.email, password);
      const branch = await getOrCreateMainShop();
      const product = await seedSerializedProduct(branch.id);
      const customer = await seedCustomer();
      const createdUnit = await createPurchaseAndReturnUnit(
        cookies,
        branch.id,
        product.id,
        customer.id,
        validImei(),
      );

      const response = await request(app.getHttpServer())
        .get(`/api/v1/product-units/${createdUnit.id}`)
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body).toMatchObject({
        id: createdUnit.id,
        imei: createdUnit.imei,
        status: ProductUnitStatus.IN_STOCK,
      });
      expect(response.body.product).toMatchObject({ id: product.id });
      expect(response.body.branch).toMatchObject({ id: branch.id });
      expect(response.body.phone_purchase).toMatchObject({
        customer: { id: customer.id },
      });
    });

    it('returns 403 when cashier tries to fetch', async () => {
      const { user: cashier, password } = await seedUser(
        UserRole.CASHIER,
        'cashier2@test.com',
      );
      const cookies = await loginAndGetCookies(cashier.email, password);

      await request(app.getHttpServer())
        .get('/api/v1/product-units/00000000-0000-0000-0000-000000000000')
        .set('Cookie', cookies)
        .expect(403);
    });

    it('returns 404 when the unit does not exist', async () => {
      const { user: admin, password } = await seedUser(
        UserRole.ADMIN,
        'admin6@test.com',
      );
      const cookies = await loginAndGetCookies(admin.email, password);

      await request(app.getHttpServer())
        .get('/api/v1/product-units/00000000-0000-0000-0000-000000000000')
        .set('Cookie', cookies)
        .expect(404);
    });
  });
});
