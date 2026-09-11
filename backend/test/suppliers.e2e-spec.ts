import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { createTestApp, truncateAllTables } from './setup';
import { User } from '../src/users/entities/user.entity';
import { UserRole } from '../src/users/enums/user-role.enum';
import { Supplier } from '../src/suppliers/entities/supplier.entity';
import { Branch } from '../src/branches/entities/branch.entity';
import { Product } from '../src/products/entities/product.entity';
import { ProductType } from '../src/products/enums/product-type.enum';
import { Brand } from '../src/brands/entities/brand.entity';
import { Category } from '../src/categories/entities/category.entity';
import { SkuBarcodeCounter } from '../src/sku-barcode-counters/entities/sku-barcode-counter.entity';
import { Sale } from '../src/sales/entities/sale.entity';
import { SaleStatus } from '../src/sales/enums/sale-status.enum';
import { SaleType } from '../src/sales/enums/sale-type.enum';
import { SaleLine } from '../src/sales/entities/sale-line.entity';
import { Stock } from '../src/stock/entities/stock.entity';
import { PaymentMethod } from '../src/sales/enums/payment-method.enum';

describe('Suppliers (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await truncateAllTables(app);
    // Re-seed counter rows required by Products (schema invariant).
    // Only matters for tests that create products via the sales flow.
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

  async function seedSupplier(overrides: Partial<Supplier> = {}) {
    const repo = dataSource.getRepository(Supplier);
    return repo.save(
      repo.create({
        name: 'Ranjith Mobile',
        contact_person: null,
        phone: null,
        email: null,
        address: null,
        notes: null,
        is_active: true,
        ...overrides,
      }),
    );
  }

  async function loginAndGetCookies(
    email: string,
    password: string,
  ): Promise<string[]> {
    // Small delay to avoid tripping the 10/sec throttler.
    await new Promise((r) => setTimeout(r, 110));

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return response.headers['set-cookie'] as unknown as string[];
  }

  /**
   * Seed a product at the given branch. Reuses one Brand + one Category
   * per test run (idempotent — beforeEach truncates, so within a single
   * test they persist). Used exclusively by the sales-count tests below.
   */
  async function seedProduct(branchId: string): Promise<Product> {
    const brandRepo = dataSource.getRepository(Brand);
    let brand = await brandRepo.findOne({ where: { name: 'TestBrand' } });
    if (!brand) {
      brand = await brandRepo.save({
        name: 'TestBrand',
        is_active: true,
      } as Brand);
    }
    const categoryRepo = dataSource.getRepository(Category);
    let category = await categoryRepo.findOne({
      where: { name: 'TestCategory' },
    });
    if (!category) {
      category = await categoryRepo.save({
        name: 'TestCategory',
        is_active: true,
      } as Category);
    }
    const repo = dataSource.getRepository(Product);
    const suffix = Math.random().toString(36).slice(2, 8);
    return repo.save(
      repo.create({
        product_type: ProductType.PHONE,
        name: 'Test Phone',
        sku: `SKU-TEST-${suffix}`,
        barcode: `BC-${suffix}`,
        brand_id: brand.id,
        category_id: category.id,
        branch_id: branchId,
        buying_price: '80.00',
        selling_price: '100.00',
        is_active: true,
      }),
    );
  }

  /**
   * Set stock quantity for a (product, branch). Products auto-create
   * stock rows at qty=0 via the Phase 6.1 hook; this UPDATEs.
   */
  async function setStockQuantity(
    productId: string,
    branchId: string,
    quantity: number,
  ): Promise<void> {
    const repo = dataSource.getRepository(Stock);
    const existing = await repo.findOne({
      where: { product_id: productId, branch_id: branchId },
    });
    if (existing) {
      await repo.update(existing.id, { quantity, manage_stock: true });
    } else {
      await repo.save(
        repo.create({
          product_id: productId,
          branch_id: branchId,
          quantity,
          min_quantity: 0,
          manage_stock: true,
        }),
      );
    }
  }

  /**
   * Complete a sale that has one line sourced from the given external
   * supplier. Returns the completed sale. Optionally voids it afterward
   * (for tests that verify VOIDED sales are excluded from the count).
   *
   * Uses the real HTTP flow (line + payment + complete) rather than
   * bypassing to seed data — the whole point of this test is to verify
   * the query returns what production code writes. Bypassing would
   * mean testing the query in isolation from the schema that feeds it.
   */
  async function completeSaleWithExternalSupplier(
    branch: Branch,
    cashierId: string,
    supplierId: string,
    cookies: string[],
    opts: { voidAfter?: boolean } = {},
  ): Promise<Sale> {
    const product = await seedProduct(branch.id);
    await setStockQuantity(product.id, branch.id, 5);

    const saleRepo = dataSource.getRepository(Sale);
    const sale = await saleRepo.save(
      saleRepo.create({
        sale_type: SaleType.RETAIL,
        status: SaleStatus.DRAFT,
        branch_id: branch.id,
        cashier_id: cashierId,
        subtotal: '0',
        discount_total: '0',
        tax_total: '0',
        total: '0',
        amount_paid: '0',
        change_due: '0',
      }),
    );

    await request(app.getHttpServer())
      .post(`/api/v1/sales/${sale.id}/lines`)
      .set('Cookie', cookies)
      .send({
        product_id: product.id,
        quantity: 1,
        external_supplier_id: supplierId,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/sales/${sale.id}/payments`)
      .set('Cookie', cookies)
      .send({
        payment_method: PaymentMethod.CASH,
        amount: 100,
        cash_received: 100,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/sales/${sale.id}/complete`)
      .set('Cookie', cookies)
      .expect(200);

    if (opts.voidAfter) {
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/void`)
        .set('Cookie', cookies)
        .send({ void_reason: 'Test void for count-exclusion verification' })
        .expect(200);
    }

    return sale;
  }

  describe('GET /api/v1/suppliers', () => {
    it('returns list to admin, sorted alphabetically', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      await seedSupplier({ name: 'Zulfi Shop' });
      await seedSupplier({ name: 'Ahmed Mobiles' });
      await seedSupplier({ name: 'Ranjith Mobile' });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .get('/api/v1/suppliers')
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body).toHaveLength(3);
      expect(response.body.map((s: Supplier) => s.name)).toEqual([
        'Ahmed Mobiles',
        'Ranjith Mobile',
        'Zulfi Shop',
      ]);
    });

    it('returns list to manager', async () => {
      const { user, password } = await seedUser(UserRole.MANAGER, 'm@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .get('/api/v1/suppliers')
        .set('Cookie', cookies)
        .expect(200);
    });

    it('returns list to cashier', async () => {
      const { user, password } = await seedUser(UserRole.CASHIER, 'c@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .get('/api/v1/suppliers')
        .set('Cookie', cookies)
        .expect(200);
    });

    it('excludes inactive suppliers by default', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      await seedSupplier({ name: 'Active Shop', is_active: true });
      await seedSupplier({ name: 'Closed Shop', is_active: false });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .get('/api/v1/suppliers')
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].name).toBe('Active Shop');
    });

    it('includes inactive suppliers when includeInactive=true', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      await seedSupplier({ name: 'Active Shop', is_active: true });
      await seedSupplier({ name: 'Closed Shop', is_active: false });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .get('/api/v1/suppliers?includeInactive=true')
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body).toHaveLength(2);
    });

    it('returns 401 when unauthenticated', async () => {
      await request(app.getHttpServer()).get('/api/v1/suppliers').expect(401);
    });
  });

  describe('GET /api/v1/suppliers/:id', () => {
    it('admin can fetch a single supplier with all fields', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const supplier = await seedSupplier({
        name: 'Ranjith Mobile',
        contact_person: 'Ranjith',
        phone: '0771234567',
        email: 'ranjith@shop.lk',
        address: 'No 45, Galle Road',
        notes: '30-day terms',
      });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${supplier.id}`)
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body).toMatchObject({
        id: supplier.id,
        name: 'Ranjith Mobile',
        contact_person: 'Ranjith',
        phone: '0771234567',
        email: 'ranjith@shop.lk',
        address: 'No 45, Galle Road',
        notes: '30-day terms',
        is_active: true,
      });
    });

    it('returns 404 for a non-existent supplier', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const fakeId = '00000000-0000-0000-0000-000000000000';

      await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${fakeId}`)
        .set('Cookie', cookies)
        .expect(404);
    });

    it('returns 400 for a malformed UUID', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .get('/api/v1/suppliers/not-a-uuid')
        .set('Cookie', cookies)
        .expect(400);
    });
  });

  describe('GET /api/v1/suppliers/:id/sales-count', () => {
    it('returns count: 0 for a supplier with no sales', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const supplier = await seedSupplier();
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${supplier.id}/sales-count`)
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body).toEqual({ count: 0 });
    });

    it('counts a single COMPLETED sale that references the supplier', async () => {
      const branch = await getOrCreateMainShop();
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const supplier = await seedSupplier();
      const cookies = await loginAndGetCookies(user.email, password);

      await completeSaleWithExternalSupplier(
        branch,
        user.id,
        supplier.id,
        cookies,
      );

      const response = await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${supplier.id}/sales-count`)
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body).toEqual({ count: 1 });
    });

    it('counts multiple COMPLETED sales referencing the supplier', async () => {
      const branch = await getOrCreateMainShop();
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const supplier = await seedSupplier();
      const cookies = await loginAndGetCookies(user.email, password);

      // Three separate completed sales, each with one line from this supplier
      await completeSaleWithExternalSupplier(
        branch,
        user.id,
        supplier.id,
        cookies,
      );
      await completeSaleWithExternalSupplier(
        branch,
        user.id,
        supplier.id,
        cookies,
      );
      await completeSaleWithExternalSupplier(
        branch,
        user.id,
        supplier.id,
        cookies,
      );

      const response = await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${supplier.id}/sales-count`)
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body).toEqual({ count: 3 });
    });

    it('excludes VOIDED sales from the count', async () => {
      const branch = await getOrCreateMainShop();
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const supplier = await seedSupplier();
      const cookies = await loginAndGetCookies(user.email, password);

      // Two completed sales for this supplier, then void one
      await completeSaleWithExternalSupplier(
        branch,
        user.id,
        supplier.id,
        cookies,
      );
      await completeSaleWithExternalSupplier(
        branch,
        user.id,
        supplier.id,
        cookies,
        { voidAfter: true },
      );

      // Only the non-voided sale should count
      const response = await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${supplier.id}/sales-count`)
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body).toEqual({ count: 1 });
    });

    it('excludes DRAFT sales from the count (line seeded, sale never completed)', async () => {
      const branch = await getOrCreateMainShop();
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const supplier = await seedSupplier();
      const cookies = await loginAndGetCookies(user.email, password);

      // Create a DRAFT sale with an external-supplier line, but never
      // complete it. Should NOT count.
      const product = await seedProduct(branch.id);
      await setStockQuantity(product.id, branch.id, 5);
      const saleRepo = dataSource.getRepository(Sale);
      const draftSale = await saleRepo.save(
        saleRepo.create({
          sale_type: SaleType.RETAIL,
          status: SaleStatus.DRAFT,
          branch_id: branch.id,
          cashier_id: user.id,
          subtotal: '0',
          discount_total: '0',
          tax_total: '0',
          total: '0',
          amount_paid: '0',
          change_due: '0',
        }),
      );
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${draftSale.id}/lines`)
        .set('Cookie', cookies)
        .send({
          product_id: product.id,
          quantity: 1,
          external_supplier_id: supplier.id,
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${supplier.id}/sales-count`)
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body).toEqual({ count: 0 });
    });

    it('does not count sales for a different supplier', async () => {
      const branch = await getOrCreateMainShop();
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const supplierA = await seedSupplier({ name: 'Supplier A' });
      const supplierB = await seedSupplier({ name: 'Supplier B' });
      const cookies = await loginAndGetCookies(user.email, password);

      // 2 sales for A, 1 for B
      await completeSaleWithExternalSupplier(
        branch,
        user.id,
        supplierA.id,
        cookies,
      );
      await completeSaleWithExternalSupplier(
        branch,
        user.id,
        supplierA.id,
        cookies,
      );
      await completeSaleWithExternalSupplier(
        branch,
        user.id,
        supplierB.id,
        cookies,
      );

      const respA = await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${supplierA.id}/sales-count`)
        .set('Cookie', cookies)
        .expect(200);
      const respB = await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${supplierB.id}/sales-count`)
        .set('Cookie', cookies)
        .expect(200);

      expect(respA.body).toEqual({ count: 2 });
      expect(respB.body).toEqual({ count: 1 });
    });

    it('counts a sale with multiple lines from the same supplier as ONE', async () => {
      // The DISTINCT test. If Ranjith supplies 3 phones on one customer
      // sale, that's ONE settlement transaction, not three.
      const branch = await getOrCreateMainShop();
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const supplier = await seedSupplier();
      const cookies = await loginAndGetCookies(user.email, password);

      const productA = await seedProduct(branch.id);
      const productB = await seedProduct(branch.id);
      const productC = await seedProduct(branch.id);
      await setStockQuantity(productA.id, branch.id, 5);
      await setStockQuantity(productB.id, branch.id, 5);
      await setStockQuantity(productC.id, branch.id, 5);

      const saleRepo = dataSource.getRepository(Sale);
      const sale = await saleRepo.save(
        saleRepo.create({
          sale_type: SaleType.RETAIL,
          status: SaleStatus.DRAFT,
          branch_id: branch.id,
          cashier_id: user.id,
          subtotal: '0',
          discount_total: '0',
          tax_total: '0',
          total: '0',
          amount_paid: '0',
          change_due: '0',
        }),
      );
      // Three lines, all from the same supplier
      for (const p of [productA, productB, productC]) {
        await request(app.getHttpServer())
          .post(`/api/v1/sales/${sale.id}/lines`)
          .set('Cookie', cookies)
          .send({
            product_id: p.id,
            quantity: 1,
            external_supplier_id: supplier.id,
          })
          .expect(201);
      }
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/payments`)
        .set('Cookie', cookies)
        .send({
          payment_method: PaymentMethod.CASH,
          amount: 300,
          cash_received: 300,
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/complete`)
        .set('Cookie', cookies)
        .expect(200);

      // Three lines, ONE sale — count should be 1, not 3
      const response = await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${supplier.id}/sales-count`)
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body).toEqual({ count: 1 });

      // Verify at DB level that there really are 3 lines (test contract sanity)
      const lineRepo = dataSource.getRepository(SaleLine);
      const lines = await lineRepo.find({
        where: { external_supplier_id: supplier.id },
      });
      expect(lines).toHaveLength(3);
    });

    it('returns 404 for a non-existent supplier', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const fakeId = '00000000-0000-0000-0000-000000000000';

      await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${fakeId}/sales-count`)
        .set('Cookie', cookies)
        .expect(404);
    });

    it('cashier is forbidden from viewing sales-count', async () => {
      const { user, password } = await seedUser(UserRole.CASHIER, 'c@t.com');
      const supplier = await seedSupplier();
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${supplier.id}/sales-count`)
        .set('Cookie', cookies)
        .expect(403);
    });
  });

  describe('POST /api/v1/suppliers', () => {
    it('admin can create a supplier with only the required name', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Cookie', cookies)
        .send({ name: 'Ranjith Mobile' })
        .expect(201);

      expect(response.body).toMatchObject({
        name: 'Ranjith Mobile',
        contact_person: null,
        phone: null,
        email: null,
        address: null,
        notes: null,
        is_active: true,
      });
      expect(response.body.id).toBeDefined();
    });

    it('admin can create a supplier with all fields', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Cookie', cookies)
        .send({
          name: 'Ranjith Mobile',
          contact_person: 'Ranjith Perera',
          phone: '0771234567',
          email: 'ranjith@shop.lk',
          address: 'No 45, Galle Road, Colombo 03',
          notes: '30-day terms',
        })
        .expect(201);

      expect(response.body).toMatchObject({
        name: 'Ranjith Mobile',
        contact_person: 'Ranjith Perera',
        phone: '0771234567',
        email: 'ranjith@shop.lk',
        address: 'No 45, Galle Road, Colombo 03',
        notes: '30-day terms',
      });
    });

    it('trims whitespace from all fields', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Cookie', cookies)
        .send({
          name: '  Ranjith Mobile  ',
          contact_person: '  Ranjith  ',
          phone: '  0771234567  ',
          email: '  ranjith@shop.lk  ',
          address: '  No 45  ',
          notes: '  Notes  ',
        })
        .expect(201);

      expect(response.body.name).toBe('Ranjith Mobile');
      expect(response.body.contact_person).toBe('Ranjith');
      expect(response.body.phone).toBe('0771234567');
      expect(response.body.email).toBe('ranjith@shop.lk');
      expect(response.body.address).toBe('No 45');
      expect(response.body.notes).toBe('Notes');
    });

    it('rejects duplicate name (case-insensitive) with 409', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      await seedSupplier({ name: 'Ranjith Mobile' });
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Cookie', cookies)
        .send({ name: 'ranjith mobile' })
        .expect(409);
    });

    it('rejects invalid Sri Lankan phone format with 400', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Cookie', cookies)
        .send({ name: 'Shop', phone: '1234567890' })
        .expect(400);
    });

    it('rejects invalid email with 400', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Cookie', cookies)
        .send({ name: 'Shop', email: 'not-an-email' })
        .expect(400);
    });

    it('manager is forbidden from creating', async () => {
      const { user, password } = await seedUser(UserRole.MANAGER, 'm@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Cookie', cookies)
        .send({ name: 'Shop' })
        .expect(403);
    });

    it('cashier is forbidden from creating', async () => {
      const { user, password } = await seedUser(UserRole.CASHIER, 'c@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Cookie', cookies)
        .send({ name: 'Shop' })
        .expect(403);
    });

    it('rejects missing name', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Cookie', cookies)
        .send({})
        .expect(400);
    });
  });

  describe('PATCH /api/v1/suppliers/:id', () => {
    it('admin can rename a supplier', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const supplier = await seedSupplier();
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/suppliers/${supplier.id}`)
        .set('Cookie', cookies)
        .send({ name: 'Ranjith Mobile Pvt Ltd' })
        .expect(200);

      expect(response.body.name).toBe('Ranjith Mobile Pvt Ltd');
    });

    it('admin can update optional fields', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const supplier = await seedSupplier();
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/suppliers/${supplier.id}`)
        .set('Cookie', cookies)
        .send({
          contact_person: 'New Contact',
          phone: '0779999999',
          email: 'new@shop.lk',
        })
        .expect(200);

      expect(response.body.contact_person).toBe('New Contact');
      expect(response.body.phone).toBe('0779999999');
      expect(response.body.email).toBe('new@shop.lk');
      // Unchanged fields stay as they were
      expect(response.body.name).toBe('Ranjith Mobile');
    });

    it('empty strings on optional fields clear them to null', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const supplier = await seedSupplier({
        contact_person: 'Old Contact',
        phone: '0770000000',
      });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/suppliers/${supplier.id}`)
        .set('Cookie', cookies)
        .send({ contact_person: '', phone: '' })
        .expect(200);

      expect(response.body.contact_person).toBeNull();
      expect(response.body.phone).toBeNull();
    });

    it('rejects rename to existing name (case-insensitive) with 409', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const supplier = await seedSupplier({ name: 'Ranjith Mobile' });
      await seedSupplier({ name: 'Ahmed Mobiles' });
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .patch(`/api/v1/suppliers/${supplier.id}`)
        .set('Cookie', cookies)
        .send({ name: 'ahmed mobiles' })
        .expect(409);
    });

    it('allows renaming to the same name (different case)', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const supplier = await seedSupplier({ name: 'Ranjith Mobile' });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/suppliers/${supplier.id}`)
        .set('Cookie', cookies)
        .send({ name: 'RANJITH MOBILE' })
        .expect(200);

      expect(response.body.name).toBe('RANJITH MOBILE');
    });

    it('cashier is forbidden from updating', async () => {
      const { user, password } = await seedUser(UserRole.CASHIER, 'c@t.com');
      const supplier = await seedSupplier();
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .patch(`/api/v1/suppliers/${supplier.id}`)
        .set('Cookie', cookies)
        .send({ name: 'Hacked' })
        .expect(403);
    });
  });

  describe('DELETE /api/v1/suppliers/:id', () => {
    it('deactivates a supplier', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const supplier = await seedSupplier();
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .delete(`/api/v1/suppliers/${supplier.id}`)
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.is_active).toBe(false);
    });

    it('returns 404 for a non-existent supplier', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const fakeId = '00000000-0000-0000-0000-000000000000';

      await request(app.getHttpServer())
        .delete(`/api/v1/suppliers/${fakeId}`)
        .set('Cookie', cookies)
        .expect(404);
    });

    it('cashier is forbidden from deactivating', async () => {
      const { user, password } = await seedUser(UserRole.CASHIER, 'c@t.com');
      const supplier = await seedSupplier();
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .delete(`/api/v1/suppliers/${supplier.id}`)
        .set('Cookie', cookies)
        .expect(403);
    });
  });

  describe('POST /api/v1/suppliers/:id/reactivate', () => {
    it('reactivates a deactivated supplier', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const supplier = await seedSupplier({ is_active: false });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/suppliers/${supplier.id}/reactivate`)
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.is_active).toBe(true);
    });

    it('cashier is forbidden from reactivating', async () => {
      const { user, password } = await seedUser(UserRole.CASHIER, 'c@t.com');
      const supplier = await seedSupplier({ is_active: false });
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post(`/api/v1/suppliers/${supplier.id}/reactivate`)
        .set('Cookie', cookies)
        .expect(403);
    });
  });
});
