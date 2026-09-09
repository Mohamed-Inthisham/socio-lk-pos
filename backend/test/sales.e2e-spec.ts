import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { createTestApp, truncateAllTables } from './setup';
import { User } from '../src/users/entities/user.entity';
import { UserRole } from '../src/users/enums/user-role.enum';
import { Sale } from '../src/sales/entities/sale.entity';
import { SaleStatus } from '../src/sales/enums/sale-status.enum';
import { SaleType } from '../src/sales/enums/sale-type.enum';
import { Branch } from '../src/branches/entities/branch.entity';
import { Brand } from '../src/brands/entities/brand.entity';
import { Category } from '../src/categories/entities/category.entity';
import { Product } from '../src/products/entities/product.entity';
import { ProductType } from '../src/products/enums/product-type.enum';
import { SkuBarcodeCounter } from '../src/sku-barcode-counters/entities/sku-barcode-counter.entity';
import { Supplier } from '../src/suppliers/entities/supplier.entity';
import { SaleLine } from '../src/sales/entities/sale-line.entity';
import { DiscountType } from '../src/sales/enums/discount-type.enum';

describe('Sales (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await truncateAllTables(app);
    // Re-seed counter rows required by Products (schema invariant).
    // Only matters for tests that create products (line endpoints);
    // safe/cheap for the rest.
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

  async function seedBranch(overrides: Partial<Branch> = {}): Promise<Branch> {
    const repo = dataSource.getRepository(Branch);
    return repo.save(
      repo.create({ name: 'Main Shop', is_active: true, ...overrides }),
    );
  }

  async function seedUser(role: UserRole, email: string, branchId?: string) {
    const password = 'testpass123';
    const password_hash = await bcrypt.hash(password, 4);

    let resolvedBranchId: string | null = null;
    if (role !== UserRole.ADMIN) {
      // Non-admin users need a branch. If not provided, seed Main Shop.
      resolvedBranchId =
        branchId ??
        (
          await (async () => {
            const repo = dataSource.getRepository(Branch);
            const existing = await repo.findOne({
              where: { name: 'Main Shop' },
            });
            if (existing) return existing;
            return repo.save(
              repo.create({ name: 'Main Shop', is_active: true }),
            );
          })()
        ).id;
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

  async function seedSale(overrides: Partial<Sale>): Promise<Sale> {
    const repo = dataSource.getRepository(Sale);
    return repo.save(
      repo.create({
        sale_type: SaleType.RETAIL,
        status: SaleStatus.DRAFT,
        subtotal: '0',
        discount_total: '0',
        tax_total: '0',
        total: '0',
        amount_paid: '0',
        change_due: '0',
        ...overrides,
      }),
    );
  }

  /**
   * Seed a product at the given branch. Auto-creates a matching brand and
   * category (idempotent per test — beforeEach truncates). Used by line
   * endpoint tests; not needed by the C3 endpoint tests above.
   */
  async function seedProduct(
    branchId: string,
    overrides: {
      name?: string;
      selling_price?: string;
      buying_price?: string;
      is_active?: boolean;
    } = {},
  ): Promise<Product> {
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
    // SKU/barcode use random suffixes so tests can seed multiple products
    // in one run without collisions.
    const suffix = Math.random().toString(36).slice(2, 8);
    return repo.save(
      repo.create({
        product_type: ProductType.PHONE,
        name: overrides.name ?? 'Test Phone',
        sku: `SKU-TEST-${suffix}`,
        barcode: `BC-${suffix}`,
        brand_id: brand.id,
        category_id: category.id,
        branch_id: branchId,
        buying_price: overrides.buying_price ?? '80000.00',
        selling_price: overrides.selling_price ?? '100000.00',
        is_active: overrides.is_active ?? true,
      }),
    );
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

  describe('POST /api/v1/sales', () => {
    it('cashier can create a DRAFT sale at their own branch', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(
        UserRole.CASHIER,
        'c@t.com',
        branch.id,
      );
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .post('/api/v1/sales')
        .set('Cookie', cookies)
        .send({ branch_id: branch.id })
        .expect(201);

      expect(response.body).toMatchObject({
        sale_type: SaleType.RETAIL,
        status: SaleStatus.DRAFT,
        branch_id: branch.id,
        cashier_id: user.id,
        customer_id: null,
        notes: null,
        subtotal: '0.00',
        total: '0.00',
        amount_paid: '0.00',
      });
      expect(response.body.id).toBeDefined();
      expect(response.body.sale_number).toBeNull();
    });

    it('admin can create a DRAFT sale at any branch', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .post('/api/v1/sales')
        .set('Cookie', cookies)
        .send({ branch_id: branch.id })
        .expect(201);

      expect(response.body.cashier_id).toBe(user.id);
      expect(response.body.branch_id).toBe(branch.id);
    });

    it('accepts optional notes and customer_id', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(
        UserRole.CASHIER,
        'c@t.com',
        branch.id,
      );
      const cookies = await loginAndGetCookies(user.email, password);
      const customerId = '11111111-1111-4111-8111-111111111111';

      const response = await request(app.getHttpServer())
        .post('/api/v1/sales')
        .set('Cookie', cookies)
        .send({
          branch_id: branch.id,
          customer_id: customerId,
          notes: '  SMS receipt  ',
        })
        .expect(201);

      expect(response.body.customer_id).toBe(customerId);
      expect(response.body.notes).toBe('SMS receipt');
    });

    it('trims notes and clears empty-string notes to null', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(
        UserRole.CASHIER,
        'c@t.com',
        branch.id,
      );
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .post('/api/v1/sales')
        .set('Cookie', cookies)
        .send({ branch_id: branch.id, notes: '   ' })
        .expect(201);

      expect(response.body.notes).toBeNull();
    });

    it('returns 403 when cashier targets a different branch', async () => {
      const branchA = await seedBranch({ name: 'Branch A' });
      const branchB = await seedBranch({ name: 'Branch B' });
      const { user, password } = await seedUser(
        UserRole.CASHIER,
        'c@t.com',
        branchA.id,
      );
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post('/api/v1/sales')
        .set('Cookie', cookies)
        .send({ branch_id: branchB.id })
        .expect(403);
    });

    it('returns 404 when branch does not exist', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const fakeBranchId = '00000000-0000-0000-0000-000000000000';

      await request(app.getHttpServer())
        .post('/api/v1/sales')
        .set('Cookie', cookies)
        .send({ branch_id: fakeBranchId })
        .expect(404);
    });

    it('returns 400 when branch is inactive', async () => {
      const branch = await seedBranch({ is_active: false });
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post('/api/v1/sales')
        .set('Cookie', cookies)
        .send({ branch_id: branch.id })
        .expect(400);
    });

    it('returns 400 when branch_id is missing', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post('/api/v1/sales')
        .set('Cookie', cookies)
        .send({})
        .expect(400);
    });

    it('returns 400 when branch_id is not a valid UUID', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post('/api/v1/sales')
        .set('Cookie', cookies)
        .send({ branch_id: 'not-a-uuid' })
        .expect(400);
    });

    it('returns 401 when unauthenticated', async () => {
      const branch = await seedBranch();

      await request(app.getHttpServer())
        .post('/api/v1/sales')
        .send({ branch_id: branch.id })
        .expect(401);
    });
  });

  describe('GET /api/v1/sales', () => {
    it('returns paginated response with data + meta', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      await seedSale({ branch_id: branch.id, cashier_id: user.id });
      await seedSale({ branch_id: branch.id, cashier_id: user.id });
      await seedSale({ branch_id: branch.id, cashier_id: user.id });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .get('/api/v1/sales')
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.data).toHaveLength(3);
      expect(response.body.meta).toMatchObject({
        total: 3,
        page: 1,
        limit: 50,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      });
    });

    it('includes nested branch and cashier in each row', async () => {
      const branch = await seedBranch({ name: 'Kandy Shop' });
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      await seedSale({ branch_id: branch.id, cashier_id: user.id });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .get('/api/v1/sales')
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.data[0].branch).toMatchObject({
        id: branch.id,
        name: 'Kandy Shop',
      });
      expect(response.body.data[0].cashier).toMatchObject({
        id: user.id,
        email: user.email,
      });
    });

    it('paginates correctly on page 2 with limit 2', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      for (let i = 0; i < 5; i++) {
        await seedSale({ branch_id: branch.id, cashier_id: user.id });
      }
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .get('/api/v1/sales?page=2&limit=2')
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.meta).toMatchObject({
        total: 5,
        page: 2,
        limit: 2,
        totalPages: 3,
        hasNext: true,
        hasPrev: true,
      });
    });

    it('filters by branchId', async () => {
      const branchA = await seedBranch({ name: 'Branch A' });
      const branchB = await seedBranch({ name: 'Branch B' });
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      await seedSale({ branch_id: branchA.id, cashier_id: user.id });
      await seedSale({ branch_id: branchB.id, cashier_id: user.id });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/sales?branchId=${branchA.id}`)
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].branch_id).toBe(branchA.id);
    });

    it('filters by status', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
        status: SaleStatus.DRAFT,
      });
      await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
        status: SaleStatus.COMPLETED,
        sale_number: 'INV-20260825-0001',
        completed_at: new Date(),
      });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .get('/api/v1/sales?status=DRAFT')
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].status).toBe(SaleStatus.DRAFT);
    });

    it('returns 400 when status filter is invalid', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .get('/api/v1/sales?status=NOT_A_STATUS')
        .set('Cookie', cookies)
        .expect(400);
    });

    it('returns 400 when limit exceeds 200', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .get('/api/v1/sales?limit=500')
        .set('Cookie', cookies)
        .expect(400);
    });

    it('returns 401 when unauthenticated', async () => {
      await request(app.getHttpServer()).get('/api/v1/sales').expect(401);
    });

    it('cashier and manager can list sales', async () => {
      const branch = await seedBranch();

      const cashier = await seedUser(UserRole.CASHIER, 'c@t.com', branch.id);
      const cashierCookies = await loginAndGetCookies(
        cashier.user.email,
        cashier.password,
      );
      await request(app.getHttpServer())
        .get('/api/v1/sales')
        .set('Cookie', cashierCookies)
        .expect(200);

      const manager = await seedUser(UserRole.MANAGER, 'm@t.com', branch.id);
      const managerCookies = await loginAndGetCookies(
        manager.user.email,
        manager.password,
      );
      await request(app.getHttpServer())
        .get('/api/v1/sales')
        .set('Cookie', managerCookies)
        .expect(200);
    });
  });

  describe('GET /api/v1/sales/:id', () => {
    it('returns a sale with nested branch and cashier', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
        notes: 'Test note',
      });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/sales/${sale.id}`)
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body).toMatchObject({
        id: sale.id,
        notes: 'Test note',
        status: SaleStatus.DRAFT,
      });
      expect(response.body.branch).toMatchObject({ id: branch.id });
      expect(response.body.cashier).toMatchObject({ id: user.id });
    });

    it('returns 404 for a non-existent sale', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const fakeId = '00000000-0000-0000-0000-000000000000';

      await request(app.getHttpServer())
        .get(`/api/v1/sales/${fakeId}`)
        .set('Cookie', cookies)
        .expect(404);
    });

    it('returns 400 for a malformed UUID', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .get('/api/v1/sales/not-a-uuid')
        .set('Cookie', cookies)
        .expect(400);
    });
  });

  describe('PATCH /api/v1/sales/:id', () => {
    it('updates notes on a DRAFT sale', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/sales/${sale.id}`)
        .set('Cookie', cookies)
        .send({ notes: 'Updated notes' })
        .expect(200);

      expect(response.body.notes).toBe('Updated notes');
    });

    it('clears notes when empty string is sent', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
        notes: 'Old notes',
      });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/sales/${sale.id}`)
        .set('Cookie', cookies)
        .send({ notes: '' })
        .expect(200);

      expect(response.body.notes).toBeNull();
    });

    it('updates customer_id', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const cookies = await loginAndGetCookies(user.email, password);
      const customerId = '33333333-3333-4333-8333-333333333333';

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/sales/${sale.id}`)
        .set('Cookie', cookies)
        .send({ customer_id: customerId })
        .expect(200);

      expect(response.body.customer_id).toBe(customerId);
    });

    it('returns 400 when updating a COMPLETED sale', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
        status: SaleStatus.COMPLETED,
        sale_number: 'INV-20260825-0001',
        completed_at: new Date(),
      });
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .patch(`/api/v1/sales/${sale.id}`)
        .set('Cookie', cookies)
        .send({ notes: 'Cannot change' })
        .expect(400);
    });

    it('rejects sending branch_id (whitelist strips unknown fields)', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const cookies = await loginAndGetCookies(user.email, password);

      // ValidationPipe { forbidNonWhitelisted: true } rejects unknown fields
      await request(app.getHttpServer())
        .patch(`/api/v1/sales/${sale.id}`)
        .set('Cookie', cookies)
        .send({ branch_id: '99999999-9999-9999-9999-999999999999' })
        .expect(400);
    });

    it('returns 404 for a non-existent sale', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const fakeId = '00000000-0000-0000-0000-000000000000';

      await request(app.getHttpServer())
        .patch(`/api/v1/sales/${fakeId}`)
        .set('Cookie', cookies)
        .send({ notes: 'hi' })
        .expect(404);
    });
  });

  describe('DELETE /api/v1/sales/:id', () => {
    it('discards a DRAFT sale and returns 204', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .delete(`/api/v1/sales/${sale.id}`)
        .set('Cookie', cookies)
        .expect(204);

      // Verify it's actually gone
      const repo = dataSource.getRepository(Sale);
      const found = await repo.findOne({ where: { id: sale.id } });
      expect(found).toBeNull();
    });

    it('returns 400 when discarding a COMPLETED sale', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
        status: SaleStatus.COMPLETED,
        sale_number: 'INV-20260825-0001',
        completed_at: new Date(),
      });
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .delete(`/api/v1/sales/${sale.id}`)
        .set('Cookie', cookies)
        .expect(400);
    });

    it('returns 404 for a non-existent sale', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const fakeId = '00000000-0000-0000-0000-000000000000';

      await request(app.getHttpServer())
        .delete(`/api/v1/sales/${fakeId}`)
        .set('Cookie', cookies)
        .expect(404);
    });
  });

  describe('POST /api/v1/sales/:saleId/lines', () => {
    it('adds a line and returns the sale with recomputed totals', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const product = await seedProduct(branch.id, {
        selling_price: '100.00',
        buying_price: '80.00',
      });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({ product_id: product.id, quantity: 2 })
        .expect(201);

      // Response is the full sale, not just the line
      expect(response.body.id).toBe(sale.id);
      expect(response.body.subtotal).toBe('200.00');
      expect(response.body.discount_total).toBe('0.00');
      expect(response.body.total).toBe('200.00');
      expect(response.body.lines).toHaveLength(1);
      expect(response.body.lines[0]).toMatchObject({
        line_number: 1,
        product_id: product.id,
        product_sku_snapshot: product.sku,
        product_name_snapshot: product.name,
        unit_price: '100.00',
        cost_price_snapshot: '80.00',
        quantity: 2,
        discount_amount: '0.00',
        line_total: '200.00',
      });
    });

    it('adds a second line and assigns line_number 2', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const productA = await seedProduct(branch.id, {
        name: 'Product A',
        selling_price: '100.00',
      });
      const productB = await seedProduct(branch.id, {
        name: 'Product B',
        selling_price: '250.00',
      });
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({ product_id: productA.id, quantity: 1 })
        .expect(201);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({ product_id: productB.id, quantity: 2 })
        .expect(201);

      expect(response.body.lines).toHaveLength(2);
      // Lines ordered by line_number ASC
      expect(response.body.lines[0].line_number).toBe(1);
      expect(response.body.lines[1].line_number).toBe(2);
      expect(response.body.subtotal).toBe('600.00'); // 100 + 500
    });

    it('applies a PERCENT discount and recomputes totals', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const product = await seedProduct(branch.id, {
        selling_price: '100.00',
      });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({
          product_id: product.id,
          quantity: 3,
          discount_type: DiscountType.PERCENT,
          discount_value: 10,
        })
        .expect(201);

      // 10% of (100 * 3) = 30
      expect(response.body.subtotal).toBe('300.00');
      expect(response.body.discount_total).toBe('30.00');
      expect(response.body.total).toBe('270.00');
      expect(response.body.lines[0].discount_amount).toBe('30.00');
      expect(response.body.lines[0].line_total).toBe('270.00');
    });

    it('returns 400 when AMOUNT discount exceeds line subtotal', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const product = await seedProduct(branch.id, {
        selling_price: '100.00',
      });
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({
          product_id: product.id,
          quantity: 1,
          discount_type: DiscountType.AMOUNT,
          discount_value: 500,
        })
        .expect(400);
    });

    it('returns 400 when sale is COMPLETED', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
        status: SaleStatus.COMPLETED,
        sale_number: 'INV-20260825-0001',
        completed_at: new Date(),
      });
      const product = await seedProduct(branch.id);
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({ product_id: product.id, quantity: 1 })
        .expect(400);
    });

    it('returns 400 when product belongs to a different branch', async () => {
      const branchA = await seedBranch({ name: 'Branch A' });
      const branchB = await seedBranch({ name: 'Branch B' });
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branchA.id,
        cashier_id: user.id,
      });
      const productAtB = await seedProduct(branchB.id);
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({ product_id: productAtB.id, quantity: 1 })
        .expect(400);
    });

    it('returns 404 when sale does not exist', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const product = await seedProduct(branch.id);
      const cookies = await loginAndGetCookies(user.email, password);
      const fakeId = '00000000-0000-0000-0000-000000000000';

      await request(app.getHttpServer())
        .post(`/api/v1/sales/${fakeId}/lines`)
        .set('Cookie', cookies)
        .send({ product_id: product.id, quantity: 1 })
        .expect(404);
    });

    it('returns 401 when unauthenticated', async () => {
      const branch = await seedBranch();
      const { user } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const product = await seedProduct(branch.id);

      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .send({ product_id: product.id, quantity: 1 })
        .expect(401);
    });
  });

  describe('PATCH /api/v1/sales/:saleId/lines/:lineId', () => {
    it('updates quantity and recomputes totals', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const product = await seedProduct(branch.id, {
        selling_price: '100.00',
      });
      const cookies = await loginAndGetCookies(user.email, password);

      const created = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({ product_id: product.id, quantity: 2 })
        .expect(201);
      const lineId = created.body.lines[0].id;

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/sales/${sale.id}/lines/${lineId}`)
        .set('Cookie', cookies)
        .send({ quantity: 5 })
        .expect(200);

      expect(response.body.subtotal).toBe('500.00');
      expect(response.body.total).toBe('500.00');
      expect(response.body.lines[0].quantity).toBe(5);
      expect(response.body.lines[0].line_total).toBe('500.00');
    });

    it('clears a discount when both fields are null', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const product = await seedProduct(branch.id, {
        selling_price: '100.00',
      });
      const cookies = await loginAndGetCookies(user.email, password);

      const created = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({
          product_id: product.id,
          quantity: 2,
          discount_type: DiscountType.PERCENT,
          discount_value: 10,
        })
        .expect(201);
      const lineId = created.body.lines[0].id;

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/sales/${sale.id}/lines/${lineId}`)
        .set('Cookie', cookies)
        .send({ discount_type: null, discount_value: null })
        .expect(200);

      expect(response.body.lines[0].discount_type).toBeNull();
      expect(response.body.lines[0].discount_value).toBeNull();
      expect(response.body.lines[0].discount_amount).toBe('0.00');
      expect(response.body.discount_total).toBe('0.00');
    });

    it('returns 400 when only one discount field is sent', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const product = await seedProduct(branch.id);
      const cookies = await loginAndGetCookies(user.email, password);

      const created = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({ product_id: product.id, quantity: 1 })
        .expect(201);
      const lineId = created.body.lines[0].id;

      await request(app.getHttpServer())
        .patch(`/api/v1/sales/${sale.id}/lines/${lineId}`)
        .set('Cookie', cookies)
        .send({ discount_type: DiscountType.PERCENT })
        .expect(400);
    });

    it('returns 404 when line belongs to a different sale', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const saleA = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const saleB = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const product = await seedProduct(branch.id);
      const cookies = await loginAndGetCookies(user.email, password);

      const created = await request(app.getHttpServer())
        .post(`/api/v1/sales/${saleA.id}/lines`)
        .set('Cookie', cookies)
        .send({ product_id: product.id, quantity: 1 })
        .expect(201);
      const lineIdOnA = created.body.lines[0].id;

      // Try to update A's line via B's URL
      await request(app.getHttpServer())
        .patch(`/api/v1/sales/${saleB.id}/lines/${lineIdOnA}`)
        .set('Cookie', cookies)
        .send({ quantity: 5 })
        .expect(404);
    });
  });

  describe('DELETE /api/v1/sales/:saleId/lines/:lineId', () => {
    it('removes a line and returns 204; sale totals recomputed', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const product = await seedProduct(branch.id, {
        selling_price: '100.00',
      });
      const cookies = await loginAndGetCookies(user.email, password);

      const created = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({ product_id: product.id, quantity: 2 })
        .expect(201);
      const lineId = created.body.lines[0].id;

      await request(app.getHttpServer())
        .delete(`/api/v1/sales/${sale.id}/lines/${lineId}`)
        .set('Cookie', cookies)
        .expect(204);

      // Line actually gone
      const lineRepo = dataSource.getRepository(SaleLine);
      const found = await lineRepo.findOne({ where: { id: lineId } });
      expect(found).toBeNull();

      // Sale totals reset to zero
      const refreshed = await request(app.getHttpServer())
        .get(`/api/v1/sales/${sale.id}`)
        .set('Cookie', cookies)
        .expect(200);
      expect(refreshed.body.subtotal).toBe('0.00');
      expect(refreshed.body.total).toBe('0.00');
      expect(refreshed.body.lines).toHaveLength(0);
    });

    it('preserves line_number gaps after remove (does not renumber)', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const productA = await seedProduct(branch.id, { name: 'A' });
      const productB = await seedProduct(branch.id, { name: 'B' });
      const productC = await seedProduct(branch.id, { name: 'C' });
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({ product_id: productA.id, quantity: 1 })
        .expect(201);
      const lineB = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({ product_id: productB.id, quantity: 1 })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({ product_id: productC.id, quantity: 1 })
        .expect(201);

      // Remove line B (line_number 2)
      const lineBId = lineB.body.lines[1].id;
      await request(app.getHttpServer())
        .delete(`/api/v1/sales/${sale.id}/lines/${lineBId}`)
        .set('Cookie', cookies)
        .expect(204);

      // Line C still has line_number 3 (not renumbered to 2)
      const refreshed = await request(app.getHttpServer())
        .get(`/api/v1/sales/${sale.id}`)
        .set('Cookie', cookies)
        .expect(200);
      expect(refreshed.body.lines).toHaveLength(2);
      expect(refreshed.body.lines[0].line_number).toBe(1);
      expect(refreshed.body.lines[1].line_number).toBe(3);
    });

    it('returns 400 when sale is COMPLETED', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const product = await seedProduct(branch.id);
      const cookies = await loginAndGetCookies(user.email, password);

      const created = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({ product_id: product.id, quantity: 1 })
        .expect(201);
      const lineId = created.body.lines[0].id;

      // Manually flip the sale to COMPLETED (bypassing the not-yet-built endpoint)
      await dataSource.getRepository(Sale).update(sale.id, {
        status: SaleStatus.COMPLETED,
        sale_number: 'INV-20260825-0001',
        completed_at: new Date(),
      });

      await request(app.getHttpServer())
        .delete(`/api/v1/sales/${sale.id}/lines/${lineId}`)
        .set('Cookie', cookies)
        .expect(400);
    });
  });
});
