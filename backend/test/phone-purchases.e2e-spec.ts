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
import { PhonePurchase } from '../src/phone-purchases/entities/phone-purchase.entity';
import { ProductUnit } from '../src/product-units/entities/product-unit.entity';
import { ProductUnitStatus } from '../src/product-units/enums/product-unit-status.enum';

describe('Phone Purchases (e2e)', () => {
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

  // ---- helpers ----

  async function getOrCreateMainShop(): Promise<Branch> {
    const repo = dataSource.getRepository(Branch);
    const existing = await repo.findOne({ where: { name: 'Main Shop' } });
    if (existing) return existing;
    return repo.save(repo.create({ name: 'Main Shop', is_active: true }));
  }

  async function getOrCreateSecondBranch(): Promise<Branch> {
    const repo = dataSource.getRepository(Branch);
    const existing = await repo.findOne({ where: { name: 'Second Branch' } });
    if (existing) return existing;
    return repo.save(repo.create({ name: 'Second Branch', is_active: true }));
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

  // A phone purchase needs the seller's NIC (P4-13), so seeded
  // customers have one by default; NICs are unique when set.
  let nicSeq = 0;
  async function seedCustomer(overrides: Partial<Customer> = {}) {
    const repo = dataSource.getRepository(Customer);
    return repo.save(
      repo.create({
        name: 'Kamal Perera',
        phone: '0771234567',
        nic: `19910000${String(++nicSeq).padStart(4, '0')}`,
        notes: null,
        ...overrides,
      }),
    );
  }

  async function seedBrand(name = 'Apple'): Promise<Brand> {
    const repo = dataSource.getRepository(Brand);
    const existing = await repo.findOne({ where: { name } });
    if (existing) return existing;
    return repo.save(repo.create({ name, is_active: true }));
  }

  async function seedCategory(name = 'Used Phones'): Promise<Category> {
    const repo = dataSource.getRepository(Category);
    const existing = await repo.findOne({ where: { name } });
    if (existing) return existing;
    return repo.save(repo.create({ name, is_active: true }));
  }

  // Seeds a Product with is_serialized = true and its matching Stock
  // row at quantity 0. Mirrors Phase 6.1's
  // ProductsService.create → StockService.createForNewProduct flow.
  async function seedSerializedProduct(
    branchId: string,
    overrides: Partial<Product> = {},
  ): Promise<Product> {
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
        ...overrides,
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
    // Small delay to avoid tripping the 10/sec throttler in AppModule.
    await new Promise((r) => setTimeout(r, 110));

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);

    const cookies = response.headers['set-cookie'];
    return Array.isArray(cookies) ? cookies : [cookies];
  }

  const validImei = () => `${Date.now()}${Math.floor(Math.random() * 100)}`;

  // ---- POST /phone-purchases — happy paths ----

  describe('POST /phone-purchases', () => {
    it('creates a phone purchase and its ProductUnit and increments Stock atomically', async () => {
      const { user: cashier, password } = await seedUser(
        UserRole.CASHIER,
        'cashier@test.com',
      );
      const cookies = await loginAndGetCookies(cashier.email, password);
      const branch = await getOrCreateMainShop();
      const product = await seedSerializedProduct(branch.id);
      const customer = await seedCustomer();
      const imei = validImei();

      const response = await request(app.getHttpServer())
        .post('/api/v1/phone-purchases')
        .set('Cookie', cookies)
        .send({
          customer_id: customer.id,
          branch_id: branch.id,
          product_id: product.id,
          imei,
          buying_price: 80000,
          selling_price: 100000,
          notes: 'Screen scratch top-right',
        })
        .expect(201);

      // Response shape
      expect(response.body).toMatchObject({
        customer_id: customer.id,
        branch_id: branch.id,
        cashier_id: cashier.id,
        total_amount: '80000.00',
        notes: 'Screen scratch top-right',
      });
      expect(response.body.customer).toMatchObject({ id: customer.id });
      expect(response.body.branch).toMatchObject({ id: branch.id });
      expect(response.body.cashier).toMatchObject({ id: cashier.id });
      expect(response.body.product_units).toHaveLength(1);
      expect(response.body.product_units[0]).toMatchObject({
        product_id: product.id,
        branch_id: branch.id,
        imei,
        status: ProductUnitStatus.IN_STOCK,
        buying_price: '80000.00',
        selling_price: '100000.00',
      });

      // Verify DB state directly — the important part
      const purchaseInDb = await dataSource
        .getRepository(PhonePurchase)
        .findOne({ where: { id: response.body.id } });
      expect(purchaseInDb).not.toBeNull();
      expect(purchaseInDb!.total_amount).toBe('80000.00');

      const unitInDb = await dataSource
        .getRepository(ProductUnit)
        .findOne({ where: { imei } });
      expect(unitInDb).not.toBeNull();
      expect(unitInDb!.phone_purchase_id).toBe(response.body.id);
      expect(unitInDb!.status).toBe(ProductUnitStatus.IN_STOCK);

      const stockInDb = await dataSource.getRepository(Stock).findOne({
        where: { product_id: product.id, branch_id: branch.id },
      });
      expect(stockInDb!.quantity).toBe(1); // was 0, incremented by 1
    });

    it('allows selling_price to be omitted (falls back to null)', async () => {
      const { user: cashier, password } = await seedUser(
        UserRole.CASHIER,
        'cashier2@test.com',
      );
      const cookies = await loginAndGetCookies(cashier.email, password);
      const branch = await getOrCreateMainShop();
      const product = await seedSerializedProduct(branch.id);
      const customer = await seedCustomer();

      const response = await request(app.getHttpServer())
        .post('/api/v1/phone-purchases')
        .set('Cookie', cookies)
        .send({
          customer_id: customer.id,
          branch_id: branch.id,
          product_id: product.id,
          imei: validImei(),
          buying_price: 80000,
        })
        .expect(201);

      expect(response.body.product_units[0].selling_price).toBeNull();
    });

    it('allows notes to be omitted', async () => {
      const { user: cashier, password } = await seedUser(
        UserRole.CASHIER,
        'cashier3@test.com',
      );
      const cookies = await loginAndGetCookies(cashier.email, password);
      const branch = await getOrCreateMainShop();
      const product = await seedSerializedProduct(branch.id);
      const customer = await seedCustomer();

      const response = await request(app.getHttpServer())
        .post('/api/v1/phone-purchases')
        .set('Cookie', cookies)
        .send({
          customer_id: customer.id,
          branch_id: branch.id,
          product_id: product.id,
          imei: validImei(),
          buying_price: 80000,
        })
        .expect(201);

      expect(response.body.notes).toBeNull();
    });

    it('trims whitespace from imei and notes', async () => {
      const { user: cashier, password } = await seedUser(
        UserRole.CASHIER,
        'cashier4@test.com',
      );
      const cookies = await loginAndGetCookies(cashier.email, password);
      const branch = await getOrCreateMainShop();
      const product = await seedSerializedProduct(branch.id);
      const customer = await seedCustomer();
      const imei = validImei();

      const response = await request(app.getHttpServer())
        .post('/api/v1/phone-purchases')
        .set('Cookie', cookies)
        .send({
          customer_id: customer.id,
          branch_id: branch.id,
          product_id: product.id,
          imei: `  ${imei}  `,
          buying_price: 80000,
          notes: '  Trimmed note  ',
        })
        .expect(201);

      expect(response.body.product_units[0].imei).toBe(imei);
      expect(response.body.notes).toBe('Trimmed note');
    });

    it('allows admin to intake at a branch different from their own (they have none)', async () => {
      const { user: admin, password } = await seedUser(
        UserRole.ADMIN,
        'admin@test.com',
      );
      const cookies = await loginAndGetCookies(admin.email, password);
      const branch = await getOrCreateSecondBranch();
      const product = await seedSerializedProduct(branch.id);
      const customer = await seedCustomer();

      const response = await request(app.getHttpServer())
        .post('/api/v1/phone-purchases')
        .set('Cookie', cookies)
        .send({
          customer_id: customer.id,
          branch_id: branch.id,
          product_id: product.id,
          imei: validImei(),
          buying_price: 80000,
        })
        .expect(201);

      expect(response.body.branch_id).toBe(branch.id);
    });
  });

  // ---- POST /phone-purchases — validation failures ----

  describe('POST /phone-purchases (validation)', () => {
    it('rejects with 400 when customer_id does not exist', async () => {
      const { user: cashier, password } = await seedUser(
        UserRole.CASHIER,
        'cashier-v1@test.com',
      );
      const cookies = await loginAndGetCookies(cashier.email, password);
      const branch = await getOrCreateMainShop();
      const product = await seedSerializedProduct(branch.id);

      await request(app.getHttpServer())
        .post('/api/v1/phone-purchases')
        .set('Cookie', cookies)
        .send({
          customer_id: '00000000-0000-0000-0000-000000000000',
          branch_id: branch.id,
          product_id: product.id,
          imei: validImei(),
          buying_price: 80000,
        })
        .expect(400);
    });

    it('rejects with 400 when customer is soft-deleted', async () => {
      const { user: cashier, password } = await seedUser(
        UserRole.CASHIER,
        'cashier-v2@test.com',
      );
      const cookies = await loginAndGetCookies(cashier.email, password);
      const branch = await getOrCreateMainShop();
      const product = await seedSerializedProduct(branch.id);
      const customer = await seedCustomer();

      // Soft-delete the customer
      await dataSource.getRepository(Customer).softDelete({ id: customer.id });

      await request(app.getHttpServer())
        .post('/api/v1/phone-purchases')
        .set('Cookie', cookies)
        .send({
          customer_id: customer.id,
          branch_id: branch.id,
          product_id: product.id,
          imei: validImei(),
          buying_price: 80000,
        })
        .expect(400);
    });

    it('rejects with 400 when branch_id does not exist', async () => {
      // Admin (branch_id = null) can pass any branch_id in the body,
      // letting our nonexistent-UUID reference check fire without
      // getting caught by the cross-branch cashier ForbiddenException.
      const { user: admin, password } = await seedUser(
        UserRole.ADMIN,
        'admin-v3@test.com',
      );
      const cookies = await loginAndGetCookies(admin.email, password);
      const branch = await getOrCreateMainShop();
      const product = await seedSerializedProduct(branch.id);
      const customer = await seedCustomer();

      await request(app.getHttpServer())
        .post('/api/v1/phone-purchases')
        .set('Cookie', cookies)
        .send({
          customer_id: customer.id,
          branch_id: '00000000-0000-0000-0000-000000000000',
          product_id: product.id,
          imei: validImei(),
          buying_price: 80000,
        })
        .expect(400);
    });

    it('rejects with 403 when cashier tries to intake at a different branch', async () => {
      const mainBranch = await getOrCreateMainShop();
      const secondBranch = await getOrCreateSecondBranch();
      const { user: cashier, password } = await seedUser(
        UserRole.CASHIER,
        'cashier-v4@test.com',
        mainBranch.id,
      );
      const cookies = await loginAndGetCookies(cashier.email, password);
      const product = await seedSerializedProduct(secondBranch.id);
      const customer = await seedCustomer();

      await request(app.getHttpServer())
        .post('/api/v1/phone-purchases')
        .set('Cookie', cookies)
        .send({
          customer_id: customer.id,
          branch_id: secondBranch.id,
          product_id: product.id,
          imei: validImei(),
          buying_price: 80000,
        })
        .expect(403);
    });

    it('rejects with 400 when product does not exist', async () => {
      const { user: cashier, password } = await seedUser(
        UserRole.CASHIER,
        'cashier-v5@test.com',
      );
      const cookies = await loginAndGetCookies(cashier.email, password);
      const branch = await getOrCreateMainShop();
      const customer = await seedCustomer();

      await request(app.getHttpServer())
        .post('/api/v1/phone-purchases')
        .set('Cookie', cookies)
        .send({
          customer_id: customer.id,
          branch_id: branch.id,
          product_id: '00000000-0000-0000-0000-000000000000',
          imei: validImei(),
          buying_price: 80000,
        })
        .expect(400);
    });

    it('rejects with 400 when product is not serialized', async () => {
      const { user: cashier, password } = await seedUser(
        UserRole.CASHIER,
        'cashier-v6@test.com',
      );
      const cookies = await loginAndGetCookies(cashier.email, password);
      const branch = await getOrCreateMainShop();
      const nonSerializedProduct = await seedSerializedProduct(branch.id, {
        is_serialized: false,
      });
      const customer = await seedCustomer();

      await request(app.getHttpServer())
        .post('/api/v1/phone-purchases')
        .set('Cookie', cookies)
        .send({
          customer_id: customer.id,
          branch_id: branch.id,
          product_id: nonSerializedProduct.id,
          imei: validImei(),
          buying_price: 80000,
        })
        .expect(400);
    });

    it('rejects with 400 when product belongs to a different branch', async () => {
      const { user: admin, password } = await seedUser(
        UserRole.ADMIN,
        'admin-v7@test.com',
      );
      const cookies = await loginAndGetCookies(admin.email, password);
      const mainBranch = await getOrCreateMainShop();
      const secondBranch = await getOrCreateSecondBranch();
      const productAtSecond = await seedSerializedProduct(secondBranch.id);
      const customer = await seedCustomer();

      await request(app.getHttpServer())
        .post('/api/v1/phone-purchases')
        .set('Cookie', cookies)
        .send({
          customer_id: customer.id,
          branch_id: mainBranch.id, // different from product's branch
          product_id: productAtSecond.id,
          imei: validImei(),
          buying_price: 80000,
        })
        .expect(400);
    });

    it('rejects with 409 and existing_unit payload when IMEI collides', async () => {
      const { user: cashier, password } = await seedUser(
        UserRole.CASHIER,
        'cashier-v8@test.com',
      );
      const cookies = await loginAndGetCookies(cashier.email, password);
      const branch = await getOrCreateMainShop();
      const product = await seedSerializedProduct(branch.id);
      const customer = await seedCustomer();
      const imei = validImei();

      // First intake succeeds
      const firstResponse = await request(app.getHttpServer())
        .post('/api/v1/phone-purchases')
        .set('Cookie', cookies)
        .send({
          customer_id: customer.id,
          branch_id: branch.id,
          product_id: product.id,
          imei,
          buying_price: 80000,
        })
        .expect(201);

      const firstUnitId = firstResponse.body.product_units[0].id;

      // Second intake with same IMEI → 409 with structured payload
      const secondResponse = await request(app.getHttpServer())
        .post('/api/v1/phone-purchases')
        .set('Cookie', cookies)
        .send({
          customer_id: customer.id,
          branch_id: branch.id,
          product_id: product.id,
          imei,
          buying_price: 85000,
        })
        .expect(409);

      expect(secondResponse.body).toMatchObject({
        message: 'IMEI already exists in inventory',
        existing_unit: {
          id: firstUnitId,
          status: ProductUnitStatus.IN_STOCK,
          product_id: product.id,
        },
      });
    });

    // ---- Buy-back: one ProductUnit row per acquisition ----

    async function intakeOnce(
      cookies: string[],
      branchId: string,
      productId: string,
      customerId: string,
      imei: string,
      buyingPrice: number,
      expected: number,
    ) {
      return request(app.getHttpServer())
        .post('/api/v1/phone-purchases')
        .set('Cookie', cookies)
        .send({
          customer_id: customerId,
          branch_id: branchId,
          product_id: productId,
          imei,
          buying_price: buyingPrice,
        })
        .expect(expected);
    }

    it.each([ProductUnitStatus.SOLD, ProductUnitStatus.RETURNED])(
      'buys back an IMEI whose earlier unit is %s as a new unit row, leaving the old row untouched',
      async (oldStatus) => {
        const { user: cashier, password } = await seedUser(
          UserRole.CASHIER,
          `cashier-buyback-${oldStatus.toLowerCase()}@test.com`,
        );
        const cookies = await loginAndGetCookies(cashier.email, password);
        const branch = await getOrCreateMainShop();
        const product = await seedSerializedProduct(branch.id);
        const customer = await seedCustomer();
        const imei = validImei();

        const first = await intakeOnce(
          cookies,
          branch.id,
          product.id,
          customer.id,
          imei,
          80000,
          201,
        );
        const unitRepo = dataSource.getRepository(ProductUnit);
        const firstUnitId = first.body.product_units[0].id;
        // The phone left the shop (sold, or its trade-in was voided).
        await unitRepo.update(firstUnitId, { status: oldStatus });
        const oldRow = await unitRepo.findOneByOrFail({ id: firstUnitId });

        const second = await intakeOnce(
          cookies,
          branch.id,
          product.id,
          customer.id,
          imei,
          55000,
          201,
        );

        const units = await unitRepo.find({
          where: { imei },
          order: { created_at: 'ASC' },
        });
        expect(units).toHaveLength(2);
        // Old row is history: byte-for-byte unchanged.
        expect(units[0]).toEqual(oldRow);
        expect(units[1]).toMatchObject({
          id: second.body.product_units[0].id,
          status: ProductUnitStatus.IN_STOCK,
          buying_price: '55000.00',
          phone_purchase_id: second.body.id,
        });
        const stock = await dataSource
          .getRepository(Stock)
          .findOneByOrFail({ product_id: product.id, branch_id: branch.id });
        expect(stock.quantity).toBe(2); // one increment per intake
      },
    );

    it('still rejects an IMEI whose unit is WRITTEN_OFF (409)', async () => {
      const { user: cashier, password } = await seedUser(
        UserRole.CASHIER,
        'cashier-written-off@test.com',
      );
      const cookies = await loginAndGetCookies(cashier.email, password);
      const branch = await getOrCreateMainShop();
      const product = await seedSerializedProduct(branch.id);
      const customer = await seedCustomer();
      const imei = validImei();

      const first = await intakeOnce(
        cookies,
        branch.id,
        product.id,
        customer.id,
        imei,
        80000,
        201,
      );
      const firstUnitId = first.body.product_units[0].id;
      await dataSource
        .getRepository(ProductUnit)
        .update(firstUnitId, { status: ProductUnitStatus.WRITTEN_OFF });

      const response = await intakeOnce(
        cookies,
        branch.id,
        product.id,
        customer.id,
        imei,
        55000,
        409,
      );
      expect(response.body.existing_unit).toMatchObject({
        id: firstUnitId,
        status: ProductUnitStatus.WRITTEN_OFF,
      });
      expect(
        await dataSource.getRepository(ProductUnit).count({ where: { imei } }),
      ).toBe(1);
    });

    it('rejects with 400 when the product is inactive', async () => {
      const { user: cashier, password } = await seedUser(
        UserRole.CASHIER,
        'cashier-inactive-product@test.com',
      );
      const cookies = await loginAndGetCookies(cashier.email, password);
      const branch = await getOrCreateMainShop();
      const product = await seedSerializedProduct(branch.id, {
        is_active: false,
      });
      const customer = await seedCustomer();

      const response = await intakeOnce(
        cookies,
        branch.id,
        product.id,
        customer.id,
        validImei(),
        80000,
        400,
      );
      expect(response.body.message).toBe(
        `Product "${product.name}" is inactive`,
      );
    });

    it('rejects with 400 when the customer has no NIC (P4-13), leaving the DB unchanged', async () => {
      const { user: cashier, password } = await seedUser(
        UserRole.CASHIER,
        'cashier-no-nic@test.com',
      );
      const cookies = await loginAndGetCookies(cashier.email, password);
      const branch = await getOrCreateMainShop();
      const product = await seedSerializedProduct(branch.id);
      const customer = await seedCustomer({ nic: null });
      const imei = validImei();

      const response = await intakeOnce(
        cookies,
        branch.id,
        product.id,
        customer.id,
        imei,
        80000,
        400,
      );

      expect(response.body.message).toBe(
        "A phone purchase needs the customer's NIC",
      );
      expect(
        await dataSource
          .getRepository(PhonePurchase)
          .count({ where: { customer_id: customer.id } }),
      ).toBe(0);
      expect(
        await dataSource.getRepository(ProductUnit).count({ where: { imei } }),
      ).toBe(0);
      const stock = await dataSource
        .getRepository(Stock)
        .findOne({ where: { product_id: product.id, branch_id: branch.id } });
      expect(stock?.quantity ?? 0).toBe(0);
    });

    it('rejects with 400 when selling_price is 0 (would resell for free)', async () => {
      const { user: cashier, password } = await seedUser(
        UserRole.CASHIER,
        'cashier-zero-price@test.com',
      );
      const cookies = await loginAndGetCookies(cashier.email, password);
      const branch = await getOrCreateMainShop();
      const product = await seedSerializedProduct(branch.id);
      const customer = await seedCustomer();

      const response = await request(app.getHttpServer())
        .post('/api/v1/phone-purchases')
        .set('Cookie', cookies)
        .send({
          customer_id: customer.id,
          branch_id: branch.id,
          product_id: product.id,
          imei: validImei(),
          buying_price: 80000,
          selling_price: 0,
        })
        .expect(400);

      expect(response.body.message).toEqual(
        expect.arrayContaining(['selling_price must not be less than 0.01']),
      );
      expect(await dataSource.getRepository(ProductUnit).count()).toBe(0);
    });

    it('rejects with 400 when imei is malformed (contains special chars)', async () => {
      const { user: cashier, password } = await seedUser(
        UserRole.CASHIER,
        'cashier-v9@test.com',
      );
      const cookies = await loginAndGetCookies(cashier.email, password);
      const branch = await getOrCreateMainShop();
      const product = await seedSerializedProduct(branch.id);
      const customer = await seedCustomer();

      await request(app.getHttpServer())
        .post('/api/v1/phone-purchases')
        .set('Cookie', cookies)
        .send({
          customer_id: customer.id,
          branch_id: branch.id,
          product_id: product.id,
          imei: '356938-035-643809',
          buying_price: 80000,
        })
        .expect(400);
    });

    it('rejects with 400 when buying_price is negative', async () => {
      const { user: cashier, password } = await seedUser(
        UserRole.CASHIER,
        'cashier-v10@test.com',
      );
      const cookies = await loginAndGetCookies(cashier.email, password);
      const branch = await getOrCreateMainShop();
      const product = await seedSerializedProduct(branch.id);
      const customer = await seedCustomer();

      await request(app.getHttpServer())
        .post('/api/v1/phone-purchases')
        .set('Cookie', cookies)
        .send({
          customer_id: customer.id,
          branch_id: branch.id,
          product_id: product.id,
          imei: validImei(),
          buying_price: -100,
        })
        .expect(400);
    });

    it('rejects with 401 when unauthenticated', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/phone-purchases')
        .send({
          customer_id: '00000000-0000-0000-0000-000000000000',
          branch_id: '00000000-0000-0000-0000-000000000000',
          product_id: '00000000-0000-0000-0000-000000000000',
          imei: validImei(),
          buying_price: 80000,
        })
        .expect(401);
    });

    it('leaves DB unchanged when a failure rolls back the transaction', async () => {
      const { user: cashier, password } = await seedUser(
        UserRole.CASHIER,
        'cashier-v11@test.com',
      );
      const cookies = await loginAndGetCookies(cashier.email, password);
      const branch = await getOrCreateMainShop();
      const product = await seedSerializedProduct(branch.id);
      const customer = await seedCustomer();

      // Snapshot counts BEFORE the failed request
      const purchasesBefore = await dataSource
        .getRepository(PhonePurchase)
        .count();
      const unitsBefore = await dataSource.getRepository(ProductUnit).count();
      const stockBefore = await dataSource.getRepository(Stock).findOne({
        where: { product_id: product.id, branch_id: branch.id },
      });

      // Send a request that will fail at IMEI collision (after other
      // validations pass and after PhonePurchase would have been
      // created if the tx weren't atomic)
      const imei = validImei();
      await request(app.getHttpServer())
        .post('/api/v1/phone-purchases')
        .set('Cookie', cookies)
        .send({
          customer_id: customer.id,
          branch_id: branch.id,
          product_id: product.id,
          imei,
          buying_price: 80000,
        })
        .expect(201);

      // Second attempt with same IMEI — will roll back after IMEI check
      await request(app.getHttpServer())
        .post('/api/v1/phone-purchases')
        .set('Cookie', cookies)
        .send({
          customer_id: customer.id,
          branch_id: branch.id,
          product_id: product.id,
          imei,
          buying_price: 90000,
        })
        .expect(409);

      // Counts should reflect only the successful first insert (+1),
      // not the failed second (which should have rolled back entirely)
      const purchasesAfter = await dataSource
        .getRepository(PhonePurchase)
        .count();
      const unitsAfter = await dataSource.getRepository(ProductUnit).count();
      const stockAfter = await dataSource.getRepository(Stock).findOne({
        where: { product_id: product.id, branch_id: branch.id },
      });

      expect(purchasesAfter).toBe(purchasesBefore + 1);
      expect(unitsAfter).toBe(unitsBefore + 1);
      expect(stockAfter!.quantity).toBe(stockBefore!.quantity + 1);
    });
  });

  // ---- GET /phone-purchases (list) ----

  describe('GET /phone-purchases', () => {
    it('returns paginated list for authenticated user', async () => {
      const { user: cashier, password } = await seedUser(
        UserRole.CASHIER,
        'cashier-g1@test.com',
      );
      const cookies = await loginAndGetCookies(cashier.email, password);
      const branch = await getOrCreateMainShop();
      const product = await seedSerializedProduct(branch.id);
      const customer = await seedCustomer();

      // Seed 3 purchases
      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .post('/api/v1/phone-purchases')
          .set('Cookie', cookies)
          .send({
            customer_id: customer.id,
            branch_id: branch.id,
            product_id: product.id,
            imei: validImei(),
            buying_price: 80000 + i * 1000,
          })
          .expect(201);
      }

      const response = await request(app.getHttpServer())
        .get('/api/v1/phone-purchases')
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.data).toHaveLength(3);
      expect(response.body.meta).toMatchObject({
        total: 3,
        page: 1,
        limit: 50,
        totalPages: 1,
      });
    });

    it('filters by customer_id', async () => {
      const { user: cashier, password } = await seedUser(
        UserRole.CASHIER,
        'cashier-g2@test.com',
      );
      const cookies = await loginAndGetCookies(cashier.email, password);
      const branch = await getOrCreateMainShop();
      const product = await seedSerializedProduct(branch.id);
      const customerA = await seedCustomer({ name: 'Customer A' });
      const customerB = await seedCustomer({ name: 'Customer B' });

      // 2 purchases for A, 1 for B
      await request(app.getHttpServer())
        .post('/api/v1/phone-purchases')
        .set('Cookie', cookies)
        .send({
          customer_id: customerA.id,
          branch_id: branch.id,
          product_id: product.id,
          imei: validImei(),
          buying_price: 80000,
        })
        .expect(201);
      await request(app.getHttpServer())
        .post('/api/v1/phone-purchases')
        .set('Cookie', cookies)
        .send({
          customer_id: customerA.id,
          branch_id: branch.id,
          product_id: product.id,
          imei: validImei(),
          buying_price: 80000,
        })
        .expect(201);
      await request(app.getHttpServer())
        .post('/api/v1/phone-purchases')
        .set('Cookie', cookies)
        .send({
          customer_id: customerB.id,
          branch_id: branch.id,
          product_id: product.id,
          imei: validImei(),
          buying_price: 80000,
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/phone-purchases?customer_id=${customerA.id}`)
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(
        (response.body.data as Array<{ customer_id: string }>).every(
          (p) => p.customer_id === customerA.id,
        ),
      ).toBe(true);
    });

    it('returns 401 when unauthenticated', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/phone-purchases')
        .expect(401);
    });
  });

  // ---- GET /phone-purchases/:id ----

  describe('GET /phone-purchases/:id', () => {
    it('returns the purchase with all relations', async () => {
      const { user: cashier, password } = await seedUser(
        UserRole.CASHIER,
        'cashier-g3@test.com',
      );
      const cookies = await loginAndGetCookies(cashier.email, password);
      const branch = await getOrCreateMainShop();
      const product = await seedSerializedProduct(branch.id);
      const customer = await seedCustomer();

      const createResponse = await request(app.getHttpServer())
        .post('/api/v1/phone-purchases')
        .set('Cookie', cookies)
        .send({
          customer_id: customer.id,
          branch_id: branch.id,
          product_id: product.id,
          imei: validImei(),
          buying_price: 80000,
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/phone-purchases/${createResponse.body.id}`)
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body).toMatchObject({
        id: createResponse.body.id,
        customer_id: customer.id,
        branch_id: branch.id,
        cashier_id: cashier.id,
      });
      expect(response.body.customer).toMatchObject({ id: customer.id });
      expect(response.body.branch).toMatchObject({ id: branch.id });
      expect(response.body.cashier).toMatchObject({ id: cashier.id });
      expect(response.body.product_units).toHaveLength(1);
    });

    it('returns 404 when the purchase does not exist', async () => {
      const { user: cashier, password } = await seedUser(
        UserRole.CASHIER,
        'cashier-g4@test.com',
      );
      const cookies = await loginAndGetCookies(cashier.email, password);

      await request(app.getHttpServer())
        .get('/api/v1/phone-purchases/00000000-0000-0000-0000-000000000000')
        .set('Cookie', cookies)
        .expect(404);
    });

    it('returns 400 on malformed UUID', async () => {
      const { user: cashier, password } = await seedUser(
        UserRole.CASHIER,
        'cashier-g5@test.com',
      );
      const cookies = await loginAndGetCookies(cashier.email, password);

      await request(app.getHttpServer())
        .get('/api/v1/phone-purchases/not-a-uuid')
        .set('Cookie', cookies)
        .expect(400);
    });
  });
});
