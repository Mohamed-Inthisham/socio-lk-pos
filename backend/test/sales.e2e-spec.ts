import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { DataSource, In } from 'typeorm';
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
import { WarrantyPeriod } from '../src/products/enums/warranty-period.enum';
import { DateTime } from 'luxon';
import { SkuBarcodeCounter } from '../src/sku-barcode-counters/entities/sku-barcode-counter.entity';
import { Supplier } from '../src/suppliers/entities/supplier.entity';
import { SaleLine } from '../src/sales/entities/sale-line.entity';
import { DiscountType } from '../src/sales/enums/discount-type.enum';
import { Payment } from '../src/sales/entities/payment.entity';
import { PaymentMethod } from '../src/sales/enums/payment-method.enum';
import { Stock } from '../src/stock/entities/stock.entity';
import { Customer } from '../src/customers/entities/customer.entity';
import { ProductUnit } from '../src/product-units/entities/product-unit.entity';
import { ProductUnitStatus } from '../src/product-units/enums/product-unit-status.enum';
import { PhonePurchase } from '../src/phone-purchases/entities/phone-purchase.entity';

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

  // A trade-in needs the customer's NIC (P4-13), so seeded customers
  // have one by default; NICs are unique when set.
  let nicSeq = 0;
  async function seedCustomer(
    overrides: Partial<Customer> = {},
  ): Promise<Customer> {
    const repo = dataSource.getRepository(Customer);
    return repo.save(
      repo.create({
        name: 'Kamal Perera',
        phone: '0771234567',
        nic: `19900000${String(++nicSeq).padStart(4, '0')}`,
        notes: null,
        ...overrides,
      }),
    );
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
      is_serialized?: boolean;
      default_warranty?: WarrantyPeriod;
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
        is_serialized: overrides.is_serialized ?? false,
        default_warranty:
          overrides.default_warranty ?? WarrantyPeriod.NO_WARRANTY,
      }),
    );
  }

  /**
   * Seed or overwrite a stock row for a (product, branch). Products are
   * auto-created with quantity=0 stock rows at product-creation time
   * (Phase 6.1 hook), so this helper UPDATEs rather than INSERTs.
   * Used to give test sales enough stock to complete against.
   */
  async function setStockQuantity(
    productId: string,
    branchId: string,
    quantity: number,
    manageStock = true,
  ): Promise<void> {
    const repo = dataSource.getRepository(Stock);
    const existing = await repo.findOne({
      where: { product_id: productId, branch_id: branchId },
    });
    if (existing) {
      await repo.update(existing.id, { quantity, manage_stock: manageStock });
    } else {
      await repo.save(
        repo.create({
          product_id: productId,
          branch_id: branchId,
          quantity,
          min_quantity: 0,
          manage_stock: manageStock,
        }),
      );
    }
  }

  /**
   * Seed a PhonePurchase parent row for a ProductUnit. Slice D's schema
   * requires customer_id, branch_id, cashier_id, total_amount — all
   * NOT NULL. Used only by seedProductUnit; not directly by tests.
   */
  async function seedPhonePurchase(
    branchId: string,
    cashierId: string,
    customerId: string,
    totalAmount = '100000.00',
  ): Promise<PhonePurchase> {
    const repo = dataSource.getRepository(PhonePurchase);
    return repo.save(
      repo.create({
        customer_id: customerId,
        branch_id: branchId,
        cashier_id: cashierId,
        total_amount: totalAmount,
        notes: null,
      }),
    );
  }

  /**
   * Seed a ProductUnit row against an existing serialized product.
   * Requires a PhonePurchase parent (Slice D FK), so this helper also
   * lazily seeds a Customer + PhonePurchase for the unit.
   *
   * `imei` should be unique across a test — the global unique index on
   * product_units.imei will otherwise reject the insert.
   *
   * `status` defaults to IN_STOCK. Tests exercising cross-DRAFT races or
   * error paths override with SOLD / RETURNED / WRITTEN_OFF.
   *
   * `selling_price` defaults to null (per Slice D's "price-later"
   * Cashier Option C) so tests can distinguish the PU→Product fallback
   * path from the PU-price-used path by passing an explicit value.
   */

  async function seedProductUnit(
    productId: string,
    branchId: string,
    cashierId: string,
    imei: string,
    overrides: {
      status?: ProductUnitStatus;
      buying_price?: string;
      selling_price?: string | null;
      customerId?: string;
    } = {},
  ): Promise<ProductUnit> {
    // Lazily seed a customer + phone-purchase for FK integrity
    const customerId =
      overrides.customerId ??
      (
        await seedCustomer({
          name: `PU seed customer ${imei.slice(-4)}`,
          phone: `077${imei.slice(-7)}`,
        })
      ).id;
    const phonePurchase = await seedPhonePurchase(
      branchId,
      cashierId,
      customerId,
      overrides.buying_price ?? '80000.00',
    );

    const repo = dataSource.getRepository(ProductUnit);
    return repo.save(
      repo.create({
        product_id: productId,
        branch_id: branchId,
        imei,
        status: overrides.status ?? ProductUnitStatus.IN_STOCK,
        buying_price: overrides.buying_price ?? '80000.00',
        selling_price:
          overrides.selling_price === undefined
            ? null
            : overrides.selling_price,
        phone_purchase_id: phonePurchase.id,
      }),
    );
  }

  async function loginAndGetCookies(
    email: string,
    password: string,
  ): Promise<string[]> {
    await new Promise((r) => setTimeout(r, 500));
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
      const customer = await seedCustomer();
      const { user, password } = await seedUser(
        UserRole.CASHIER,
        'c@t.com',
        branch.id,
      );
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .post('/api/v1/sales')
        .set('Cookie', cookies)
        .send({
          branch_id: branch.id,
          customer_id: customer.id,
          notes: '  SMS receipt  ',
        })
        .expect(201);

      expect(response.body.customer_id).toBe(customer.id);
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

    // ---- customer_id validation (Phase 6.3.5 Slice B) ----

    it('returns 400 when customer_id refers to a nonexistent customer', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(
        UserRole.CASHIER,
        'c@t.com',
        branch.id,
      );
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post('/api/v1/sales')
        .set('Cookie', cookies)
        .send({
          branch_id: branch.id,
          customer_id: '00000000-0000-4000-8000-000000000000',
        })
        .expect(400);
    });

    it('returns 400 when customer_id refers to a soft-deleted customer', async () => {
      const branch = await seedBranch();
      const customer = await seedCustomer();
      await dataSource.getRepository(Customer).softRemove(customer);
      const { user, password } = await seedUser(
        UserRole.CASHIER,
        'c@t.com',
        branch.id,
      );
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post('/api/v1/sales')
        .set('Cookie', cookies)
        .send({
          branch_id: branch.id,
          customer_id: customer.id,
        })
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

    // ---- Phase 6.4 P6: recent sales at the till (P6-2, P6-3, P6-5) ----

    describe('recent sales (completed bounds, sort, customer, q)', () => {
      let saleSeq = 0;
      /** A COMPLETED sale with a unique sale number, completed at `at`. */
      function seedCompleted(
        branchId: string,
        cashierId: string,
        at: string,
        overrides: Partial<Sale> = {},
      ) {
        saleSeq += 1;
        return seedSale({
          branch_id: branchId,
          cashier_id: cashierId,
          status: SaleStatus.COMPLETED,
          sale_number: `INV-20261021-${String(saleSeq).padStart(4, '0')}`,
          completed_at: new Date(at),
          ...overrides,
        });
      }

      /** A line carrying an IMEI (no unit needed for a list search). */
      async function seedImeiLine(
        saleId: string,
        productId: string,
        lineNumber: number,
        imei: string,
      ) {
        const repo = dataSource.getRepository(SaleLine);
        return repo.save(
          repo.create({
            sale_id: saleId,
            line_number: lineNumber,
            product_id: productId,
            product_sku_snapshot: 'SKU-TEST',
            product_name_snapshot: 'Test Phone',
            unit_price: '100000.00',
            cost_price_snapshot: '80000.00',
            quantity: 1,
            discount_amount: '0',
            line_total: '100000.00',
            imei_snapshot: imei,
            warranty: WarrantyPeriod.NO_WARRANTY,
          }),
        );
      }

      function list(cookies: string[], qs: string) {
        return request(app.getHttpServer())
          .get(`/api/v1/sales?${qs}`)
          .set('Cookie', cookies);
      }

      // One Colombo day, sent as the POS sends it ("+" encoded).
      const DAY =
        'completedFrom=2026-10-21T00:00:00%2B05:30' +
        '&completedTo=2026-10-22T00:00:00%2B05:30';

      it('completedFrom/To bound one Colombo day, leave drafts out, and sort=completed_at is newest first', async () => {
        const branch = await seedBranch();
        const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
        // 00:30 Colombo on the 21st is 19:00 UTC on the 20th: in the day.
        const early = await seedCompleted(
          branch.id,
          user.id,
          '2026-10-21T00:30:00+05:30',
        );
        const late = await seedCompleted(
          branch.id,
          user.id,
          '2026-10-21T23:59:00+05:30',
        );
        // Out: the minute before, and the exclusive end.
        await seedCompleted(branch.id, user.id, '2026-10-20T23:59:00+05:30');
        await seedCompleted(branch.id, user.id, '2026-10-22T00:00:00+05:30');
        await seedSale({ branch_id: branch.id, cashier_id: user.id });
        const cookies = await loginAndGetCookies(user.email, password);

        const response = await list(
          cookies,
          `branchId=${branch.id}&${DAY}&sort=completed_at`,
        ).expect(200);

        expect((response.body.data as Sale[]).map((s) => s.id)).toEqual([
          late.id,
          early.id,
        ]);
        expect(response.body.meta.total).toBe(2);
      });

      it('returns 400 for a date-only or offset-less completedFrom/To', async () => {
        const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
        const cookies = await loginAndGetCookies(user.email, password);

        for (const qs of [
          'completedFrom=2026-10-21',
          'completedTo=2026-10-22',
          'completedFrom=2026-10-21T00:00:00',
          // An unencoded "+" arrives as a space.
          'completedFrom=2026-10-21T00:00:00+05:30',
        ]) {
          const response = await list(cookies, qs).expect(400);
          expect(JSON.stringify(response.body.message)).toMatch(
            /timestamp with a time and an offset/,
          );
        }
      });

      it('sort=completed_at without bounds puts drafts last', async () => {
        const branch = await seedBranch();
        const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
        const draft = await seedSale({
          branch_id: branch.id,
          cashier_id: user.id,
        });
        const completed = await seedCompleted(
          branch.id,
          user.id,
          '2026-10-21T10:00:00+05:30',
        );
        const cookies = await loginAndGetCookies(user.email, password);

        const response = await list(cookies, 'sort=completed_at').expect(200);

        expect((response.body.data as Sale[]).map((s) => s.id)).toEqual([
          completed.id,
          draft.id,
        ]);
      });

      it('returns 400 for an unknown sort', async () => {
        const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
        const cookies = await loginAndGetCookies(user.email, password);

        await list(cookies, 'sort=total').expect(400);
      });

      it('includes the customer on each row (null for a walk-in)', async () => {
        const branch = await seedBranch();
        const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
        const customer = await seedCustomer({ name: 'Nimal Silva' });
        const withCustomer = await seedCompleted(
          branch.id,
          user.id,
          '2026-10-21T10:00:00+05:30',
          { customer_id: customer.id },
        );
        await seedCompleted(branch.id, user.id, '2026-10-21T09:00:00+05:30');
        const cookies = await loginAndGetCookies(user.email, password);

        const response = await list(cookies, `${DAY}&sort=completed_at`).expect(
          200,
        );

        expect(response.body.data[0].id).toBe(withCustomer.id);
        expect(response.body.data[0].customer).toMatchObject({
          id: customer.id,
          name: 'Nimal Silva',
        });
        expect(response.body.data[1].customer).toBeNull();
      });

      it('still names a soft-deleted cashier and customer on the row', async () => {
        const branch = await seedBranch();
        const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
        const { user: cashier } = await seedUser(
          UserRole.CASHIER,
          'gone@t.com',
          branch.id,
        );
        const customer = await seedCustomer({ name: 'Former Customer' });
        await seedCompleted(
          branch.id,
          cashier.id,
          '2026-10-21T10:00:00+05:30',
          {
            customer_id: customer.id,
          },
        );
        await dataSource.getRepository(User).softDelete(cashier.id);
        await dataSource.getRepository(Customer).softDelete(customer.id);
        const cookies = await loginAndGetCookies(user.email, password);

        const response = await list(cookies, DAY).expect(200);

        expect(response.body.data).toHaveLength(1);
        expect(response.body.data[0].cashier).toMatchObject({
          id: cashier.id,
          full_name: cashier.full_name,
        });
        expect(response.body.data[0].cashier.deleted_at).not.toBeNull();
        expect(response.body.data[0].customer).toMatchObject({
          id: customer.id,
          name: 'Former Customer',
        });
        expect(response.body.data[0].customer.deleted_at).not.toBeNull();
      });

      it('q matches the sale number by substring', async () => {
        const branch = await seedBranch();
        const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
        const target = await seedCompleted(
          branch.id,
          user.id,
          '2026-10-21T10:00:00+05:30',
          { sale_number: 'INV-20261021-0042' },
        );
        await seedCompleted(branch.id, user.id, '2026-10-21T11:00:00+05:30', {
          sale_number: 'INV-20261021-0043',
        });
        const cookies = await loginAndGetCookies(user.email, password);

        const response = await list(cookies, 'q=0042').expect(200);

        expect((response.body.data as Sale[]).map((s) => s.id)).toEqual([
          target.id,
        ]);
      });

      it('q matches the customer name case-insensitively and the phone by substring', async () => {
        const branch = await seedBranch();
        const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
        const kamal = await seedCustomer({
          name: 'Kamal Perera',
          phone: '0771234567',
        });
        const nimal = await seedCustomer({
          name: 'Nimal Silva',
          phone: '0719876543',
        });
        const kamalSale = await seedCompleted(
          branch.id,
          user.id,
          '2026-10-21T10:00:00+05:30',
          { customer_id: kamal.id },
        );
        const nimalSale = await seedCompleted(
          branch.id,
          user.id,
          '2026-10-21T11:00:00+05:30',
          { customer_id: nimal.id },
        );
        const cookies = await loginAndGetCookies(user.email, password);

        const byName = await list(cookies, 'q=kAmAl').expect(200);
        expect((byName.body.data as Sale[]).map((s) => s.id)).toEqual([
          kamalSale.id,
        ]);

        const byPhone = await list(cookies, 'q=9876543').expect(200);
        expect((byPhone.body.data as Sale[]).map((s) => s.id)).toEqual([
          nimalSale.id,
        ]);
      });

      it('q escapes LIKE wildcards', async () => {
        const branch = await seedBranch();
        const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
        const customer = await seedCustomer({ name: 'Kamal Perera' });
        await seedCompleted(branch.id, user.id, '2026-10-21T10:00:00+05:30', {
          customer_id: customer.id,
        });
        const cookies = await loginAndGetCookies(user.email, password);

        // Unescaped, "%%" and "__" would match every name.
        for (const q of ['%25%25', '__']) {
          const response = await list(cookies, `q=${q}`).expect(200);
          expect(response.body.data).toHaveLength(0);
        }
      });

      it('q matches an exact IMEI on a line: a sale with two phone lines appears once and the total is right', async () => {
        const branch = await seedBranch();
        const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
        const product = await seedProduct(branch.id, { is_serialized: true });
        const twoPhones = await seedCompleted(
          branch.id,
          user.id,
          '2026-10-21T10:00:00+05:30',
        );
        await seedImeiLine(twoPhones.id, product.id, 1, '350000000000101');
        await seedImeiLine(twoPhones.id, product.id, 2, '350000000000102');
        const other = await seedCompleted(
          branch.id,
          user.id,
          '2026-10-21T11:00:00+05:30',
        );
        await seedImeiLine(other.id, product.id, 1, '350000000000201');
        const cookies = await loginAndGetCookies(user.email, password);

        const response = await list(cookies, 'q=350000000000102').expect(200);

        expect((response.body.data as Sale[]).map((s) => s.id)).toEqual([
          twoPhones.id,
        ]);
        expect(response.body.meta.total).toBe(1);

        // Exact, not substring: the shared prefix matches nothing.
        const partial = await list(cookies, 'q=3500000000001').expect(200);
        expect(partial.body.data).toHaveLength(0);
      });

      it('q matches an exact trade-in IMEI on a payment', async () => {
        const branch = await seedBranch();
        const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
        const used = await seedProduct(branch.id, {
          name: 'Used iPhone 12',
          is_serialized: true,
        });
        const sale = await seedSale({
          branch_id: branch.id,
          cashier_id: user.id,
        });
        const paymentRepo = dataSource.getRepository(Payment);
        await paymentRepo.save(
          paymentRepo.create({
            sale_id: sale.id,
            payment_method: PaymentMethod.TRADE_IN,
            amount: '60000.00',
            trade_in_product_id: used.id,
            trade_in_imei: '490154203237518',
            trade_in_buying_price: '60000.00',
          }),
        );
        await seedSale({ branch_id: branch.id, cashier_id: user.id });
        const cookies = await loginAndGetCookies(user.email, password);

        const response = await list(cookies, 'q=490154203237518').expect(200);

        expect((response.body.data as Sale[]).map((s) => s.id)).toEqual([
          sale.id,
        ]);
      });

      it('returns 400 for a one-character q, and ignores a blank one', async () => {
        const branch = await seedBranch();
        const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
        await seedSale({ branch_id: branch.id, cashier_id: user.id });
        const cookies = await loginAndGetCookies(user.email, password);

        await list(cookies, 'q=4').expect(400);
        const blank = await list(cookies, 'q=%20%20').expect(200);
        expect(blank.body.data).toHaveLength(1);
      });
    });
  });

  describe('GET /api/v1/sales/:id', () => {
    it('returns the voider on a VOIDED sale (P6-6)', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const { user: manager } = await seedUser(
        UserRole.MANAGER,
        'm@t.com',
        branch.id,
      );
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
        status: SaleStatus.VOIDED,
        sale_number: 'INV-20261021-0001',
        completed_at: new Date('2026-10-21T10:00:00+05:30'),
        voided_at: new Date('2026-10-21T11:00:00+05:30'),
        voided_by: manager.id,
        void_reason: 'Wrong price',
      });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/sales/${sale.id}`)
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.voider).toMatchObject({
        id: manager.id,
        full_name: manager.full_name,
      });
      expect(response.body.voider).not.toHaveProperty('password_hash');
    });

    it('returns voider null on a sale that was never voided', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/sales/${sale.id}`)
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.voider).toBeNull();
    });

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
      expect(response.body.customer).toBeNull();
    });

    it('returns the nested customer when the sale has one', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const customer = await seedCustomer();
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
        customer_id: customer.id,
      });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/sales/${sale.id}`)
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.customer_id).toBe(customer.id);
      expect(response.body.customer).toMatchObject({
        id: customer.id,
        name: 'Kamal Perera',
        phone: '0771234567',
      });
    });

    it('still returns the customer after the customer is soft-deleted', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const customer = await seedCustomer();
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
        customer_id: customer.id,
      });
      await dataSource.getRepository(Customer).softDelete(customer.id);
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/sales/${sale.id}`)
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.customer).toMatchObject({ id: customer.id });
      expect(response.body.customer.deleted_at).not.toBeNull();
    });

    it('includes the customer in mutation responses that return the sale', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const customer = await seedCustomer();
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
        customer_id: customer.id,
        total: '500.00',
      });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/payments`)
        .set('Cookie', cookies)
        .send({
          payment_method: PaymentMethod.CASH,
          amount: 500,
          cash_received: 500,
        })
        .expect(201);

      expect(response.body.customer).toMatchObject({ id: customer.id });
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
      const customer = await seedCustomer();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/sales/${sale.id}`)
        .set('Cookie', cookies)
        .send({ customer_id: customer.id })
        .expect(200);

      expect(response.body.customer_id).toBe(customer.id);
      expect(response.body.customer).toMatchObject({ id: customer.id });
      // Persisted, not just echoed
      const saved = await dataSource
        .getRepository(Sale)
        .findOne({ where: { id: sale.id } });
      expect(saved?.customer_id).toBe(customer.id);
    });

    it('replaces an existing customer_id with a different customer', async () => {
      const branch = await seedBranch();
      const first = await seedCustomer();
      const second = await seedCustomer({
        name: 'Nimal Silva',
        phone: '0779876543',
      });
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
        customer_id: first.id,
      });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/sales/${sale.id}`)
        .set('Cookie', cookies)
        .send({ customer_id: second.id })
        .expect(200);

      expect(response.body.customer).toMatchObject({ id: second.id });
      const saved = await dataSource
        .getRepository(Sale)
        .findOne({ where: { id: sale.id } });
      expect(saved?.customer_id).toBe(second.id);
    });

    // ---- customer_id validation (Phase 6.3.5 Slice B) ----

    it('returns 400 when customer_id refers to a nonexistent customer', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .patch(`/api/v1/sales/${sale.id}`)
        .set('Cookie', cookies)
        .send({ customer_id: '00000000-0000-4000-8000-000000000000' })
        .expect(400);
    });

    it('returns 400 when customer_id refers to a soft-deleted customer', async () => {
      const branch = await seedBranch();
      const customer = await seedCustomer();
      await dataSource.getRepository(Customer).softRemove(customer);
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .patch(`/api/v1/sales/${sale.id}`)
        .set('Cookie', cookies)
        .send({ customer_id: customer.id })
        .expect(400);
    });

    it('allows clearing customer_id (null) without a valid reference', async () => {
      const branch = await seedBranch();
      const customer = await seedCustomer();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
        customer_id: customer.id,
      });
      // Soft-delete the customer AFTER assigning — should still allow null clear
      await dataSource.getRepository(Customer).softRemove(customer);
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/sales/${sale.id}`)
        .set('Cookie', cookies)
        .send({ customer_id: null })
        .expect(200);

      expect(response.body.customer_id).toBeNull();
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

    it('sets a UNIT_PRICE discount that follows qty changes, and rejects a price above the unit price (P5-20)', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const product = await seedProduct(branch.id, {
        selling_price: '200.00',
      });
      const cookies = await loginAndGetCookies(user.email, password);

      const created = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({ product_id: product.id, quantity: 1 })
        .expect(201);
      const lineId = created.body.lines[0].id;

      const priced = await request(app.getHttpServer())
        .patch(`/api/v1/sales/${sale.id}/lines/${lineId}`)
        .set('Cookie', cookies)
        .send({ discount_type: DiscountType.UNIT_PRICE, discount_value: 160 })
        .expect(200);
      expect(priced.body.lines[0]).toMatchObject({
        discount_type: DiscountType.UNIT_PRICE,
        discount_value: '160.00',
        discount_amount: '40.00',
        line_total: '160.00',
      });

      const more = await request(app.getHttpServer())
        .patch(`/api/v1/sales/${sale.id}/lines/${lineId}`)
        .set('Cookie', cookies)
        .send({ quantity: 3 })
        .expect(200);
      expect(more.body.lines[0]).toMatchObject({
        discount_value: '160.00',
        discount_amount: '120.00',
        line_total: '480.00',
      });
      expect(more.body.discount_total).toBe('120.00');
      expect(more.body.total).toBe('480.00');

      const above = await request(app.getHttpServer())
        .patch(`/api/v1/sales/${sale.id}/lines/${lineId}`)
        .set('Cookie', cookies)
        .send({
          discount_type: DiscountType.UNIT_PRICE,
          discount_value: 200.01,
        })
        .expect(400);
      expect(above.body.message).toBe(
        'Price each 200.01 must be between 0.00 and the unit price 200.00',
      );
    });

    it('rounds an exact half-cent PERCENT discount up (F3: 50% of 4.35)', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const product = await seedProduct(branch.id, { selling_price: '4.35' });
      const cookies = await loginAndGetCookies(user.email, password);

      const created = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({
          product_id: product.id,
          quantity: 1,
          discount_type: DiscountType.PERCENT,
          discount_value: 50,
        })
        .expect(201);

      expect(created.body.lines[0]).toMatchObject({
        discount_amount: '2.18',
        line_total: '2.17',
      });
    });

    it('adds a line with a UNIT_PRICE discount (P5-20)', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const product = await seedProduct(branch.id, {
        selling_price: '200.00',
      });
      const cookies = await loginAndGetCookies(user.email, password);

      const created = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({
          product_id: product.id,
          quantity: 1,
          discount_type: DiscountType.UNIT_PRICE,
          discount_value: 160,
        })
        .expect(201);

      expect(created.body.lines[0]).toMatchObject({
        discount_type: DiscountType.UNIT_PRICE,
        discount_value: '160.00',
        discount_amount: '40.00',
        line_total: '160.00',
      });
      expect(created.body.total).toBe('160.00');
    });

    it.each([
      ['equal to the unit price takes nothing off', 200, '0.00', '200.00'],
      ['0 makes the line free', 0, '200.00', '0.00'],
    ])(
      'UNIT_PRICE %s (P5-20)',
      async (_, priceEach, discountAmount, lineTotal) => {
        const branch = await seedBranch();
        const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
        const sale = await seedSale({
          branch_id: branch.id,
          cashier_id: user.id,
        });
        const product = await seedProduct(branch.id, {
          selling_price: '200.00',
        });
        const cookies = await loginAndGetCookies(user.email, password);

        const created = await request(app.getHttpServer())
          .post(`/api/v1/sales/${sale.id}/lines`)
          .set('Cookie', cookies)
          .send({ product_id: product.id, quantity: 1 })
          .expect(201);
        const lineId = created.body.lines[0].id;

        const response = await request(app.getHttpServer())
          .patch(`/api/v1/sales/${sale.id}/lines/${lineId}`)
          .set('Cookie', cookies)
          .send({
            discount_type: DiscountType.UNIT_PRICE,
            discount_value: priceEach,
          })
          .expect(200);

        expect(response.body.lines[0]).toMatchObject({
          discount_amount: discountAmount,
          line_total: lineTotal,
        });
        expect(response.body.total).toBe(lineTotal);
      },
    );

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
  describe('POST /api/v1/sales/:saleId/payments', () => {
    it('records a CASH payment and returns the sale with recomputed totals', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
        total: '500.00',
      });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/payments`)
        .set('Cookie', cookies)
        .send({
          payment_method: PaymentMethod.CASH,
          amount: 500,
          cash_received: 500,
        })
        .expect(201);

      // Response is the full sale, not just the payment
      expect(response.body.id).toBe(sale.id);
      expect(response.body.amount_paid).toBe('500.00');
      expect(response.body.change_due).toBe('0.00');
      expect(response.body.payments).toHaveLength(1);
      expect(response.body.payments[0]).toMatchObject({
        payment_method: PaymentMethod.CASH,
        amount: '500.00',
        cash_received: '500.00',
        reference_number: null,
      });
    });

    it('records CASH overpayment as change_due', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
        total: '950.00',
      });
      const cookies = await loginAndGetCookies(user.email, password);

      // Customer hands over Rs. 1000 for a Rs. 950 sale → Rs. 50 change
      const response = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/payments`)
        .set('Cookie', cookies)
        .send({
          payment_method: PaymentMethod.CASH,
          amount: 950,
          cash_received: 1000,
        })
        .expect(201);

      expect(response.body.amount_paid).toBe('950.00');
      expect(response.body.change_due).toBe('50.00');
    });

    it('records a CARD payment with reference_number', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
        total: '1000.00',
      });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/payments`)
        .set('Cookie', cookies)
        .send({
          payment_method: PaymentMethod.CARD,
          amount: 1000,
          reference_number: 'AUTH-482913',
        })
        .expect(201);

      expect(response.body.payments[0]).toMatchObject({
        payment_method: PaymentMethod.CARD,
        amount: '1000.00',
        cash_received: null,
        reference_number: 'AUTH-482913',
      });
    });

    it('supports multi-tender: split CARD + CASH', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
        total: '950.00',
      });
      const cookies = await loginAndGetCookies(user.email, password);

      // Payment 1: Rs. 400 on CARD
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/payments`)
        .set('Cookie', cookies)
        .send({
          payment_method: PaymentMethod.CARD,
          amount: 400,
          reference_number: 'AUTH-1',
        })
        .expect(201);

      // Payment 2: Rs. 550 cash + Rs. 50 change (customer paid Rs. 600)
      const response = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/payments`)
        .set('Cookie', cookies)
        .send({
          payment_method: PaymentMethod.CASH,
          amount: 550,
          cash_received: 600,
        })
        .expect(201);

      expect(response.body.payments).toHaveLength(2);
      expect(response.body.amount_paid).toBe('950.00');
      expect(response.body.change_due).toBe('50.00');
      // Payments ordered by created_at ASC
      expect(response.body.payments[0].payment_method).toBe(PaymentMethod.CARD);
      expect(response.body.payments[1].payment_method).toBe(PaymentMethod.CASH);
    });

    it('records a KOKO payment with reference_number', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
        total: '2500.00',
      });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/payments`)
        .set('Cookie', cookies)
        .send({
          payment_method: PaymentMethod.KOKO,
          amount: 2500,
          reference_number: 'KOKO-TXN-XYZ',
        })
        .expect(201);

      expect(response.body.payments[0].payment_method).toBe(PaymentMethod.KOKO);
      expect(response.body.payments[0].reference_number).toBe('KOKO-TXN-XYZ');
    });

    it('returns 400 when amount exceeds remaining balance', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
        total: '500.00',
      });
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/payments`)
        .set('Cookie', cookies)
        .send({
          payment_method: PaymentMethod.CASH,
          amount: 600,
          cash_received: 600,
        })
        .expect(400);
    });

    it('returns 400 when CASH cash_received is missing', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
        total: '500.00',
      });
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/payments`)
        .set('Cookie', cookies)
        .send({
          payment_method: PaymentMethod.CASH,
          amount: 500,
        })
        .expect(400);
    });

    it('returns 400 when non-CASH has no reference_number', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
        total: '500.00',
      });
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/payments`)
        .set('Cookie', cookies)
        .send({
          payment_method: PaymentMethod.CARD,
          amount: 500,
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
        total: '500.00',
      });
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/payments`)
        .set('Cookie', cookies)
        .send({
          payment_method: PaymentMethod.CASH,
          amount: 500,
          cash_received: 500,
        })
        .expect(400);
    });

    it('returns 401 when unauthenticated', async () => {
      const branch = await seedBranch();
      const { user } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
        total: '500.00',
      });

      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/payments`)
        .send({
          payment_method: PaymentMethod.CASH,
          amount: 500,
          cash_received: 500,
        })
        .expect(401);
    });
  });

  describe('PATCH /api/v1/sales/:saleId/payments/:paymentId', () => {
    it('updates amount and recomputes totals', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
        total: '1000.00',
      });
      const cookies = await loginAndGetCookies(user.email, password);

      const created = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/payments`)
        .set('Cookie', cookies)
        .send({
          payment_method: PaymentMethod.CASH,
          amount: 500,
          cash_received: 500,
        })
        .expect(201);
      const paymentId = created.body.payments[0].id;

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/sales/${sale.id}/payments/${paymentId}`)
        .set('Cookie', cookies)
        .send({ amount: 800, cash_received: 800 })
        .expect(200);

      expect(response.body.amount_paid).toBe('800.00');
      expect(response.body.payments[0].amount).toBe('800.00');
    });

    it('updates cash_received on a CASH payment (miscount correction)', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
        total: '500.00',
      });
      const cookies = await loginAndGetCookies(user.email, password);

      const created = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/payments`)
        .set('Cookie', cookies)
        .send({
          payment_method: PaymentMethod.CASH,
          amount: 500,
          cash_received: 1000,
        })
        .expect(201);
      const paymentId = created.body.payments[0].id;

      // Cashier realizes customer gave Rs. 700, not Rs. 1000
      const response = await request(app.getHttpServer())
        .patch(`/api/v1/sales/${sale.id}/payments/${paymentId}`)
        .set('Cookie', cookies)
        .send({ cash_received: 700 })
        .expect(200);

      expect(response.body.change_due).toBe('200.00');
      expect(response.body.payments[0].cash_received).toBe('700.00');
    });

    it('returns 400 when clearing reference_number on a CARD payment', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
        total: '500.00',
      });
      const cookies = await loginAndGetCookies(user.email, password);

      const created = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/payments`)
        .set('Cookie', cookies)
        .send({
          payment_method: PaymentMethod.CARD,
          amount: 500,
          reference_number: 'AUTH-1',
        })
        .expect(201);
      const paymentId = created.body.payments[0].id;

      await request(app.getHttpServer())
        .patch(`/api/v1/sales/${sale.id}/payments/${paymentId}`)
        .set('Cookie', cookies)
        .send({ reference_number: null })
        .expect(400);
    });

    it('returns 404 when payment belongs to a different sale', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const saleA = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
        total: '500.00',
      });
      const saleB = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
        total: '500.00',
      });
      const cookies = await loginAndGetCookies(user.email, password);

      const created = await request(app.getHttpServer())
        .post(`/api/v1/sales/${saleA.id}/payments`)
        .set('Cookie', cookies)
        .send({
          payment_method: PaymentMethod.CASH,
          amount: 500,
          cash_received: 500,
        })
        .expect(201);
      const paymentOnA = created.body.payments[0].id;

      // Try to update A's payment via B's URL
      await request(app.getHttpServer())
        .patch(`/api/v1/sales/${saleB.id}/payments/${paymentOnA}`)
        .set('Cookie', cookies)
        .send({ amount: 300, cash_received: 300 })
        .expect(404);
    });
  });

  describe('DELETE /api/v1/sales/:saleId/payments/:paymentId', () => {
    it('removes a payment and returns 204; sale totals recomputed', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
        total: '500.00',
      });
      const cookies = await loginAndGetCookies(user.email, password);

      const created = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/payments`)
        .set('Cookie', cookies)
        .send({
          payment_method: PaymentMethod.CASH,
          amount: 500,
          cash_received: 500,
        })
        .expect(201);
      const paymentId = created.body.payments[0].id;

      await request(app.getHttpServer())
        .delete(`/api/v1/sales/${sale.id}/payments/${paymentId}`)
        .set('Cookie', cookies)
        .expect(204);

      // Payment actually gone
      const paymentRepo = dataSource.getRepository(Payment);
      const found = await paymentRepo.findOne({ where: { id: paymentId } });
      expect(found).toBeNull();

      // Sale totals reset
      const refreshed = await request(app.getHttpServer())
        .get(`/api/v1/sales/${sale.id}`)
        .set('Cookie', cookies)
        .expect(200);
      expect(refreshed.body.amount_paid).toBe('0.00');
      expect(refreshed.body.change_due).toBe('0.00');
      expect(refreshed.body.payments).toHaveLength(0);
    });

    it('returns 400 when sale is COMPLETED', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
        total: '500.00',
      });
      const cookies = await loginAndGetCookies(user.email, password);

      const created = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/payments`)
        .set('Cookie', cookies)
        .send({
          payment_method: PaymentMethod.CASH,
          amount: 500,
          cash_received: 500,
        })
        .expect(201);
      const paymentId = created.body.payments[0].id;

      // Flip to COMPLETED (bypass not-yet-built endpoint)
      await dataSource.getRepository(Sale).update(sale.id, {
        status: SaleStatus.COMPLETED,
        sale_number: 'INV-20260825-0001',
        completed_at: new Date(),
      });

      await request(app.getHttpServer())
        .delete(`/api/v1/sales/${sale.id}/payments/${paymentId}`)
        .set('Cookie', cookies)
        .expect(400);
    });
  });
  describe('POST /api/v1/sales/:id/complete', () => {
    /**
     * Helper: build a "ready to complete" DRAFT sale — one line, one
     * CASH payment covering the full total. Individual tests override
     * for edge cases (empty lines, underpaid, external supplier, etc).
     */
    async function seedReadyToCompleteSale(
      branchId: string,
      cashierId: string,
      cookies: string[],
      opts: {
        productPrice?: string;
        productName?: string;
        stockQty?: number;
        externalSupplierId?: string;
        skipPayment?: boolean;
        defaultWarranty?: WarrantyPeriod;
      } = {},
    ) {
      const price = opts.productPrice ?? '100.00';
      const product = await seedProduct(branchId, {
        name: opts.productName ?? 'Test Product',
        selling_price: price,
        default_warranty: opts.defaultWarranty,
      });
      // Give it stock (Phase 6.1 auto-creates the row at qty=0)
      if (opts.stockQty !== undefined) {
        await setStockQuantity(product.id, branchId, opts.stockQty);
      }
      const sale = await seedSale({
        branch_id: branchId,
        cashier_id: cashierId,
      });
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({
          product_id: product.id,
          quantity: 1,
          external_supplier_id: opts.externalSupplierId,
        })
        .expect(201);
      if (!opts.skipPayment) {
        await request(app.getHttpServer())
          .post(`/api/v1/sales/${sale.id}/payments`)
          .set('Cookie', cookies)
          .send({
            payment_method: PaymentMethod.CASH,
            amount: Number(price),
            cash_received: Number(price),
          })
          .expect(201);
      }
      return { sale, product };
    }

    it('completes a paid DRAFT sale: decrements stock, issues sale_number, sets completed_at', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const { sale, product } = await seedReadyToCompleteSale(
        branch.id,
        user.id,
        cookies,
        { productPrice: '250.00', stockQty: 5 },
      );

      const response = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/complete`)
        .set('Cookie', cookies)
        .expect(200);

      // Response is the fully-hydrated completed sale
      expect(response.body).toMatchObject({
        id: sale.id,
        status: SaleStatus.COMPLETED,
        total: '250.00',
        amount_paid: '250.00',
      });
      expect(response.body.sale_number).toMatch(/^INV-\d{8}-\d{4}$/);
      expect(response.body.completed_at).toBeTruthy();
      expect(response.body.branch).toMatchObject({ id: branch.id });
      expect(response.body.cashier).toMatchObject({ id: user.id });
      expect(response.body.lines).toHaveLength(1);
      expect(response.body.payments).toHaveLength(1);

      // Stock actually decremented in DB (5 - 1 = 4)
      const stockRepo = dataSource.getRepository(Stock);
      const stock = await stockRepo.findOne({
        where: { product_id: product.id, branch_id: branch.id },
      });
      expect(stock?.quantity).toBe(4);
    });

    // P5-18: the Colombo date the server stamps warranty_until from
    const colomboDatePlus = (length: { days?: number; months?: number }) =>
      DateTime.now().setZone('Asia/Colombo').plus(length).toISODate();

    it("starts the line on the product's default warranty; completing sets warranty_until (P5-18)", async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const { sale } = await seedReadyToCompleteSale(
        branch.id,
        user.id,
        cookies,
        { stockQty: 5, defaultWarranty: WarrantyPeriod.MONTH_12 },
      );

      // A DRAFT line has its period but no last day yet
      const draft = await request(app.getHttpServer())
        .get(`/api/v1/sales/${sale.id}`)
        .set('Cookie', cookies)
        .expect(200);
      expect(draft.body.lines[0]).toMatchObject({
        warranty: WarrantyPeriod.MONTH_12,
        warranty_until: null,
      });

      const response = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/complete`)
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.lines[0]).toMatchObject({
        warranty: WarrantyPeriod.MONTH_12,
        warranty_until: colomboDatePlus({ months: 12 }),
      });
    });

    it("keeps a completed line's warranty when the product's default changes later (P5-18)", async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const { sale, product } = await seedReadyToCompleteSale(
        branch.id,
        user.id,
        cookies,
        { stockQty: 5, defaultWarranty: WarrantyPeriod.MONTH_12 },
      );
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/complete`)
        .set('Cookie', cookies)
        .expect(200);

      await dataSource
        .getRepository(Product)
        .update(product.id, { default_warranty: WarrantyPeriod.MONTH_24 });

      const after = await request(app.getHttpServer())
        .get(`/api/v1/sales/${sale.id}`)
        .set('Cookie', cookies)
        .expect(200);
      expect(after.body.lines[0]).toMatchObject({
        warranty: WarrantyPeriod.MONTH_12,
        warranty_until: colomboDatePlus({ months: 12 }),
      });
    });

    it.each([WarrantyPeriod.NO_WARRANTY, WarrantyPeriod.CHECKING])(
      'a %s line completes with no warranty_until (P5-18, P5-19)',
      async (warranty) => {
        const branch = await seedBranch();
        const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
        const cookies = await loginAndGetCookies(user.email, password);
        const { sale } = await seedReadyToCompleteSale(
          branch.id,
          user.id,
          cookies,
          { stockQty: 5, defaultWarranty: warranty },
        );

        const response = await request(app.getHttpServer())
          .post(`/api/v1/sales/${sale.id}/complete`)
          .set('Cookie', cookies)
          .expect(200);

        expect(response.body.lines[0]).toMatchObject({
          warranty,
          warranty_until: null,
        });
      },
    );

    it('completes a sale with a UNIT_PRICE line and returns the discount fields the receipt needs (P5-20)', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const product = await seedProduct(branch.id, {
        selling_price: '200.00',
      });
      await setStockQuantity(product.id, branch.id, 5);
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({
          product_id: product.id,
          quantity: 2,
          discount_type: DiscountType.UNIT_PRICE,
          discount_value: 160,
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/payments`)
        .set('Cookie', cookies)
        .send({
          payment_method: PaymentMethod.CASH,
          amount: 320,
          cash_received: 320,
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/complete`)
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body).toMatchObject({
        status: SaleStatus.COMPLETED,
        subtotal: '400.00',
        discount_total: '80.00',
        total: '320.00',
      });
      expect(response.body.lines[0]).toMatchObject({
        unit_price: '200.00',
        quantity: 2,
        discount_type: DiscountType.UNIT_PRICE,
        discount_value: '160.00',
        discount_amount: '80.00',
        line_total: '320.00',
      });
    });

    it("the cashier can change a line's warranty on the DRAFT; completing uses it (P5-18)", async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.CASHIER, 'c@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const { sale } = await seedReadyToCompleteSale(
        branch.id,
        user.id,
        cookies,
        { stockQty: 5, defaultWarranty: WarrantyPeriod.MONTH_12 },
      );
      const draft = await request(app.getHttpServer())
        .get(`/api/v1/sales/${sale.id}`)
        .set('Cookie', cookies)
        .expect(200);
      const line = draft.body.lines[0] as { id: string; line_total: string };

      const patched = await request(app.getHttpServer())
        .patch(`/api/v1/sales/${sale.id}/lines/${line.id}`)
        .set('Cookie', cookies)
        .send({ warranty: WarrantyPeriod.WEEK_1 })
        .expect(200);
      expect(patched.body.lines[0]).toMatchObject({
        warranty: WarrantyPeriod.WEEK_1,
        line_total: line.line_total,
      });

      const completed = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/complete`)
        .set('Cookie', cookies)
        .expect(200);
      expect(completed.body.lines[0]).toMatchObject({
        warranty: WarrantyPeriod.WEEK_1,
        warranty_until: colomboDatePlus({ days: 7 }),
      });
    });

    it.each([
      ['null', null],
      ['an unknown code', 'MONTH_5'],
    ])(
      'rejects %s as a line warranty with 400 (P5-18)',
      async (_, warranty) => {
        const branch = await seedBranch();
        const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
        const cookies = await loginAndGetCookies(user.email, password);
        const { sale } = await seedReadyToCompleteSale(
          branch.id,
          user.id,
          cookies,
          { stockQty: 5 },
        );
        const draft = await request(app.getHttpServer())
          .get(`/api/v1/sales/${sale.id}`)
          .set('Cookie', cookies)
          .expect(200);

        await request(app.getHttpServer())
          .patch(`/api/v1/sales/${sale.id}/lines/${draft.body.lines[0].id}`)
          .set('Cookie', cookies)
          .send({ warranty })
          .expect(400);
      },
    );

    it('refuses to change the warranty once the sale is completed (P5-18)', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const { sale } = await seedReadyToCompleteSale(
        branch.id,
        user.id,
        cookies,
        { stockQty: 5 },
      );
      const done = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/complete`)
        .set('Cookie', cookies)
        .expect(200);

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/sales/${sale.id}/lines/${done.body.lines[0].id}`)
        .set('Cookie', cookies)
        .send({ warranty: WarrantyPeriod.MONTH_24 })
        .expect(400);
      expect(response.body.message).toMatch(/Only DRAFT sales are mutable/);
    });

    it('takes a warranty given when the line is added (P5-18)', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const product = await seedProduct(branch.id, {
        default_warranty: WarrantyPeriod.MONTH_12,
      });
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });

      const response = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({
          product_id: product.id,
          quantity: 1,
          warranty: WarrantyPeriod.MONTH_3,
        })
        .expect(201);

      expect(response.body.lines[0].warranty).toBe(WarrantyPeriod.MONTH_3);
    });

    it('names the product and line in the insufficient-stock 409, and leaves warranty_until null (P5-2)', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const { sale, product } = await seedReadyToCompleteSale(
        branch.id,
        user.id,
        cookies,
        { stockQty: 0, defaultWarranty: WarrantyPeriod.MONTH_12 },
      );
      const draft = await request(app.getHttpServer())
        .get(`/api/v1/sales/${sale.id}`)
        .set('Cookie', cookies)
        .expect(200);
      const lineId = draft.body.lines[0].id as string;

      const response = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/complete`)
        .set('Cookie', cookies)
        .expect(409);

      expect(response.body).toEqual({
        message:
          'Insufficient stock for "Test Product": requested 1, available 0',
        product_id: product.id,
        sale_line_id: lineId,
      });

      // Rolled back: the line keeps its period but has no last day
      const refreshed = await request(app.getHttpServer())
        .get(`/api/v1/sales/${sale.id}`)
        .set('Cookie', cookies)
        .expect(200);
      expect(refreshed.body.lines[0]).toMatchObject({
        warranty: WarrantyPeriod.MONTH_12,
        warranty_until: null,
      });
    });

    it('issues sequential sale_numbers within the same day at the same branch', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      const first = await seedReadyToCompleteSale(branch.id, user.id, cookies, {
        productName: 'Product A',
        stockQty: 10,
      });
      const second = await seedReadyToCompleteSale(
        branch.id,
        user.id,
        cookies,
        {
          productName: 'Product B',
          stockQty: 10,
        },
      );

      const resA = await request(app.getHttpServer())
        .post(`/api/v1/sales/${first.sale.id}/complete`)
        .set('Cookie', cookies)
        .expect(200);
      const resB = await request(app.getHttpServer())
        .post(`/api/v1/sales/${second.sale.id}/complete`)
        .set('Cookie', cookies)
        .expect(200);

      const matchA = (resA.body.sale_number as string).match(
        /^INV-(\d{8})-(\d{4})$/,
      );
      const matchB = (resB.body.sale_number as string).match(
        /^INV-(\d{8})-(\d{4})$/,
      );
      expect(matchA).not.toBeNull();
      expect(matchB).not.toBeNull();
      const [, dateA, numA] = matchA!;
      const [, dateB, numB] = matchB!;
      expect(dateA).toBe(dateB);
      expect(Number(numB)).toBe(Number(numA) + 1);
    });

    it('skips stock decrement for external-supplier lines', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      // Seed a supplier
      const supplierRepo = dataSource.getRepository(Supplier);
      const supplier = await supplierRepo.save({
        name: 'Friendly Shop',
        is_active: true,
      } as Supplier);

      // Line sourced from friendly shop — stock stays at 0
      const { sale, product } = await seedReadyToCompleteSale(
        branch.id,
        user.id,
        cookies,
        {
          productPrice: '500.00',
          stockQty: 0, // deliberately zero — we're not decrementing this
          externalSupplierId: supplier.id,
        },
      );

      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/complete`)
        .set('Cookie', cookies)
        .expect(200);

      // Stock stayed at 0 — friendly-shop line did NOT touch our inventory
      const stockRepo = dataSource.getRepository(Stock);
      const stock = await stockRepo.findOne({
        where: { product_id: product.id, branch_id: branch.id },
      });
      expect(stock?.quantity).toBe(0);
    });

    it('returns 409 and rolls back everything when stock is insufficient', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const { sale, product } = await seedReadyToCompleteSale(
        branch.id,
        user.id,
        cookies,
        { productPrice: '100.00', stockQty: 0 }, // trying to sell 1 with 0 in stock
      );

      const response = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/complete`)
        .set('Cookie', cookies)
        .expect(409);

      // Message names the product and available quantity
      expect(response.body.message).toMatch(/Insufficient stock/);
      expect(response.body.message).toMatch(/Test Product/);
      expect(response.body.message).toMatch(/available 0/);

      // Sale is still DRAFT — no sale_number, no completed_at
      const refreshed = await request(app.getHttpServer())
        .get(`/api/v1/sales/${sale.id}`)
        .set('Cookie', cookies)
        .expect(200);
      expect(refreshed.body.status).toBe(SaleStatus.DRAFT);
      expect(refreshed.body.sale_number).toBeNull();
      expect(refreshed.body.completed_at).toBeNull();

      // Stock unchanged
      const stockRepo = dataSource.getRepository(Stock);
      const stock = await stockRepo.findOne({
        where: { product_id: product.id, branch_id: branch.id },
      });
      expect(stock?.quantity).toBe(0);
    });

    it('returns 400 when the sale has no lines', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/complete`)
        .set('Cookie', cookies)
        .expect(400);

      expect(response.body.message).toMatch(/no lines/);
    });

    it('returns 400 when amount_paid does not equal total (underpaid)', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      // seedReadyToCompleteSale with skipPayment: line added, no payment
      const { sale } = await seedReadyToCompleteSale(
        branch.id,
        user.id,
        cookies,
        { productPrice: '100.00', stockQty: 5, skipPayment: true },
      );

      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/complete`)
        .set('Cookie', cookies)
        .expect(400);
    });

    it('returns 400 when attempting to complete an already-COMPLETED sale', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const { sale } = await seedReadyToCompleteSale(
        branch.id,
        user.id,
        cookies,
        { productPrice: '100.00', stockQty: 5 },
      );

      // Complete it once
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/complete`)
        .set('Cookie', cookies)
        .expect(200);

      // Try to complete again — should 400 because status is no longer DRAFT
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/complete`)
        .set('Cookie', cookies)
        .expect(400);
    });

    it('returns 404 when sale does not exist', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const fakeId = '00000000-0000-0000-0000-000000000000';

      await request(app.getHttpServer())
        .post(`/api/v1/sales/${fakeId}/complete`)
        .set('Cookie', cookies)
        .expect(404);
    });

    it('returns 401 when unauthenticated', async () => {
      const branch = await seedBranch();
      const { user } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });

      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/complete`)
        .expect(401);
    });

    it('cashier can complete their own branch sale', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(
        UserRole.CASHIER,
        'c@t.com',
        branch.id,
      );
      const cookies = await loginAndGetCookies(user.email, password);
      const { sale } = await seedReadyToCompleteSale(
        branch.id,
        user.id,
        cookies,
        { productPrice: '100.00', stockQty: 5 },
      );

      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/complete`)
        .set('Cookie', cookies)
        .expect(200);
    });

    it('decrements multi-line sale stock correctly (per-line, per-product)', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      const productA = await seedProduct(branch.id, {
        name: 'Product A',
        selling_price: '100.00',
      });
      const productB = await seedProduct(branch.id, {
        name: 'Product B',
        selling_price: '200.00',
      });
      await setStockQuantity(productA.id, branch.id, 10);
      await setStockQuantity(productB.id, branch.id, 5);

      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({ product_id: productA.id, quantity: 3 })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({ product_id: productB.id, quantity: 2 })
        .expect(201);
      // Total: (100 * 3) + (200 * 2) = 700
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/payments`)
        .set('Cookie', cookies)
        .send({
          payment_method: PaymentMethod.CASH,
          amount: 700,
          cash_received: 700,
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/complete`)
        .set('Cookie', cookies)
        .expect(200);

      const stockRepo = dataSource.getRepository(Stock);
      const stockA = await stockRepo.findOne({
        where: { product_id: productA.id, branch_id: branch.id },
      });
      const stockB = await stockRepo.findOne({
        where: { product_id: productB.id, branch_id: branch.id },
      });
      expect(stockA?.quantity).toBe(7); // 10 - 3
      expect(stockB?.quantity).toBe(3); // 5 - 2
    });

    it('does not decrement stock for products where manage_stock is false', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      const product = await seedProduct(branch.id, {
        name: 'Service Line',
        selling_price: '500.00',
      });
      // manage_stock = false → the decrement should silently skip
      await setStockQuantity(product.id, branch.id, 0, false);

      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({ product_id: product.id, quantity: 5 })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/payments`)
        .set('Cookie', cookies)
        .send({
          payment_method: PaymentMethod.CASH,
          amount: 2500,
          cash_received: 2500,
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/complete`)
        .set('Cookie', cookies)
        .expect(200);

      // Stock stayed at 0 — untracked product, no decrement
      const stockRepo = dataSource.getRepository(Stock);
      const stock = await stockRepo.findOne({
        where: { product_id: product.id, branch_id: branch.id },
      });
      expect(stock?.quantity).toBe(0);
    });
  });

  describe('POST /api/v1/sales/:id/void', () => {
    /**
     * Helper: build and immediately COMPLETE a sale so we have a real
     * VOIDable sale to work with. Void tests always start from
     * COMPLETED (DRAFT-void is a rejected state, not a starting state).
     *
     * Reuses seedReadyToCompleteSale + the /complete endpoint to keep
     * void tests exercising the real production flow end-to-end. No
     * shortcuts like manual sale.status='COMPLETED' UPDATE — that would
     * bypass the stock-decrement side effect and produce a DB state that
     * void couldn't validly operate on.
     */
    async function seedCompletedSale(
      branchId: string,
      cashierId: string,
      cookies: string[],
      opts: {
        productPrice?: string;
        productName?: string;
        stockQty?: number;
        externalSupplierId?: string;
      } = {},
    ) {
      const price = opts.productPrice ?? '100.00';
      const product = await seedProduct(branchId, {
        name: opts.productName ?? 'Test Product',
        selling_price: price,
      });
      if (opts.stockQty !== undefined) {
        await setStockQuantity(product.id, branchId, opts.stockQty);
      }
      const sale = await seedSale({
        branch_id: branchId,
        cashier_id: cashierId,
      });
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({
          product_id: product.id,
          quantity: 1,
          external_supplier_id: opts.externalSupplierId,
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/payments`)
        .set('Cookie', cookies)
        .send({
          payment_method: PaymentMethod.CASH,
          amount: Number(price),
          cash_received: Number(price),
        })
        .expect(201);
      const completed = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/complete`)
        .set('Cookie', cookies)
        .expect(200);
      return { sale, product, saleNumber: completed.body.sale_number };
    }

    const validReason = 'Customer returned defective phone';

    it('voids a COMPLETED sale: re-increments stock, marks payments reversed, flips to VOIDED', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      // Start with stock 5, sell 1 → after complete stock is 4, after void back to 5
      const { sale, product, saleNumber } = await seedCompletedSale(
        branch.id,
        user.id,
        cookies,
        { productPrice: '250.00', stockQty: 5 },
      );

      const response = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/void`)
        .set('Cookie', cookies)
        .send({ void_reason: validReason })
        .expect(200);

      // Response is fully-hydrated voided sale
      expect(response.body).toMatchObject({
        id: sale.id,
        status: SaleStatus.VOIDED,
        void_reason: validReason,
        voided_by: user.id,
        // Preserved from complete:
        sale_number: saleNumber,
        total: '250.00',
        amount_paid: '250.00',
      });
      expect(response.body.voided_at).toBeTruthy();
      expect(response.body.completed_at).toBeTruthy(); // NOT cleared

      // Lines unchanged
      expect(response.body.lines).toHaveLength(1);

      // Payments stamped with reversal fields
      expect(response.body.payments).toHaveLength(1);
      expect(response.body.payments[0].reversed_at).toBeTruthy();
      expect(response.body.payments[0].reversal_reason).toBe(validReason);
      // Payment amount UNCHANGED — void doesn't zero out payment amounts
      expect(response.body.payments[0].amount).toBe('250.00');

      // Stock actually re-incremented in DB (4 → 5)
      const stockRepo = dataSource.getRepository(Stock);
      const stock = await stockRepo.findOne({
        where: { product_id: product.id, branch_id: branch.id },
      });
      expect(stock?.quantity).toBe(5);
    });

    it('trims whitespace from void_reason before persisting', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const { sale } = await seedCompletedSale(branch.id, user.id, cookies, {
        stockQty: 5,
      });

      const response = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/void`)
        .set('Cookie', cookies)
        .send({ void_reason: '   Duplicate transaction   ' })
        .expect(200);

      expect(response.body.void_reason).toBe('Duplicate transaction');
      expect(response.body.payments[0].reversal_reason).toBe(
        'Duplicate transaction',
      );
    });

    it('skips stock re-increment for external-supplier lines', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      const supplierRepo = dataSource.getRepository(Supplier);
      const supplier = await supplierRepo.save({
        name: 'Friendly Shop',
        is_active: true,
      } as Supplier);

      // External line — completeSale didn't decrement stock, so void
      // shouldn't re-increment. Stock stays at 0 throughout.
      const { sale, product } = await seedCompletedSale(
        branch.id,
        user.id,
        cookies,
        {
          productPrice: '500.00',
          stockQty: 0,
          externalSupplierId: supplier.id,
        },
      );

      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/void`)
        .set('Cookie', cookies)
        .send({ void_reason: validReason })
        .expect(200);

      const stockRepo = dataSource.getRepository(Stock);
      const stock = await stockRepo.findOne({
        where: { product_id: product.id, branch_id: branch.id },
      });
      expect(stock?.quantity).toBe(0); // never touched, symmetric with complete
    });

    it('preserves sale_number and completed_at after void', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const { sale, saleNumber } = await seedCompletedSale(
        branch.id,
        user.id,
        cookies,
        { stockQty: 5 },
      );

      // Grab completed_at from the completed sale to compare after void
      const beforeVoid = await request(app.getHttpServer())
        .get(`/api/v1/sales/${sale.id}`)
        .set('Cookie', cookies)
        .expect(200);
      const originalCompletedAt = beforeVoid.body.completed_at;

      const response = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/void`)
        .set('Cookie', cookies)
        .send({ void_reason: validReason })
        .expect(200);

      // Invoice number stays — audit trail integrity
      expect(response.body.sale_number).toBe(saleNumber);
      // completed_at stays — the sale WAS completed, that fact doesn't change
      expect(response.body.completed_at).toBe(originalCompletedAt);
    });

    it('multi-line + multi-payment void re-increments each in-house line and stamps every payment', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      const productA = await seedProduct(branch.id, {
        name: 'A',
        selling_price: '100.00',
      });
      const productB = await seedProduct(branch.id, {
        name: 'B',
        selling_price: '200.00',
      });
      await setStockQuantity(productA.id, branch.id, 10);
      await setStockQuantity(productB.id, branch.id, 5);

      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({ product_id: productA.id, quantity: 3 })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({ product_id: productB.id, quantity: 2 })
        .expect(201);
      // Total: 300 + 400 = 700. Split-tender: 400 card + 300 cash
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/payments`)
        .set('Cookie', cookies)
        .send({
          payment_method: PaymentMethod.CARD,
          amount: 400,
          reference_number: 'AUTH-1',
        })
        .expect(201);
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
      // After complete: stockA=7, stockB=3

      const response = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/void`)
        .set('Cookie', cookies)
        .send({ void_reason: validReason })
        .expect(200);

      // Both payments stamped with same reversal_reason
      expect(response.body.payments).toHaveLength(2);
      for (const p of response.body.payments) {
        expect(p.reversed_at).toBeTruthy();
        expect(p.reversal_reason).toBe(validReason);
      }

      // Both stocks restored to original quantities
      const stockRepo = dataSource.getRepository(Stock);
      const stockA = await stockRepo.findOne({
        where: { product_id: productA.id, branch_id: branch.id },
      });
      const stockB = await stockRepo.findOne({
        where: { product_id: productB.id, branch_id: branch.id },
      });
      expect(stockA?.quantity).toBe(10); // 7 + 3 back
      expect(stockB?.quantity).toBe(5); // 3 + 2 back
    });

    it('returns 400 when void_reason is missing', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const { sale } = await seedCompletedSale(branch.id, user.id, cookies, {
        stockQty: 5,
      });

      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/void`)
        .set('Cookie', cookies)
        .send({})
        .expect(400);
    });

    it('returns 400 when void_reason is whitespace-only', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const { sale } = await seedCompletedSale(branch.id, user.id, cookies, {
        stockQty: 5,
      });

      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/void`)
        .set('Cookie', cookies)
        .send({ void_reason: '     ' })
        .expect(400);
    });

    it('returns 400 when void_reason is too short (< 3 chars after trim)', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const { sale } = await seedCompletedSale(branch.id, user.id, cookies, {
        stockQty: 5,
      });

      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/void`)
        .set('Cookie', cookies)
        .send({ void_reason: 'no' })
        .expect(400);
    });

    it('returns 400 when attempting to void a DRAFT sale', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/void`)
        .set('Cookie', cookies)
        .send({ void_reason: validReason })
        .expect(400);
    });

    it('returns 400 when attempting to void an already-VOIDED sale (terminal state)', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const { sale } = await seedCompletedSale(branch.id, user.id, cookies, {
        stockQty: 5,
      });

      // First void — succeeds
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/void`)
        .set('Cookie', cookies)
        .send({ void_reason: validReason })
        .expect(200);

      // Second void — VOIDED is terminal
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/void`)
        .set('Cookie', cookies)
        .send({ void_reason: 'Trying again' })
        .expect(400);
    });

    it('returns 403 when cashier attempts to void (admin/manager only)', async () => {
      const branch = await seedBranch();
      const cashier = await seedUser(UserRole.CASHIER, 'c@t.com', branch.id);
      const cookies = await loginAndGetCookies(
        cashier.user.email,
        cashier.password,
      );
      // Cashier completes their own sale (they're allowed)
      const { sale } = await seedCompletedSale(
        branch.id,
        cashier.user.id,
        cookies,
        { stockQty: 5 },
      );

      // But they can't void it — supervisor swipe required
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/void`)
        .set('Cookie', cookies)
        .send({ void_reason: validReason })
        .expect(403);
    });

    it('manager can void a sale', async () => {
      const branch = await seedBranch();
      // Cashier completes the sale
      const cashier = await seedUser(UserRole.CASHIER, 'c@t.com', branch.id);
      const cashierCookies = await loginAndGetCookies(
        cashier.user.email,
        cashier.password,
      );
      const { sale } = await seedCompletedSale(
        branch.id,
        cashier.user.id,
        cashierCookies,
        { stockQty: 5 },
      );

      // Manager voids it
      const manager = await seedUser(UserRole.MANAGER, 'm@t.com', branch.id);
      const managerCookies = await loginAndGetCookies(
        manager.user.email,
        manager.password,
      );

      const response = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/void`)
        .set('Cookie', managerCookies)
        .send({ void_reason: validReason })
        .expect(200);

      // voided_by attributed to the manager, not the original cashier
      expect(response.body.voided_by).toBe(manager.user.id);
      expect(response.body.status).toBe(SaleStatus.VOIDED);
    });

    it('returns 404 when sale does not exist', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const fakeId = '00000000-0000-0000-0000-000000000000';

      await request(app.getHttpServer())
        .post(`/api/v1/sales/${fakeId}/void`)
        .set('Cookie', cookies)
        .send({ void_reason: validReason })
        .expect(404);
    });

    it('returns 401 when unauthenticated', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const { sale } = await seedCompletedSale(branch.id, user.id, cookies, {
        stockQty: 5,
      });

      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/void`)
        .send({ void_reason: validReason })
        .expect(401);
    });

    it('DB directly reflects VOIDED status, all void fields, and reversed payments', async () => {
      // Belt-and-suspenders: response body is one thing, but the DB is
      // the source of truth. Verify directly what's persisted.
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const { sale } = await seedCompletedSale(branch.id, user.id, cookies, {
        stockQty: 5,
      });

      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/void`)
        .set('Cookie', cookies)
        .send({ void_reason: validReason })
        .expect(200);

      const saleRepo = dataSource.getRepository(Sale);
      const persisted = await saleRepo.findOne({ where: { id: sale.id } });
      expect(persisted?.status).toBe(SaleStatus.VOIDED);
      expect(persisted?.voided_at).toBeTruthy();
      expect(persisted?.voided_by).toBe(user.id);
      expect(persisted?.void_reason).toBe(validReason);

      // Every payment on this sale has both reversal fields set
      const paymentRepo = dataSource.getRepository(Payment);
      const payments = await paymentRepo.find({
        where: { sale_id: sale.id },
      });
      expect(payments.length).toBeGreaterThan(0);
      for (const p of payments) {
        expect(p.reversed_at).toBeTruthy();
        expect(p.reversal_reason).toBe(validReason);
      }
    });
  });

  // ============================================================
  // Slice E — Serialized product line handling
  // POST /sales/:id/lines with is_serialized products
  // ============================================================
  describe('POST /api/v1/sales/:saleId/lines — Slice E serialized', () => {
    // ---- Non-serialized: reject imei_snapshot ----

    it('returns 400 when imei_snapshot is set on a non-serialized in-house line', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const product = await seedProduct(branch.id, { is_serialized: false });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({
          product_id: product.id,
          quantity: 1,
          imei_snapshot: '354789102345678',
        })
        .expect(400);

      expect(response.body.message).toMatch(
        /is not serialized; imei_snapshot must not be set/,
      );
    });

    // ---- Serialized in-house: happy path + all four Q3 failure modes ----

    it('adds a serialized in-house line: stores product_unit_id, snapshots imei from PU, uses PU price', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const product = await seedProduct(branch.id, {
        name: 'iPhone 15 (used)',
        is_serialized: true,
        selling_price: '250000.00',
        buying_price: '200000.00',
      });
      const unit = await seedProductUnit(
        product.id,
        branch.id,
        user.id,
        '354789102345678',
        {
          selling_price: '260000.00', // PU price overrides Product
          buying_price: '210000.00', // PU cost is authoritative
        },
      );

      const response = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({
          product_id: product.id,
          quantity: 1,
          imei_snapshot: '354789102345678',
        })
        .expect(201);

      expect(response.body.lines).toHaveLength(1);
      expect(response.body.lines[0]).toMatchObject({
        product_id: product.id,
        product_unit_id: unit.id,
        imei_snapshot: '354789102345678',
        unit_price: '260000.00', // PU price used, not Product's 250000
        cost_price_snapshot: '210000.00', // PU cost always
        quantity: 1,
      });

      // DB directly reflects the link
      const lineRepo = dataSource.getRepository(SaleLine);
      const persisted = await lineRepo.findOne({
        where: { id: response.body.lines[0].id },
      });
      expect(persisted?.product_unit_id).toBe(unit.id);
      expect(persisted?.imei_snapshot).toBe('354789102345678');
    });

    it('falls back to Product.selling_price when PU.selling_price is null', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const product = await seedProduct(branch.id, {
        is_serialized: true,
        selling_price: '250000.00',
      });
      await seedProductUnit(product.id, branch.id, user.id, '354789102999888', {
        selling_price: null, // no per-unit price — falls back to Product
      });

      const response = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({
          product_id: product.id,
          quantity: 1,
          imei_snapshot: '354789102999888',
        })
        .expect(201);

      expect(response.body.lines[0].unit_price).toBe('250000.00'); // Product fallback
    });
    // Note: the "PU.selling_price null AND Product.selling_price null → 400"
    // branch cannot be reached via legitimate data because products.selling_price
    // is NOT NULL in the schema. The service-side guard is defense-in-depth for
    // a future migration that makes Product.selling_price nullable. Unit-tested;
    // no e2e equivalent possible today.

    it('returns 400 when imei_snapshot is missing on serialized in-house line', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const product = await seedProduct(branch.id, { is_serialized: true });

      const response = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({ product_id: product.id, quantity: 1 })
        .expect(400);

      expect(response.body.message).toMatch(/imei_snapshot is required/);
    });

    it('returns 400 when quantity != 1 on a serialized in-house line', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const product = await seedProduct(branch.id, { is_serialized: true });
      await seedProductUnit(product.id, branch.id, user.id, '354789102222222');

      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({
          product_id: product.id,
          quantity: 2,
          imei_snapshot: '354789102222222',
        })
        .expect(400);
    });

    it('returns 400 when IMEI is not in stock (Q3 case 1)', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const product = await seedProduct(branch.id, { is_serialized: true });
      // Deliberately no seedProductUnit — the IMEI doesn't exist

      const response = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({
          product_id: product.id,
          quantity: 1,
          imei_snapshot: '354789102333333',
        })
        .expect(400);

      expect(response.body.message).toMatch(/is not in stock/);
    });

    it('returns 400 when IMEI belongs to a different product (Q3 case 2)', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const productA = await seedProduct(branch.id, {
        name: 'Product A',
        is_serialized: true,
      });
      const productB = await seedProduct(branch.id, {
        name: 'Product B',
        is_serialized: true,
      });
      await seedProductUnit(productB.id, branch.id, user.id, '354789102444444');

      // Client sends productA + IMEI belonging to productB
      const response = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({
          product_id: productA.id,
          quantity: 1,
          imei_snapshot: '354789102444444',
        })
        .expect(400);

      expect(response.body.message).toMatch(/does not belong to product/);
    });

    it('returns 400 when IMEI is at a different branch (Q3 case 3 via product mismatch)', async () => {
      const branchA = await seedBranch({ name: 'Branch A' });
      const branchB = await seedBranch({ name: 'Branch B' });
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const sale = await seedSale({
        branch_id: branchA.id,
        cashier_id: user.id,
      });
      const product = await seedProduct(branchA.id, { is_serialized: true });
      // PU is at branchB, but sale is at branchA
      // Note: the PU must reference a product at its own branch, so we seed a
      // parallel product at branchB with the target IMEI
      const productAtB = await seedProduct(branchB.id, {
        is_serialized: true,
      });
      await seedProductUnit(
        productAtB.id,
        branchB.id,
        user.id,
        '354789102555555',
      );

      // But client tries to reference this IMEI on saleA (branchA) with the branchA product
      const response = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({
          product_id: product.id,
          quantity: 1,
          imei_snapshot: '354789102555555',
        })
        .expect(400);

      // This will hit "product mismatch" first (Q3 order: not-found →
      // product → branch → status). The message will be about product
      // mismatch, not branch. That's the correct behavior — we test
      // pure branch mismatch by aligning the product.
      expect(response.body.message).toMatch(/does not belong to product/);
    });

    it('returns 409 with existing_unit payload when IMEI is SOLD (Q3 case 4)', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const product = await seedProduct(branch.id, { is_serialized: true });
      const unit = await seedProductUnit(
        product.id,
        branch.id,
        user.id,
        '354789102666666',
        { status: ProductUnitStatus.SOLD },
      );

      const response = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({
          product_id: product.id,
          quantity: 1,
          imei_snapshot: '354789102666666',
        })
        .expect(409);

      expect(response.body.message).toMatch(/SOLD/);
      expect(response.body.existing_unit).toMatchObject({
        id: unit.id,
        status: ProductUnitStatus.SOLD,
        product_id: product.id,
        branch_id: branch.id,
      });
    });

    it('returns 409 when IMEI is RETURNED', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const product = await seedProduct(branch.id, { is_serialized: true });
      await seedProductUnit(product.id, branch.id, user.id, '354789102777777', {
        status: ProductUnitStatus.RETURNED,
      });

      const response = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({
          product_id: product.id,
          quantity: 1,
          imei_snapshot: '354789102777777',
        })
        .expect(409);

      expect(response.body.message).toMatch(/RETURNED/);
    });

    // ---- External-sourced serialized ----

    it('adds an external-sourced serialized line: no PU lookup, uses Product prices, verbatim imei', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const product = await seedProduct(branch.id, {
        is_serialized: true,
        selling_price: '250000.00',
        buying_price: '220000.00',
      });
      const supplier = await dataSource.getRepository(Supplier).save({
        name: 'Friendly Shop',
        is_active: true,
      } as Supplier);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({
          product_id: product.id,
          quantity: 1,
          external_supplier_id: supplier.id,
          imei_snapshot: '999888777666555',
        })
        .expect(201);

      expect(response.body.lines[0]).toMatchObject({
        product_unit_id: null, // no PU link
        imei_snapshot: '999888777666555', // free text verbatim
        external_supplier_id: supplier.id,
        unit_price: '250000.00', // Product price
        cost_price_snapshot: '220000.00', // Product cost
      });
    });

    it('returns 409 when external imei_snapshot matches an IN_STOCK PU (Q7)', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const inHouseProduct = await seedProduct(branch.id, {
        name: 'In-house iPhone',
        is_serialized: true,
      });
      const existingUnit = await seedProductUnit(
        inHouseProduct.id,
        branch.id,
        user.id,
        '354789102888888',
        { status: ProductUnitStatus.IN_STOCK },
      );

      // Now try to sell an "external" phone with the SAME IMEI
      const externalProduct = await seedProduct(branch.id, {
        name: 'External iPhone',
        is_serialized: true,
      });
      const supplier = await dataSource.getRepository(Supplier).save({
        name: 'Friendly Shop',
        is_active: true,
      } as Supplier);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({
          product_id: externalProduct.id,
          quantity: 1,
          external_supplier_id: supplier.id,
          imei_snapshot: '354789102888888',
        })
        .expect(409);

      expect(response.body.message).toMatch(/currently in your stock/);
      expect(response.body.existing_unit).toMatchObject({
        id: existingUnit.id,
        product_id: inHouseProduct.id,
        branch_id: branch.id,
      });
    });

    it('allows external imei_snapshot matching a SOLD PU (historical, not diagnostic)', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const inHouseProduct = await seedProduct(branch.id, {
        is_serialized: true,
      });
      // SOLD PU — collision check filters by status=IN_STOCK, so this is fine
      await seedProductUnit(
        inHouseProduct.id,
        branch.id,
        user.id,
        '354789102999000',
        { status: ProductUnitStatus.SOLD },
      );

      const externalProduct = await seedProduct(branch.id, {
        is_serialized: true,
      });
      const supplier = await dataSource.getRepository(Supplier).save({
        name: 'Friendly Shop 2',
        is_active: true,
      } as Supplier);

      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({
          product_id: externalProduct.id,
          quantity: 1,
          external_supplier_id: supplier.id,
          imei_snapshot: '354789102999000',
        })
        .expect(201);
    });
  });

  // ============================================================
  // Slice E — Mode-aware updateLine
  // PATCH /sales/:saleId/lines/:lineId
  // ============================================================
  describe('PATCH /api/v1/sales/:saleId/lines/:lineId — Slice E serialized', () => {
    it('rejects setting imei_snapshot on a non-serialized line', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const product = await seedProduct(branch.id, { is_serialized: false });

      const created = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({ product_id: product.id, quantity: 2 })
        .expect(201);
      const lineId = created.body.lines[0].id;

      await request(app.getHttpServer())
        .patch(`/api/v1/sales/${sale.id}/lines/${lineId}`)
        .set('Cookie', cookies)
        .send({ imei_snapshot: '354789102345678' })
        .expect(400);
    });

    it('rejects quantity != 1 on a serialized in-house line', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const product = await seedProduct(branch.id, {
        is_serialized: true,
        selling_price: '250000.00',
      });
      await seedProductUnit(product.id, branch.id, user.id, '354789101010101');

      const created = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({
          product_id: product.id,
          quantity: 1,
          imei_snapshot: '354789101010101',
        })
        .expect(201);
      const lineId = created.body.lines[0].id;

      await request(app.getHttpServer())
        .patch(`/api/v1/sales/${sale.id}/lines/${lineId}`)
        .set('Cookie', cookies)
        .send({ quantity: 3 })
        .expect(400);
    });

    it('rejects imei_snapshot change on a serialized in-house line', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const product = await seedProduct(branch.id, {
        is_serialized: true,
        selling_price: '250000.00',
      });
      await seedProductUnit(product.id, branch.id, user.id, '354789101010102');

      const created = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({
          product_id: product.id,
          quantity: 1,
          imei_snapshot: '354789101010102',
        })
        .expect(201);
      const lineId = created.body.lines[0].id;

      await request(app.getHttpServer())
        .patch(`/api/v1/sales/${sale.id}/lines/${lineId}`)
        .set('Cookie', cookies)
        .send({ imei_snapshot: '999999999999999' })
        .expect(400);
    });

    it('allows discount edit on a serialized in-house line', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const product = await seedProduct(branch.id, {
        is_serialized: true,
        selling_price: '250000.00',
      });
      await seedProductUnit(product.id, branch.id, user.id, '354789101010103');

      const created = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({
          product_id: product.id,
          quantity: 1,
          imei_snapshot: '354789101010103',
        })
        .expect(201);
      const lineId = created.body.lines[0].id;

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/sales/${sale.id}/lines/${lineId}`)
        .set('Cookie', cookies)
        .send({
          discount_type: DiscountType.AMOUNT,
          discount_value: 5000,
        })
        .expect(200);

      expect(response.body.lines[0].discount_amount).toBe('5000.00');
      expect(response.body.lines[0].line_total).toBe('245000.00');
    });

    it('allows imei_snapshot edit on a serialized external line (no collision)', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const product = await seedProduct(branch.id, {
        is_serialized: true,
        selling_price: '250000.00',
      });
      const supplier = await dataSource.getRepository(Supplier).save({
        name: 'Friendly Shop',
        is_active: true,
      } as Supplier);

      const created = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({
          product_id: product.id,
          quantity: 1,
          external_supplier_id: supplier.id,
          imei_snapshot: '111222333444555',
        })
        .expect(201);
      const lineId = created.body.lines[0].id;

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/sales/${sale.id}/lines/${lineId}`)
        .set('Cookie', cookies)
        .send({ imei_snapshot: '999888777666555' })
        .expect(200);

      expect(response.body.lines[0].imei_snapshot).toBe('999888777666555');
    });

    it('rejects imei_snapshot edit on external line if new IMEI matches IN_STOCK PU (Q7)', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const externalProduct = await seedProduct(branch.id, {
        name: 'External',
        is_serialized: true,
      });
      const inHouseProduct = await seedProduct(branch.id, {
        name: 'In-house',
        is_serialized: true,
      });
      const supplier = await dataSource.getRepository(Supplier).save({
        name: 'Friendly Shop',
        is_active: true,
      } as Supplier);

      // Existing IN_STOCK PU
      await seedProductUnit(
        inHouseProduct.id,
        branch.id,
        user.id,
        '354789104040404',
        { status: ProductUnitStatus.IN_STOCK },
      );

      // External line with a different IMEI
      const created = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({
          product_id: externalProduct.id,
          quantity: 1,
          external_supplier_id: supplier.id,
          imei_snapshot: '111222333444555',
        })
        .expect(201);
      const lineId = created.body.lines[0].id;

      // Try to edit the IMEI to one that matches an IN_STOCK PU
      await request(app.getHttpServer())
        .patch(`/api/v1/sales/${sale.id}/lines/${lineId}`)
        .set('Cookie', cookies)
        .send({ imei_snapshot: '354789104040404' })
        .expect(409);
    });
  });

  // ============================================================
  // Slice E — Complete/void with serialized lines + atomicity
  // POST /sales/:id/complete and /void
  // ============================================================
  describe('POST /api/v1/sales/:id/complete + /void — Slice E serialized', () => {
    /**
     * Helper: seed a serialized in-house product + PU + a sale with one
     * serialized line + a matching payment, ready to complete.
     * Returns everything the tests need for DB assertions.
     */
    async function seedReadyToCompleteSerialized(
      branchId: string,
      cashierId: string,
      cookies: string[],
      opts: {
        imei?: string;
        puSellingPrice?: string;
        puBuyingPrice?: string;
        stockQty?: number;
      } = {},
    ) {
      const imei = opts.imei ?? '350000000000001';
      const puPrice = opts.puSellingPrice ?? '250000.00';
      const product = await seedProduct(branchId, {
        name: 'Serialized Phone',
        is_serialized: true,
        selling_price: '260000.00', // Product default (used only for fallback)
        buying_price: '220000.00',
      });
      // Seed stock at a specific quantity so we can verify decrement
      await setStockQuantity(product.id, branchId, opts.stockQty ?? 5);
      const unit = await seedProductUnit(
        product.id,
        branchId,
        cashierId,
        imei,
        {
          selling_price: puPrice,
          buying_price: opts.puBuyingPrice ?? '210000.00',
        },
      );
      const sale = await seedSale({
        branch_id: branchId,
        cashier_id: cashierId,
      });
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({ product_id: product.id, quantity: 1, imei_snapshot: imei })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/payments`)
        .set('Cookie', cookies)
        .send({
          payment_method: PaymentMethod.CASH,
          amount: Number(puPrice),
          cash_received: Number(puPrice),
        })
        .expect(201);
      return { sale, product, unit };
    }

    // ---- Complete: serialized happy path + PU state ----

    it('completes a serialized in-house sale: PU flipped to SOLD, stock decremented', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const { sale, product, unit } = await seedReadyToCompleteSerialized(
        branch.id,
        user.id,
        cookies,
        { stockQty: 5 },
      );

      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/complete`)
        .set('Cookie', cookies)
        .expect(200);

      // PU flipped to SOLD in DB
      const puRepo = dataSource.getRepository(ProductUnit);
      const puAfter = await puRepo.findOne({ where: { id: unit.id } });
      expect(puAfter?.status).toBe(ProductUnitStatus.SOLD);

      // Stock decremented from 5 to 4
      const stockRepo = dataSource.getRepository(Stock);
      const stockAfter = await stockRepo.findOne({
        where: { product_id: product.id, branch_id: branch.id },
      });
      expect(stockAfter?.quantity).toBe(4);
    });

    it('completes a mixed sale: PU flip only for serialized in-house line', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      // Line 1: serialized in-house
      const serializedProduct = await seedProduct(branch.id, {
        name: 'Serialized',
        is_serialized: true,
        selling_price: '250000.00',
      });
      await setStockQuantity(serializedProduct.id, branch.id, 3);
      const serializedUnit = await seedProductUnit(
        serializedProduct.id,
        branch.id,
        user.id,
        '350000000000010',
        { selling_price: '250000.00' },
      );

      // Line 2: non-serialized in-house
      const chargerProduct = await seedProduct(branch.id, {
        name: 'Charger',
        selling_price: '2000.00',
      });
      await setStockQuantity(chargerProduct.id, branch.id, 10);

      // Line 3: external-sourced serialized (no PU, no stock touch)
      const supplier = await dataSource.getRepository(Supplier).save({
        name: 'Friendly Shop',
        is_active: true,
      } as Supplier);
      const externalProduct = await seedProduct(branch.id, {
        name: 'External',
        is_serialized: true,
        selling_price: '180000.00',
      });

      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });

      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({
          product_id: serializedProduct.id,
          quantity: 1,
          imei_snapshot: '350000000000010',
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({ product_id: chargerProduct.id, quantity: 2 })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({
          product_id: externalProduct.id,
          quantity: 1,
          external_supplier_id: supplier.id,
          imei_snapshot: '999888777666555',
        })
        .expect(201);

      // Total: 250000 + 4000 + 180000 = 434000
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/payments`)
        .set('Cookie', cookies)
        .send({
          payment_method: PaymentMethod.CASH,
          amount: 434000,
          cash_received: 434000,
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/complete`)
        .set('Cookie', cookies)
        .expect(200);

      // Serialized in-house: PU flipped, stock decremented
      const puRepo = dataSource.getRepository(ProductUnit);
      const stockRepo = dataSource.getRepository(Stock);
      const serializedPUAfter = await puRepo.findOne({
        where: { id: serializedUnit.id },
      });
      expect(serializedPUAfter?.status).toBe(ProductUnitStatus.SOLD);
      const serializedStockAfter = await stockRepo.findOne({
        where: {
          product_id: serializedProduct.id,
          branch_id: branch.id,
        },
      });
      expect(serializedStockAfter?.quantity).toBe(2); // 3 - 1

      // Non-serialized in-house: stock decremented (no PU to check)
      const chargerStockAfter = await stockRepo.findOne({
        where: { product_id: chargerProduct.id, branch_id: branch.id },
      });
      expect(chargerStockAfter?.quantity).toBe(8); // 10 - 2
    });

    // ---- Complete: cross-DRAFT race (crown jewel) ----

    it('CROWN JEWEL: cross-DRAFT race — second complete gets 409, whole transaction rolls back', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      const product = await seedProduct(branch.id, {
        name: 'Contested Phone',
        is_serialized: true,
        selling_price: '250000.00',
      });
      await setStockQuantity(product.id, branch.id, 5); // enough for both attempts
      const unit = await seedProductUnit(
        product.id,
        branch.id,
        user.id,
        '355555555555555',
        { selling_price: '250000.00' },
      );

      // Two DRAFTs, both referencing the same IMEI (allowed per Q5)
      const saleA = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      const saleB = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });

      for (const sid of [saleA.id, saleB.id]) {
        await request(app.getHttpServer())
          .post(`/api/v1/sales/${sid}/lines`)
          .set('Cookie', cookies)
          .send({
            product_id: product.id,
            quantity: 1,
            imei_snapshot: '355555555555555',
          })
          .expect(201);
        await request(app.getHttpServer())
          .post(`/api/v1/sales/${sid}/payments`)
          .set('Cookie', cookies)
          .send({
            payment_method: PaymentMethod.CASH,
            amount: 250000,
            cash_received: 250000,
          })
          .expect(201);
      }

      // Sale A completes first
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${saleA.id}/complete`)
        .set('Cookie', cookies)
        .expect(200);

      // Snapshot state before Sale B's failed complete attempt
      const stockRepo = dataSource.getRepository(Stock);
      const puRepo = dataSource.getRepository(ProductUnit);
      const saleRepo = dataSource.getRepository(Sale);

      const stockBefore = await stockRepo.findOne({
        where: { product_id: product.id, branch_id: branch.id },
      });
      const puBefore = await puRepo.findOne({ where: { id: unit.id } });
      const saleBBefore = await saleRepo.findOne({
        where: { id: saleB.id },
      });

      expect(stockBefore?.quantity).toBe(4); // A's complete decremented from 5
      expect(puBefore?.status).toBe(ProductUnitStatus.SOLD); // A's complete flipped it
      expect(saleBBefore?.status).toBe(SaleStatus.DRAFT); // B still DRAFT

      // Sale B attempts to complete — MUST fail with 409, and the failure
      // MUST leave ZERO partial state. The atomicity crown-jewel.
      const response = await request(app.getHttpServer())
        .post(`/api/v1/sales/${saleB.id}/complete`)
        .set('Cookie', cookies)
        .expect(409);

      expect(response.body.message).toMatch(/status is SOLD/);
      expect(response.body.existing_unit).toMatchObject({
        id: unit.id,
        status: ProductUnitStatus.SOLD,
      });

      // Verify NOTHING changed from Sale B's failed attempt:
      const stockAfter = await stockRepo.findOne({
        where: { product_id: product.id, branch_id: branch.id },
      });
      const puAfter = await puRepo.findOne({ where: { id: unit.id } });
      const saleBAfter = await saleRepo.findOne({
        where: { id: saleB.id },
      });

      // Stock unchanged from A's decrement — B's decrement was rolled back
      // by the PU flip failure. This is the atomicity proof: if PU flip
      // fails, the whole transaction (including Stock decrement) rolls back.
      expect(stockAfter?.quantity).toBe(4);
      // PU unchanged
      expect(puAfter?.status).toBe(ProductUnitStatus.SOLD);
      // Sale B still DRAFT — no partial flip, no sale_number issued
      expect(saleBAfter?.status).toBe(SaleStatus.DRAFT);
      expect(saleBAfter?.sale_number).toBeNull();
      expect(saleBAfter?.completed_at).toBeNull();
    });

    // ---- Void: PU restored ----

    it('voids a serialized in-house sale: PU flipped back to IN_STOCK, stock restored', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const { sale, product, unit } = await seedReadyToCompleteSerialized(
        branch.id,
        user.id,
        cookies,
        { stockQty: 3 },
      );

      // Complete first
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/complete`)
        .set('Cookie', cookies)
        .expect(200);

      // Snapshot post-complete state
      const puRepo = dataSource.getRepository(ProductUnit);
      const stockRepo = dataSource.getRepository(Stock);
      let puState = await puRepo.findOne({ where: { id: unit.id } });
      let stockState = await stockRepo.findOne({
        where: { product_id: product.id, branch_id: branch.id },
      });
      expect(puState?.status).toBe(ProductUnitStatus.SOLD);
      expect(stockState?.quantity).toBe(2); // 3 - 1

      // Void
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/void`)
        .set('Cookie', cookies)
        .send({ void_reason: 'Customer changed mind' })
        .expect(200);

      // PU back to IN_STOCK; stock restored
      puState = await puRepo.findOne({ where: { id: unit.id } });
      stockState = await stockRepo.findOne({
        where: { product_id: product.id, branch_id: branch.id },
      });
      expect(puState?.status).toBe(ProductUnitStatus.IN_STOCK);
      expect(stockState?.quantity).toBe(3); // back to original
    });

    it('voids a mixed sale: only serialized in-house PU is flipped back', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      // Serialized in-house + non-serialized + external serialized
      const serializedProduct = await seedProduct(branch.id, {
        name: 'Serialized',
        is_serialized: true,
        selling_price: '250000.00',
      });
      await setStockQuantity(serializedProduct.id, branch.id, 5);
      const serializedUnit = await seedProductUnit(
        serializedProduct.id,
        branch.id,
        user.id,
        '350000000000020',
        { selling_price: '250000.00' },
      );

      const chargerProduct = await seedProduct(branch.id, {
        name: 'Charger',
        selling_price: '2000.00',
      });
      await setStockQuantity(chargerProduct.id, branch.id, 10);

      const supplier = await dataSource.getRepository(Supplier).save({
        name: 'Friendly Shop',
        is_active: true,
      } as Supplier);
      const externalProduct = await seedProduct(branch.id, {
        name: 'External',
        is_serialized: true,
        selling_price: '180000.00',
      });

      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });

      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({
          product_id: serializedProduct.id,
          quantity: 1,
          imei_snapshot: '350000000000020',
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({ product_id: chargerProduct.id, quantity: 2 })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({
          product_id: externalProduct.id,
          quantity: 1,
          external_supplier_id: supplier.id,
          imei_snapshot: '999888777666666',
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/payments`)
        .set('Cookie', cookies)
        .send({
          payment_method: PaymentMethod.CASH,
          amount: 434000,
          cash_received: 434000,
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/complete`)
        .set('Cookie', cookies)
        .expect(200);

      // Void
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/void`)
        .set('Cookie', cookies)
        .send({ void_reason: 'Full refund requested' })
        .expect(200);

      // Serialized in-house PU flipped back to IN_STOCK
      const puRepo = dataSource.getRepository(ProductUnit);
      const stockRepo = dataSource.getRepository(Stock);
      const puAfter = await puRepo.findOne({
        where: { id: serializedUnit.id },
      });
      expect(puAfter?.status).toBe(ProductUnitStatus.IN_STOCK);

      // Serialized in-house stock: back to 5
      const serializedStock = await stockRepo.findOne({
        where: {
          product_id: serializedProduct.id,
          branch_id: branch.id,
        },
      });
      expect(serializedStock?.quantity).toBe(5);

      // Non-serialized stock: back to 10
      const chargerStock = await stockRepo.findOne({
        where: { product_id: chargerProduct.id, branch_id: branch.id },
      });
      expect(chargerStock?.quantity).toBe(10);
    });

    // ---- Void-then-resell: the key void-back semantics from Q5 ----

    it('void-then-resell: after void, same PU can be sold on a new sale', async () => {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const product = await seedProduct(branch.id, {
        name: 'Resellable',
        is_serialized: true,
        selling_price: '200000.00',
      });
      await setStockQuantity(product.id, branch.id, 3);
      const unit = await seedProductUnit(
        product.id,
        branch.id,
        user.id,
        '350000000000030',
        { selling_price: '200000.00' },
      );

      // First sale: complete then void
      const saleA = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${saleA.id}/lines`)
        .set('Cookie', cookies)
        .send({
          product_id: product.id,
          quantity: 1,
          imei_snapshot: '350000000000030',
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${saleA.id}/payments`)
        .set('Cookie', cookies)
        .send({
          payment_method: PaymentMethod.CASH,
          amount: 200000,
          cash_received: 200000,
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${saleA.id}/complete`)
        .set('Cookie', cookies)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${saleA.id}/void`)
        .set('Cookie', cookies)
        .send({ void_reason: 'Customer changed mind' })
        .expect(200);

      // PU is back to IN_STOCK
      const puRepo = dataSource.getRepository(ProductUnit);
      const puAfterVoid = await puRepo.findOne({ where: { id: unit.id } });
      expect(puAfterVoid?.status).toBe(ProductUnitStatus.IN_STOCK);

      // New sale can add the same IMEI
      const saleB = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
      });
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${saleB.id}/lines`)
        .set('Cookie', cookies)
        .send({
          product_id: product.id,
          quantity: 1,
          imei_snapshot: '350000000000030',
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${saleB.id}/payments`)
        .set('Cookie', cookies)
        .send({
          payment_method: PaymentMethod.CASH,
          amount: 200000,
          cash_received: 200000,
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${saleB.id}/complete`)
        .set('Cookie', cookies)
        .expect(200);

      // PU is SOLD again
      const puAfterResell = await puRepo.findOne({ where: { id: unit.id } });
      expect(puAfterResell?.status).toBe(ProductUnitStatus.SOLD);

      // Two sale_line rows now reference this PU historically — both valid
      const saleLineRepo = dataSource.getRepository(SaleLine);
      const linesReferencingUnit = await saleLineRepo.find({
        where: { product_unit_id: unit.id },
      });
      expect(linesReferencingUnit).toHaveLength(2);
    });
  });

  // ============================================================
  // Slice G — TRADE_IN payments
  // ============================================================

  describe('TRADE_IN payments — Slice G', () => {
    const IMEI_A = '356938035643809';
    const IMEI_B = '490154203237518';

    /**
     * Shared fixture: admin + cookies, a customer (TRADE_IN requires one),
     * a non-serialized "new phone" with stock for the outgoing line, and
     * a serialized "used phone" SKU (stock 0) that trade-ins intake into.
     */
    async function setupTradeIn(opts: { newStockQty?: number } = {}) {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const customer = await seedCustomer({
        name: 'Trade-in Customer',
        phone: '0779990001',
      });
      const newProduct = await seedProduct(branch.id, {
        name: 'New Phone',
        selling_price: '100000.00',
      });
      await setStockQuantity(newProduct.id, branch.id, opts.newStockQty ?? 5);
      const usedProduct = await seedProduct(branch.id, {
        name: 'Used iPhone 12',
        is_serialized: true,
        selling_price: '90000.00',
        buying_price: '60000.00',
      });
      await setStockQuantity(usedProduct.id, branch.id, 0);
      return { branch, user, cookies, customer, newProduct, usedProduct };
    }
    type TradeInCtx = Awaited<ReturnType<typeof setupTradeIn>>;

    /** DRAFT sale with a customer and one New Phone line (total 100000). */
    async function draftWithLine(ctx: TradeInCtx): Promise<Sale> {
      const sale = await seedSale({
        branch_id: ctx.branch.id,
        cashier_id: ctx.user.id,
        customer_id: ctx.customer.id,
      });
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', ctx.cookies)
        .send({ product_id: ctx.newProduct.id, quantity: 1 })
        .expect(201);
      return sale;
    }

    function tradeInBody(
      ctx: TradeInCtx,
      imei: string,
      amount: number,
      extra: Record<string, unknown> = {},
    ) {
      return {
        payment_method: PaymentMethod.TRADE_IN,
        amount,
        trade_in_product_id: ctx.usedProduct.id,
        trade_in_imei: imei,
        trade_in_buying_price: amount,
        trade_in_selling_price: 75000,
        trade_in_notes: 'Screen scratch, battery 89%',
        ...extra,
      };
    }

    function addTradeIn(
      ctx: TradeInCtx,
      saleId: string,
      imei: string,
      amount: number,
      expected = 201,
      extra: Record<string, unknown> = {},
    ) {
      return request(app.getHttpServer())
        .post(`/api/v1/sales/${saleId}/payments`)
        .set('Cookie', ctx.cookies)
        .send(tradeInBody(ctx, imei, amount, extra))
        .expect(expected);
    }

    function addCash(
      ctx: TradeInCtx,
      saleId: string,
      amount: number,
      cashReceived = amount,
    ) {
      return request(app.getHttpServer())
        .post(`/api/v1/sales/${saleId}/payments`)
        .set('Cookie', ctx.cookies)
        .send({
          payment_method: PaymentMethod.CASH,
          amount,
          cash_received: cashReceived,
        })
        .expect(201);
    }

    function completeReq(ctx: TradeInCtx, saleId: string, expected = 200) {
      return request(app.getHttpServer())
        .post(`/api/v1/sales/${saleId}/complete`)
        .set('Cookie', ctx.cookies)
        .expect(expected);
    }

    function voidReq(ctx: TradeInCtx, saleId: string, expected = 200) {
      return request(app.getHttpServer())
        .post(`/api/v1/sales/${saleId}/void`)
        .set('Cookie', ctx.cookies)
        .send({ void_reason: 'Customer changed mind' })
        .expect(expected);
    }

    /**
     * Sell a previously traded-in phone on a fresh sale and complete it.
     * PU selling_price is 75000 (from tradeInBody), so the line is 75000.
     */
    async function resellTradeIn(ctx: TradeInCtx, imei: string): Promise<Sale> {
      const sale = await seedSale({
        branch_id: ctx.branch.id,
        cashier_id: ctx.user.id,
      });
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', ctx.cookies)
        .send({
          product_id: ctx.usedProduct.id,
          quantity: 1,
          imei_snapshot: imei,
        })
        .expect(201);
      await addCash(ctx, sale.id, 75000);
      await completeReq(ctx, sale.id);
      return sale;
    }

    async function stockQty(productId: string, branchId: string) {
      const stock = await dataSource
        .getRepository(Stock)
        .findOne({ where: { product_id: productId, branch_id: branchId } });
      return stock?.quantity;
    }

    function unitByImei(imei: string) {
      return dataSource.getRepository(ProductUnit).findOne({ where: { imei } });
    }

    function purchasesFor(customerId: string) {
      return dataSource
        .getRepository(PhonePurchase)
        .find({ where: { customer_id: customerId } });
    }

    function paymentsOf(saleId: string) {
      return dataSource
        .getRepository(Payment)
        .find({ where: { sale_id: saleId }, order: { created_at: 'ASC' } });
    }

    // ---- POST /payments — TRADE_IN ----

    describe('POST /api/v1/sales/:saleId/payments — TRADE_IN', () => {
      it('records a TRADE_IN payment with all trade-in fields (no inventory yet)', async () => {
        const ctx = await setupTradeIn();
        const sale = await draftWithLine(ctx);

        const response = await addTradeIn(ctx, sale.id, IMEI_A, 60000);

        expect(response.body.amount_paid).toBe('60000.00');
        expect(response.body.payments).toHaveLength(1);
        expect(response.body.payments[0]).toMatchObject({
          payment_method: PaymentMethod.TRADE_IN,
          amount: '60000.00',
          cash_received: null,
          reference_number: null,
          trade_in_product_id: ctx.usedProduct.id,
          trade_in_imei: IMEI_A,
          trade_in_buying_price: '60000.00',
          trade_in_selling_price: '75000.00',
          trade_in_notes: 'Screen scratch, battery 89%',
          trade_in_phone_purchase_id: null,
        });
        // DRAFT: nothing materialized
        expect(await unitByImei(IMEI_A)).toBeNull();
        expect(await purchasesFor(ctx.customer.id)).toHaveLength(0);
        expect(await stockQty(ctx.usedProduct.id, ctx.branch.id)).toBe(0);
      });

      it("returns 400 when the sale's customer has no NIC (P4-13), and records nothing", async () => {
        const ctx = await setupTradeIn();
        await dataSource
          .getRepository(Customer)
          .update(ctx.customer.id, { nic: null });
        const sale = await draftWithLine(ctx);

        const response = await addTradeIn(ctx, sale.id, IMEI_A, 60000, 400);

        expect(response.body.message).toBe(
          "A trade-in needs the customer's NIC",
        );
        expect(await paymentsOf(sale.id)).toHaveLength(0);
      });

      it('returns 400 when a required trade-in field is missing', async () => {
        const ctx = await setupTradeIn();
        const sale = await draftWithLine(ctx);

        const response = await addTradeIn(ctx, sale.id, IMEI_A, 60000, 400, {
          trade_in_imei: undefined,
        });
        expect(response.body.message).toMatch(/TRADE_IN payments require/);
      });

      it('returns 400 when amount does not equal trade_in_buying_price', async () => {
        const ctx = await setupTradeIn();
        const sale = await draftWithLine(ctx);

        const response = await addTradeIn(ctx, sale.id, IMEI_A, 60000, 400, {
          trade_in_buying_price: 55000,
        });
        expect(response.body.message).toMatch(
          /must equal trade_in_buying_price/,
        );
      });

      it('returns 409 with existing_unit when the IMEI is already in inventory', async () => {
        const ctx = await setupTradeIn();
        const existing = await seedProductUnit(
          ctx.usedProduct.id,
          ctx.branch.id,
          ctx.user.id,
          IMEI_A,
        );
        const sale = await draftWithLine(ctx);

        const response = await addTradeIn(ctx, sale.id, IMEI_A, 60000, 409);
        expect(response.body.existing_unit).toMatchObject({
          id: existing.id,
          status: ProductUnitStatus.IN_STOCK,
        });
        expect(await paymentsOf(sale.id)).toHaveLength(0);
      });

      it('returns 401 when unauthenticated', async () => {
        const ctx = await setupTradeIn();
        const sale = await draftWithLine(ctx);

        await request(app.getHttpServer())
          .post(`/api/v1/sales/${sale.id}/payments`)
          .send(tradeInBody(ctx, IMEI_A, 60000))
          .expect(401);
      });

      it('returns 400 when the sale is COMPLETED', async () => {
        const ctx = await setupTradeIn();
        const sale = await draftWithLine(ctx);
        await addCash(ctx, sale.id, 100000);
        await completeReq(ctx, sale.id);

        const response = await addTradeIn(ctx, sale.id, IMEI_A, 60000, 400);
        expect(response.body.message).toMatch(/COMPLETED/);
        expect(await paymentsOf(sale.id)).toHaveLength(1); // just the CASH
      });

      it('GET /sales/:id shows the trade-in fields on the payment', async () => {
        const ctx = await setupTradeIn();
        const sale = await draftWithLine(ctx);
        await addTradeIn(ctx, sale.id, IMEI_A, 60000);

        const response = await request(app.getHttpServer())
          .get(`/api/v1/sales/${sale.id}`)
          .set('Cookie', ctx.cookies)
          .expect(200);

        expect(response.body.payments).toHaveLength(1);
        expect(response.body.payments[0]).toMatchObject({
          payment_method: PaymentMethod.TRADE_IN,
          trade_in_product_id: ctx.usedProduct.id,
          trade_in_imei: IMEI_A,
          trade_in_buying_price: '60000.00',
          trade_in_selling_price: '75000.00',
          trade_in_phone_purchase_id: null,
          // The traded-in product rides along for display (POS payments list)
          trade_in_product: {
            id: ctx.usedProduct.id,
            name: 'Used iPhone 12',
          },
        });
      });

      it('returns 400 when trade_in_selling_price is 0 (would resell for free)', async () => {
        const ctx = await setupTradeIn();
        const sale = await draftWithLine(ctx);

        const response = await addTradeIn(ctx, sale.id, IMEI_A, 60000, 400, {
          trade_in_selling_price: 0,
        });
        expect(response.body.message).toEqual(
          expect.arrayContaining([
            'trade_in_selling_price must not be less than 0.01',
          ]),
        );
        expect(await paymentsOf(sale.id)).toHaveLength(0);
      });

      it('returns 400 when the trade-in product is inactive', async () => {
        const ctx = await setupTradeIn();
        await dataSource
          .getRepository(Product)
          .update(ctx.usedProduct.id, { is_active: false });
        const sale = await draftWithLine(ctx);

        const response = await addTradeIn(ctx, sale.id, IMEI_A, 60000, 400);
        expect(response.body.message).toBe(
          `Trade-in product ${ctx.usedProduct.id} not found or inactive`,
        );
        expect(await paymentsOf(sale.id)).toHaveLength(0);
      });

      it('accepts a second TRADE_IN with a different IMEI on the same sale', async () => {
        const ctx = await setupTradeIn();
        const sale = await draftWithLine(ctx);
        await addTradeIn(ctx, sale.id, IMEI_A, 60000);

        const response = await addTradeIn(ctx, sale.id, IMEI_B, 40000);

        expect(response.body.payments).toHaveLength(2);
        expect(response.body.amount_paid).toBe('100000.00');
        expect(
          response.body.payments.map(
            (p: { trade_in_imei: string }) => p.trade_in_imei,
          ),
        ).toEqual([IMEI_A, IMEI_B]);
      });
    });

    // ---- PATCH /payments/:paymentId — TRADE_IN freeze ----

    describe('PATCH /api/v1/sales/:saleId/payments/:paymentId — TRADE_IN', () => {
      it('returns 400 when patching amount on a TRADE_IN payment', async () => {
        const ctx = await setupTradeIn();
        const sale = await draftWithLine(ctx);
        const added = await addTradeIn(ctx, sale.id, IMEI_A, 60000);
        const paymentId = added.body.payments[0].id as string;

        const response = await request(app.getHttpServer())
          .patch(`/api/v1/sales/${sale.id}/payments/${paymentId}`)
          .set('Cookie', ctx.cookies)
          .send({ amount: 55000 })
          .expect(400);

        expect(response.body.message).toMatch(
          /amount cannot be updated on a TRADE_IN payment/,
        );
        const [payment] = await paymentsOf(sale.id);
        expect(payment.amount).toBe('60000.00');
      });

      it('allows patching notes on a TRADE_IN payment', async () => {
        const ctx = await setupTradeIn();
        const sale = await draftWithLine(ctx);
        const added = await addTradeIn(ctx, sale.id, IMEI_A, 60000);
        const paymentId = added.body.payments[0].id as string;

        const response = await request(app.getHttpServer())
          .patch(`/api/v1/sales/${sale.id}/payments/${paymentId}`)
          .set('Cookie', ctx.cookies)
          .send({ notes: 'Customer kept the case' })
          .expect(200);

        expect(response.body.payments[0]).toMatchObject({
          notes: 'Customer kept the case',
          amount: '60000.00',
          trade_in_buying_price: '60000.00',
        });
      });

      it('still allows patching amount on a non-TRADE_IN payment (regression)', async () => {
        const ctx = await setupTradeIn();
        const sale = await draftWithLine(ctx);
        const added = await addCash(ctx, sale.id, 50000);
        const paymentId = added.body.payments[0].id as string;

        const response = await request(app.getHttpServer())
          .patch(`/api/v1/sales/${sale.id}/payments/${paymentId}`)
          .set('Cookie', ctx.cookies)
          .send({ amount: 40000 })
          .expect(200);

        expect(response.body.payments[0].amount).toBe('40000.00');
        expect(response.body.amount_paid).toBe('40000.00');
      });
    });

    // ---- PATCH /sales/:id — customer lock guard ----

    describe('PATCH /api/v1/sales/:id — TRADE_IN', () => {
      it('PATCH /sales/:id customer_id=null returns 400 when sale has TRADE_IN payment', async () => {
        const ctx = await setupTradeIn();
        const sale = await draftWithLine(ctx);
        await addTradeIn(ctx, sale.id, IMEI_A, 60000);

        const response = await request(app.getHttpServer())
          .patch(`/api/v1/sales/${sale.id}`)
          .set('Cookie', ctx.cookies)
          .send({ customer_id: null })
          .expect(400);

        expect(response.body.message).toMatch(
          /Cannot change or detach the customer/,
        );
        const stored = await dataSource
          .getRepository(Sale)
          .findOneByOrFail({ id: sale.id });
        expect(stored.customer_id).toBe(ctx.customer.id);
      });

      it('PATCH /sales/:id with a different customer_id returns 400 when sale has TRADE_IN payment', async () => {
        const ctx = await setupTradeIn();
        const other = await seedCustomer({
          name: 'Other Customer',
          phone: '0779990002',
        });
        const sale = await draftWithLine(ctx);
        await addTradeIn(ctx, sale.id, IMEI_A, 60000);

        const response = await request(app.getHttpServer())
          .patch(`/api/v1/sales/${sale.id}`)
          .set('Cookie', ctx.cookies)
          .send({ customer_id: other.id })
          .expect(400);

        expect(response.body.message).toMatch(
          /Cannot change or detach the customer/,
        );
        const stored = await dataSource
          .getRepository(Sale)
          .findOneByOrFail({ id: sale.id });
        expect(stored.customer_id).toBe(ctx.customer.id);
      });
    });

    // ---- POST /complete — trade-in materialization ----

    describe('POST /api/v1/sales/:id/complete — TRADE_IN', () => {
      it('materializes the trade-in: PhonePurchase created, PU IN_STOCK, stock incremented, payment stamped', async () => {
        const ctx = await setupTradeIn();
        const sale = await draftWithLine(ctx);
        await addTradeIn(ctx, sale.id, IMEI_A, 60000);
        await addCash(ctx, sale.id, 40000);

        const response = await completeReq(ctx, sale.id);
        expect(response.body.status).toBe(SaleStatus.COMPLETED);

        const purchases = await purchasesFor(ctx.customer.id);
        expect(purchases).toHaveLength(1);
        expect(purchases[0]).toMatchObject({
          branch_id: ctx.branch.id,
          cashier_id: ctx.user.id,
          total_amount: '60000.00',
          notes: 'Screen scratch, battery 89%',
        });

        const unit = await unitByImei(IMEI_A);
        expect(unit).toMatchObject({
          product_id: ctx.usedProduct.id,
          branch_id: ctx.branch.id,
          status: ProductUnitStatus.IN_STOCK,
          buying_price: '60000.00',
          selling_price: '75000.00',
          phone_purchase_id: purchases[0].id,
        });

        // Incoming +1 on the used SKU, outgoing -1 on the new phone
        expect(await stockQty(ctx.usedProduct.id, ctx.branch.id)).toBe(1);
        expect(await stockQty(ctx.newProduct.id, ctx.branch.id)).toBe(4);

        const tradeIn = (await paymentsOf(sale.id)).find(
          (p) => p.payment_method === PaymentMethod.TRADE_IN,
        );
        expect(tradeIn?.trade_in_phone_purchase_id).toBe(purchases[0].id);
      });

      it("returns 400 and rolls back fully when the customer's NIC was cleared after addPayment (P4-13)", async () => {
        const ctx = await setupTradeIn();
        const sale = await draftWithLine(ctx);
        await addTradeIn(ctx, sale.id, IMEI_A, 60000);
        await addCash(ctx, sale.id, 40000);

        // The NIC is cleared on the customer between addPayment and complete.
        await request(app.getHttpServer())
          .patch(`/api/v1/customers/${ctx.customer.id}`)
          .set('Cookie', ctx.cookies)
          .send({ nic: null })
          .expect(200);

        const response = await completeReq(ctx, sale.id, 400);
        expect(response.body.message).toBe(
          "A trade-in needs the customer's NIC",
        );

        // Nothing committed: still DRAFT, no number, no intake, stock untouched
        const after = await dataSource
          .getRepository(Sale)
          .findOneOrFail({ where: { id: sale.id } });
        expect(after.status).toBe(SaleStatus.DRAFT);
        expect(after.sale_number).toBeNull();
        expect(await purchasesFor(ctx.customer.id)).toHaveLength(0);
        expect(await unitByImei(IMEI_A)).toBeNull();
        expect(await stockQty(ctx.usedProduct.id, ctx.branch.id)).toBe(0);
        expect(await stockQty(ctx.newProduct.id, ctx.branch.id)).toBe(5);
        const tradeIn = (await paymentsOf(sale.id)).find(
          (p) => p.payment_method === PaymentMethod.TRADE_IN,
        );
        expect(tradeIn?.trade_in_phone_purchase_id).toBeNull();
      });

      it('returns 409 and rolls back fully when the IMEI was intaken elsewhere after addPayment', async () => {
        const ctx = await setupTradeIn();
        const sale = await draftWithLine(ctx);
        await addTradeIn(ctx, sale.id, IMEI_A, 60000);
        await addCash(ctx, sale.id, 40000);

        // Same IMEI intaken via another path (e.g. direct phone purchase)
        // between addPayment and complete.
        const other = await seedProductUnit(
          ctx.usedProduct.id,
          ctx.branch.id,
          ctx.user.id,
          IMEI_A,
        );

        const response = await completeReq(ctx, sale.id, 409);
        expect(response.body.existing_unit).toMatchObject({ id: other.id });

        // Outgoing decrement rolled back along with everything else
        expect(await stockQty(ctx.newProduct.id, ctx.branch.id)).toBe(5);
        expect(await stockQty(ctx.usedProduct.id, ctx.branch.id)).toBe(0);
        expect(await purchasesFor(ctx.customer.id)).toHaveLength(0);
        expect(
          await dataSource
            .getRepository(ProductUnit)
            .count({ where: { imei: IMEI_A } }),
        ).toBe(1); // only the "other" unit

        const refreshed = await request(app.getHttpServer())
          .get(`/api/v1/sales/${sale.id}`)
          .set('Cookie', ctx.cookies)
          .expect(200);
        expect(refreshed.body.status).toBe(SaleStatus.DRAFT);
        expect(refreshed.body.sale_number).toBeNull();
        const tradeIn = refreshed.body.payments.find(
          (p: { payment_method: string }) =>
            p.payment_method === PaymentMethod.TRADE_IN,
        );
        expect(tradeIn.trade_in_phone_purchase_id).toBeNull();
      });

      it('names the IMEI and the trade-in payment in the IMEI-collision 409 (P5-2)', async () => {
        const ctx = await setupTradeIn();
        const sale = await draftWithLine(ctx);
        const added = await addTradeIn(ctx, sale.id, IMEI_A, 60000);
        const paymentId = (
          added.body.payments as { id: string; payment_method: PaymentMethod }[]
        ).find((p) => p.payment_method === PaymentMethod.TRADE_IN)!.id;
        await addCash(ctx, sale.id, 40000);
        const other = await seedProductUnit(
          ctx.usedProduct.id,
          ctx.branch.id,
          ctx.user.id,
          IMEI_A,
        );

        const response = await completeReq(ctx, sale.id, 409);

        expect(response.body).toMatchObject({
          message: 'IMEI already exists in inventory',
          imei: IMEI_A,
          payment_id: paymentId,
          existing_unit: { id: other.id, status: ProductUnitStatus.IN_STOCK },
        });
      });

      it('names the product when the trade-in product was deactivated after addPayment (P5-2)', async () => {
        const ctx = await setupTradeIn();
        const sale = await draftWithLine(ctx);
        await addTradeIn(ctx, sale.id, IMEI_A, 60000);
        await addCash(ctx, sale.id, 40000);
        await dataSource
          .getRepository(Product)
          .update(ctx.usedProduct.id, { is_active: false });

        const response = await completeReq(ctx, sale.id, 400);

        expect(response.body.message).toBe(
          'Product "Used iPhone 12" is inactive',
        );
        const saleAfter = await dataSource
          .getRepository(Sale)
          .findOne({ where: { id: sale.id } });
        expect(saleAfter?.status).toBe(SaleStatus.DRAFT);
        expect(await purchasesFor(ctx.customer.id)).toHaveLength(0);
      });

      it('returns 409 on insufficient outgoing stock and creates no trade-in inventory', async () => {
        const ctx = await setupTradeIn({ newStockQty: 0 });
        const sale = await draftWithLine(ctx);
        await addTradeIn(ctx, sale.id, IMEI_A, 60000);
        await addCash(ctx, sale.id, 40000);

        const response = await completeReq(ctx, sale.id, 409);
        expect(response.body.message).toMatch(/Insufficient stock/);

        expect(await purchasesFor(ctx.customer.id)).toHaveLength(0);
        expect(await unitByImei(IMEI_A)).toBeNull();
        expect(await stockQty(ctx.usedProduct.id, ctx.branch.id)).toBe(0);
        const saleAfter = await dataSource
          .getRepository(Sale)
          .findOne({ where: { id: sale.id } });
        expect(saleAfter?.status).toBe(SaleStatus.DRAFT);
      });

      it('completes a TRADE_IN + CASH split with change due', async () => {
        const ctx = await setupTradeIn();
        const sale = await draftWithLine(ctx);
        await addTradeIn(ctx, sale.id, IMEI_A, 60000);
        // Customer hands over 50000 cash for the 40000 balance
        await addCash(ctx, sale.id, 40000, 50000);

        const response = await completeReq(ctx, sale.id);

        expect(response.body.status).toBe(SaleStatus.COMPLETED);
        expect(response.body.sale_number).toEqual(expect.any(String));
        expect(response.body.amount_paid).toBe('100000.00');
        expect(response.body.change_due).toBe('10000.00');
        expect(await purchasesFor(ctx.customer.id)).toHaveLength(1);
      });

      it('completes a sale paid entirely by trade-in (zero cash)', async () => {
        const ctx = await setupTradeIn();
        const sale = await draftWithLine(ctx);
        await addTradeIn(ctx, sale.id, IMEI_A, 100000);

        const response = await completeReq(ctx, sale.id);

        expect(response.body.status).toBe(SaleStatus.COMPLETED);
        expect(response.body.amount_paid).toBe('100000.00');
        expect(response.body.change_due).toBe('0.00');
        expect(response.body.payments).toHaveLength(1);
        expect((await unitByImei(IMEI_A))?.status).toBe(
          ProductUnitStatus.IN_STOCK,
        );
      });
    });

    // ---- POST /void — trade-in reversal ----

    describe('POST /api/v1/sales/:id/void — TRADE_IN', () => {
      it('voids a sale with a TRADE_IN: PU RETURNED, used stock decremented, payments reversed', async () => {
        const ctx = await setupTradeIn();
        const sale = await draftWithLine(ctx);
        await addTradeIn(ctx, sale.id, IMEI_A, 60000);
        await addCash(ctx, sale.id, 40000);
        await completeReq(ctx, sale.id);
        expect(await stockQty(ctx.usedProduct.id, ctx.branch.id)).toBe(1);

        const response = await voidReq(ctx, sale.id);
        expect(response.body.status).toBe(SaleStatus.VOIDED);

        expect((await unitByImei(IMEI_A))?.status).toBe(
          ProductUnitStatus.RETURNED,
        );
        expect(await stockQty(ctx.usedProduct.id, ctx.branch.id)).toBe(0);
        expect(await stockQty(ctx.newProduct.id, ctx.branch.id)).toBe(5);
        // PhonePurchase stays as history
        expect(await purchasesFor(ctx.customer.id)).toHaveLength(1);
        for (const p of await paymentsOf(sale.id)) {
          expect(p.reversed_at).not.toBeNull();
        }
      });

      it('returns 409 when the trade-in phone was resold, leaving both sales untouched', async () => {
        const ctx = await setupTradeIn();
        const saleA = await draftWithLine(ctx);
        await addTradeIn(ctx, saleA.id, IMEI_A, 60000);
        await addCash(ctx, saleA.id, 40000);
        await completeReq(ctx, saleA.id);
        const saleB = await resellTradeIn(ctx, IMEI_A);

        const response = await voidReq(ctx, saleA.id, 409);
        expect(response.body.message).toMatch(/resold in a subsequent sale/);
        expect(response.body.existing_unit).toMatchObject({
          status: ProductUnitStatus.SOLD,
        });
        // P6-22: the 409 names the sale to void first.
        const saleBNumber = (
          await dataSource.getRepository(Sale).findOneByOrFail({ id: saleB.id })
        ).sale_number;
        expect(response.body).toMatchObject({
          imei: IMEI_A,
          reason: 'RESOLD',
          later_sale: { id: saleB.id, sale_number: saleBNumber },
        });

        const saleRepo = dataSource.getRepository(Sale);
        expect(
          (await saleRepo.findOne({ where: { id: saleA.id } }))?.status,
        ).toBe(SaleStatus.COMPLETED);
        expect(
          (await saleRepo.findOne({ where: { id: saleB.id } }))?.status,
        ).toBe(SaleStatus.COMPLETED);
        expect((await unitByImei(IMEI_A))?.status).toBe(ProductUnitStatus.SOLD);
      });

      it('reverses both directions on a sale with a serialized outgoing line and a TRADE_IN', async () => {
        const ctx = await setupTradeIn();
        const serialized = await seedProduct(ctx.branch.id, {
          name: 'Serialized New Phone',
          is_serialized: true,
          selling_price: '100000.00',
        });
        await setStockQuantity(serialized.id, ctx.branch.id, 2);
        const outgoing = await seedProductUnit(
          serialized.id,
          ctx.branch.id,
          ctx.user.id,
          '350000000000777',
          { selling_price: '100000.00' },
        );
        const sale = await seedSale({
          branch_id: ctx.branch.id,
          cashier_id: ctx.user.id,
          customer_id: ctx.customer.id,
        });
        await request(app.getHttpServer())
          .post(`/api/v1/sales/${sale.id}/lines`)
          .set('Cookie', ctx.cookies)
          .send({
            product_id: serialized.id,
            quantity: 1,
            imei_snapshot: '350000000000777',
          })
          .expect(201);
        await addTradeIn(ctx, sale.id, IMEI_A, 60000);
        await addCash(ctx, sale.id, 40000);
        await completeReq(ctx, sale.id);

        await voidReq(ctx, sale.id);

        // Outgoing: SOLD → IN_STOCK, stock restored
        const outgoingAfter = await dataSource
          .getRepository(ProductUnit)
          .findOne({ where: { id: outgoing.id } });
        expect(outgoingAfter?.status).toBe(ProductUnitStatus.IN_STOCK);
        expect(await stockQty(serialized.id, ctx.branch.id)).toBe(2);
        // Incoming: IN_STOCK → RETURNED, stock back to 0
        expect((await unitByImei(IMEI_A))?.status).toBe(
          ProductUnitStatus.RETURNED,
        );
        expect(await stockQty(ctx.usedProduct.id, ctx.branch.id)).toBe(0);
      });

      it('reverses both trade-ins on a sale with two TRADE_IN payments', async () => {
        const ctx = await setupTradeIn();
        const sale = await draftWithLine(ctx);
        await addTradeIn(ctx, sale.id, IMEI_A, 60000);
        await addTradeIn(ctx, sale.id, IMEI_B, 40000);
        await completeReq(ctx, sale.id);
        expect(await stockQty(ctx.usedProduct.id, ctx.branch.id)).toBe(2);

        await voidReq(ctx, sale.id);

        expect((await unitByImei(IMEI_A))?.status).toBe(
          ProductUnitStatus.RETURNED,
        );
        expect((await unitByImei(IMEI_B))?.status).toBe(
          ProductUnitStatus.RETURNED,
        );
        expect(await stockQty(ctx.usedProduct.id, ctx.branch.id)).toBe(0);
      });

      it('voids a sale with no TRADE_IN exactly as before (regression)', async () => {
        const ctx = await setupTradeIn();
        const sale = await draftWithLine(ctx);
        await addCash(ctx, sale.id, 100000);
        await completeReq(ctx, sale.id);
        expect(await stockQty(ctx.newProduct.id, ctx.branch.id)).toBe(4);

        const response = await voidReq(ctx, sale.id);

        expect(response.body.status).toBe(SaleStatus.VOIDED);
        expect(await stockQty(ctx.newProduct.id, ctx.branch.id)).toBe(5);
        expect(await stockQty(ctx.usedProduct.id, ctx.branch.id)).toBe(0);
        expect(
          await dataSource
            .getRepository(ProductUnit)
            .count({ where: { status: ProductUnitStatus.RETURNED } }),
        ).toBe(0);
      });
    });

    // ---- Crown jewels: trade-in atomicity ----

    // ---- Buy-back: one ProductUnit row per acquisition ----

    describe('Buy-back — one ProductUnit row per acquisition', () => {
      /**
       * A serialized "new" SKU with one IN_STOCK unit for IMEI_A, so the
       * shop can SELL that exact phone before buying it back on the used
       * SKU (ctx.usedProduct).
       */
      async function seedNewSerializedUnit(ctx: TradeInCtx) {
        const newSerialized = await seedProduct(ctx.branch.id, {
          name: 'iPhone 12 128GB (new)',
          is_serialized: true,
          selling_price: '100000.00',
          buying_price: '85000.00',
        });
        await setStockQuantity(newSerialized.id, ctx.branch.id, 1);
        const unit = await seedProductUnit(
          newSerialized.id,
          ctx.branch.id,
          ctx.user.id,
          IMEI_A,
          { buying_price: '85000.00', selling_price: null },
        );
        return { newSerialized, unit };
      }

      /** Sale A: sell IMEI_A on the new SKU for cash and complete it. */
      async function sellNew(ctx: TradeInCtx, productId: string) {
        const sale = await seedSale({
          branch_id: ctx.branch.id,
          cashier_id: ctx.user.id,
          customer_id: ctx.customer.id,
        });
        await request(app.getHttpServer())
          .post(`/api/v1/sales/${sale.id}/lines`)
          .set('Cookie', ctx.cookies)
          .send({ product_id: productId, quantity: 1, imei_snapshot: IMEI_A })
          .expect(201);
        await addCash(ctx, sale.id, 100000);
        await completeReq(ctx, sale.id);
        return sale;
      }

      /** Trade IMEI_A in for 60000 against a 100000 line, and complete. */
      async function buyBack(ctx: TradeInCtx) {
        const sale = await draftWithLine(ctx);
        await addTradeIn(ctx, sale.id, IMEI_A, 60000);
        await addCash(ctx, sale.id, 40000);
        await completeReq(ctx, sale.id);
        return sale;
      }

      function unitsOf(imei: string) {
        return dataSource
          .getRepository(ProductUnit)
          .find({ where: { imei }, order: { created_at: 'ASC' } });
      }

      function linesOf(saleId: string) {
        return dataSource
          .getRepository(SaleLine)
          .find({ where: { sale_id: saleId } });
      }

      function saleStatus(saleId: string) {
        return dataSource
          .getRepository(Sale)
          .findOneByOrFail({ id: saleId })
          .then((s) => s.status);
      }

      it('CROWN JEWEL: sell (A) → buy back (B) → resell (C) → buy back again (D), each acquisition its own row', async () => {
        const ctx = await setupTradeIn();
        const { newSerialized, unit: u1 } = await seedNewSerializedUnit(ctx);

        // A: the shop sells the phone new.
        const saleA = await sellNew(ctx, newSerialized.id);
        const u1Sold = await dataSource
          .getRepository(ProductUnit)
          .findOneByOrFail({ id: u1.id });
        expect(u1Sold.status).toBe(ProductUnitStatus.SOLD);

        // B: the customer trades it back in. Before buy-back this was
        // 409 "IMEI already exists in inventory".
        const saleB = await buyBack(ctx);
        let units = await unitsOf(IMEI_A);
        expect(units).toHaveLength(2);
        // U1 (sold on A) is history and was not touched.
        expect(units[0]).toEqual(u1Sold);
        // U2 is a new acquisition on the used SKU at the trade-in cost.
        const [paymentB] = (await paymentsOf(saleB.id)).filter(
          (p) => p.payment_method === PaymentMethod.TRADE_IN,
        );
        expect(units[1]).toMatchObject({
          status: ProductUnitStatus.IN_STOCK,
          product_id: ctx.usedProduct.id,
          buying_price: '60000.00',
          selling_price: '75000.00',
          phone_purchase_id: paymentB.trade_in_phone_purchase_id,
        });
        const u2 = units[1];

        // A's line still points at U1 with its original snapshots.
        const [lineA] = await linesOf(saleA.id);
        expect(lineA).toMatchObject({
          product_unit_id: u1.id,
          product_id: newSerialized.id,
          imei_snapshot: IMEI_A,
          cost_price_snapshot: '85000.00',
        });

        // C: the bought-back phone is resold (addLine picks the live U2).
        const saleC = await resellTradeIn(ctx, IMEI_A);
        const [lineC] = await linesOf(saleC.id);
        expect(lineC).toMatchObject({
          product_unit_id: u2.id,
          product_id: ctx.usedProduct.id,
          unit_price: '75000.00',
          cost_price_snapshot: '60000.00',
        });

        // D: bought back a second time.
        await buyBack(ctx);
        units = await unitsOf(IMEI_A);
        expect(units.map((u) => [u.status, u.product_id])).toEqual([
          [ProductUnitStatus.SOLD, newSerialized.id],
          [ProductUnitStatus.SOLD, ctx.usedProduct.id],
          [ProductUnitStatus.IN_STOCK, ctx.usedProduct.id],
        ]);
        // Every acquisition has its own PhonePurchase.
        expect(
          new Set(units.slice(1).map((u) => u.phone_purchase_id)).size,
        ).toBe(2);
        // Stock: new SKU sold once (1 → 0); used SKU +1 (B) −1 (C) +1 (D).
        expect(await stockQty(newSerialized.id, ctx.branch.id)).toBe(0);
        expect(await stockQty(ctx.usedProduct.id, ctx.branch.id)).toBe(1);
      });

      it('blocks voiding the original sale while the bought-back phone is in stock, then unwinds newest-first', async () => {
        const ctx = await setupTradeIn();
        const { newSerialized, unit: u1 } = await seedNewSerializedUnit(ctx);
        const saleA = await sellNew(ctx, newSerialized.id);
        const saleB = await buyBack(ctx);
        const before = await unitsOf(IMEI_A);
        const stockBefore = [
          await stockQty(newSerialized.id, ctx.branch.id),
          await stockQty(ctx.usedProduct.id, ctx.branch.id),
        ];

        // Void A: the phone isn't the customer's to return any more.
        const blocked = await voidReq(ctx, saleA.id, 409);
        expect(blocked.body.message).toMatch(/taken back into stock/);
        expect(blocked.body.existing_unit).toMatchObject({
          id: before[1].id,
          status: ProductUnitStatus.IN_STOCK,
        });
        // P6-22: traded back in on sale B, so B is the sale to void first.
        const saleBNumber = (
          await dataSource.getRepository(Sale).findOneByOrFail({ id: saleB.id })
        ).sale_number;
        expect(blocked.body).toMatchObject({
          imei: IMEI_A,
          reason: 'TAKEN_BACK_ON_SALE',
          later_sale: { id: saleB.id, sale_number: saleBNumber },
        });
        // Nothing moved.
        expect(await saleStatus(saleA.id)).toBe(SaleStatus.COMPLETED);
        expect(await unitsOf(IMEI_A)).toEqual(before);
        expect([
          await stockQty(newSerialized.id, ctx.branch.id),
          await stockQty(ctx.usedProduct.id, ctx.branch.id),
        ]).toEqual(stockBefore);
        expect(
          (await paymentsOf(saleA.id)).every((p) => p.reversed_at === null),
        ).toBe(true);

        // Newest first: void B (U2 → RETURNED), then A (U1 → IN_STOCK).
        await voidReq(ctx, saleB.id);
        await voidReq(ctx, saleA.id);
        const after = await unitsOf(IMEI_A);
        expect(after.map((u) => [u.id, u.status])).toEqual([
          [u1.id, ProductUnitStatus.IN_STOCK],
          [before[1].id, ProductUnitStatus.RETURNED],
        ]);
      });

      it('blocks voiding the original sale while the bought-back phone is resold (SOLD on a later sale)', async () => {
        const ctx = await setupTradeIn();
        const { newSerialized } = await seedNewSerializedUnit(ctx);
        const saleA = await sellNew(ctx, newSerialized.id);
        await buyBack(ctx);
        await resellTradeIn(ctx, IMEI_A);

        const blocked = await voidReq(ctx, saleA.id, 409);
        expect(blocked.body.existing_unit).toMatchObject({
          status: ProductUnitStatus.SOLD,
          product_id: ctx.usedProduct.id,
        });
        expect(await saleStatus(saleA.id)).toBe(SaleStatus.COMPLETED);
      });

      it('refuses for good to void a sale whose phone was bought back on a later phone purchase (P6-22)', async () => {
        const ctx = await setupTradeIn();
        const { newSerialized } = await seedNewSerializedUnit(ctx);
        const saleA = await sellNew(ctx, newSerialized.id);
        // Bought back outright, not as a trade-in on a sale.
        await request(app.getHttpServer())
          .post('/api/v1/phone-purchases')
          .set('Cookie', ctx.cookies)
          .send({
            customer_id: ctx.customer.id,
            branch_id: ctx.branch.id,
            product_id: ctx.usedProduct.id,
            imei: IMEI_A,
            buying_price: 55000,
          })
          .expect(201);

        const blocked = await voidReq(ctx, saleA.id, 409);
        expect(blocked.body).toMatchObject({
          message:
            `This sale can't be voided: the phone (IMEI ${IMEI_A}) was ` +
            'bought back on a later purchase.',
          imei: IMEI_A,
          reason: 'BOUGHT_BACK_ON_PURCHASE',
          later_sale: null,
          existing_unit: {
            status: ProductUnitStatus.IN_STOCK,
            product_id: ctx.usedProduct.id,
          },
        });
        expect(await saleStatus(saleA.id)).toBe(SaleStatus.COMPLETED);
      });

      it('re-rings a voided trade-in: the same IMEI can be traded in again (RETURNED → new row)', async () => {
        const ctx = await setupTradeIn();
        const saleB = await buyBack(ctx);
        await voidReq(ctx, saleB.id);
        expect((await unitsOf(IMEI_A)).map((u) => u.status)).toEqual([
          ProductUnitStatus.RETURNED,
        ]);

        // Before buy-back this was 409 forever (RETURNED blocked the IMEI).
        const saleB2 = await buyBack(ctx);

        const units = await unitsOf(IMEI_A);
        expect(units.map((u) => u.status)).toEqual([
          ProductUnitStatus.RETURNED,
          ProductUnitStatus.IN_STOCK,
        ]);
        const [paymentB2] = await paymentsOf(saleB2.id);
        expect(units[1].phone_purchase_id).toBe(
          paymentB2.trade_in_phone_purchase_id,
        );
        expect(await stockQty(ctx.usedProduct.id, ctx.branch.id)).toBe(1);
      });

      it('still returns 409 when the IMEI is WRITTEN_OFF', async () => {
        const ctx = await setupTradeIn();
        const written = await seedProductUnit(
          ctx.usedProduct.id,
          ctx.branch.id,
          ctx.user.id,
          IMEI_A,
          { status: ProductUnitStatus.WRITTEN_OFF },
        );
        const sale = await draftWithLine(ctx);

        const response = await addTradeIn(ctx, sale.id, IMEI_A, 60000, 409);
        expect(response.body.existing_unit).toMatchObject({
          id: written.id,
          status: ProductUnitStatus.WRITTEN_OFF,
        });
      });

      it('DB: the partial unique index allows history rows but only one live row per IMEI', async () => {
        const ctx = await setupTradeIn();
        await seedProductUnit(
          ctx.usedProduct.id,
          ctx.branch.id,
          ctx.user.id,
          IMEI_A,
          { status: ProductUnitStatus.SOLD },
        );
        await seedProductUnit(
          ctx.usedProduct.id,
          ctx.branch.id,
          ctx.user.id,
          IMEI_A,
          { status: ProductUnitStatus.RETURNED },
        );
        await seedProductUnit(
          ctx.usedProduct.id,
          ctx.branch.id,
          ctx.user.id,
          IMEI_A,
        ); // IN_STOCK

        await expect(
          seedProductUnit(
            ctx.usedProduct.id,
            ctx.branch.id,
            ctx.user.id,
            IMEI_A,
            { status: ProductUnitStatus.WRITTEN_OFF },
          ),
        ).rejects.toMatchObject({
          driverError: expect.objectContaining({
            code: '23505',
            constraint: 'uq_product_units_imei_live',
          }),
        });
        expect(await unitsOf(IMEI_A)).toHaveLength(3);
      });
    });

    describe('TRADE_IN atomicity — crown jewels', () => {
      /**
       * Full-row snapshot of everything a complete/void could touch:
       * the sales, their payments, every PU with the given IMEI, stock
       * for both fixture products, and all PhonePurchases. Comparing
       * before/after with toEqual catches any partial write, including
       * a same-status re-write that bumps updated_at.
       */
      async function snapshot(
        ctx: TradeInCtx,
        saleIds: string[],
        imei: string,
      ) {
        return {
          sales: await dataSource
            .getRepository(Sale)
            .find({ where: { id: In(saleIds) }, order: { id: 'ASC' } }),
          payments: await dataSource
            .getRepository(Payment)
            .find({ where: { sale_id: In(saleIds) }, order: { id: 'ASC' } }),
          units: await dataSource
            .getRepository(ProductUnit)
            .find({ where: { imei }, order: { id: 'ASC' } }),
          stock: await dataSource.getRepository(Stock).find({
            where: {
              product_id: In([ctx.newProduct.id, ctx.usedProduct.id]),
              branch_id: ctx.branch.id,
            },
            order: { product_id: 'ASC' },
          }),
          purchases: await dataSource
            .getRepository(PhonePurchase)
            .find({ order: { id: 'ASC' } }),
        };
      }

      it('CROWN JEWEL: two DRAFTs trading in the same IMEI — second complete gets 409 and leaves zero partial state', async () => {
        const ctx = await setupTradeIn();

        // Both DRAFTs accept the same trade-in IMEI: nothing is
        // materialized until complete, so addPayment's pre-check passes
        // for both.
        const saleA = await draftWithLine(ctx);
        await addTradeIn(ctx, saleA.id, IMEI_A, 60000);
        await addCash(ctx, saleA.id, 40000);
        const saleB = await draftWithLine(ctx);
        await addTradeIn(ctx, saleB.id, IMEI_A, 60000);
        await addCash(ctx, saleB.id, 40000);

        // Sale A wins
        await completeReq(ctx, saleA.id);
        const winner = await unitByImei(IMEI_A);
        expect(winner?.status).toBe(ProductUnitStatus.IN_STOCK);

        const before = await snapshot(ctx, [saleA.id, saleB.id], IMEI_A);
        expect(before.purchases).toHaveLength(1);
        expect(before.units).toHaveLength(1);
        expect(before.stock.map((s) => s.quantity).sort()).toEqual([1, 4]);

        // Sale B loses. Its outgoing decrement runs BEFORE the trade-in
        // loop, so the 409 must roll that back too.
        const response = await completeReq(ctx, saleB.id, 409);
        expect(response.body.message).toMatch(/IMEI already exists/);
        expect(response.body.existing_unit).toMatchObject({
          id: winner!.id,
          status: ProductUnitStatus.IN_STOCK,
          product_id: ctx.usedProduct.id,
        });

        const after = await snapshot(ctx, [saleA.id, saleB.id], IMEI_A);
        expect(after).toEqual(before);

        // Spelled out for the reader: B is untouched DRAFT, unstamped
        const saleBAfter = after.sales.find((s) => s.id === saleB.id);
        expect(saleBAfter?.status).toBe(SaleStatus.DRAFT);
        expect(saleBAfter?.sale_number).toBeNull();
        expect(saleBAfter?.completed_at).toBeNull();
        const saleBTradeIn = after.payments.find(
          (p) =>
            p.sale_id === saleB.id &&
            p.payment_method === PaymentMethod.TRADE_IN,
        );
        expect(saleBTradeIn?.trade_in_phone_purchase_id).toBeNull();
      });

      it('CROWN JEWEL: void blocked by resale — 409, Sale-A stays COMPLETED, Sale-B and the PU untouched', async () => {
        const ctx = await setupTradeIn();

        // Sale A intakes IMEI_A as a trade-in
        const saleA = await draftWithLine(ctx);
        await addTradeIn(ctx, saleA.id, IMEI_A, 60000);
        await addCash(ctx, saleA.id, 40000);
        await completeReq(ctx, saleA.id);

        // Sale B sells that same phone to someone else
        const saleB = await resellTradeIn(ctx, IMEI_A);

        const before = await snapshot(ctx, [saleA.id, saleB.id], IMEI_A);
        expect(before.units).toHaveLength(1);
        expect(before.units[0].status).toBe(ProductUnitStatus.SOLD);
        // used: +1 (A intake) -1 (B sale) = 0; new: 5 - 1 (A) = 4
        expect(before.stock.map((s) => s.quantity).sort()).toEqual([0, 4]);

        // Void A. Its outgoing reversal (new phone stock +1) runs BEFORE
        // the trade-in loop, so the 409 must roll that back too.
        const response = await voidReq(ctx, saleA.id, 409);
        expect(response.body.message).toMatch(/resold in a subsequent sale/);
        expect(response.body.existing_unit).toMatchObject({
          id: before.units[0].id,
          status: ProductUnitStatus.SOLD,
        });

        const after = await snapshot(ctx, [saleA.id, saleB.id], IMEI_A);
        expect(after).toEqual(before);

        // Spelled out for the reader
        const saleAAfter = after.sales.find((s) => s.id === saleA.id);
        expect(saleAAfter?.status).toBe(SaleStatus.COMPLETED);
        expect(saleAAfter?.voided_at).toBeNull();
        expect(after.units[0].status).toBe(ProductUnitStatus.SOLD);
        for (const p of after.payments) {
          expect(p.reversed_at).toBeNull();
        }
      });
    });
  });

  describe('Money in cents + shrink-below-paid guard', () => {
    async function setup(saleOverrides: Partial<Sale> = {}) {
      const branch = await seedBranch();
      const { user, password } = await seedUser(UserRole.ADMIN, 'a@t.com');
      const sale = await seedSale({
        branch_id: branch.id,
        cashier_id: user.id,
        ...saleOverrides,
      });
      const cookies = await loginAndGetCookies(user.email, password);
      return { branch, sale, cookies };
    }

    // B1: total - paid in floats is 50.199999..., which rejected 50.20.
    it.each([
      ['100.30', 50.1, 50.2],
      ['2000.00', 1765.2, 234.8],
      ['150.60', 50.2, 100.4],
    ])(
      'total %s: CARD %s then CASH exact remainder %s succeeds',
      async (total, first, remainder) => {
        const { sale, cookies } = await setup({ total });

        await request(app.getHttpServer())
          .post(`/api/v1/sales/${sale.id}/payments`)
          .set('Cookie', cookies)
          .send({
            payment_method: PaymentMethod.CARD,
            amount: first,
            reference_number: 'AUTH-1',
          })
          .expect(201);

        const response = await request(app.getHttpServer())
          .post(`/api/v1/sales/${sale.id}/payments`)
          .set('Cookie', cookies)
          .send({
            payment_method: PaymentMethod.CASH,
            amount: remainder,
            cash_received: remainder,
          })
          .expect(201);

        expect(response.body.amount_paid).toBe(total);
      },
    );

    it('still rejects a payment one cent over the remainder', async () => {
      const { sale, cookies } = await setup({ total: '100.30' });

      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/payments`)
        .set('Cookie', cookies)
        .send({
          payment_method: PaymentMethod.CARD,
          amount: 50.1,
          reference_number: 'AUTH-1',
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/payments`)
        .set('Cookie', cookies)
        .send({
          payment_method: PaymentMethod.CASH,
          amount: 50.21,
          cash_received: 50.21,
        })
        .expect(400);

      expect(response.body.message).toBe(
        'Payment amount 50.21 exceeds remaining balance 50.20',
      );
    });

    it('PATCH payment to the exact remainder succeeds; one cent over is rejected', async () => {
      const { sale, cookies } = await setup({ total: '100.30' });

      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/payments`)
        .set('Cookie', cookies)
        .send({
          payment_method: PaymentMethod.CARD,
          amount: 50.1,
          reference_number: 'AUTH-1',
        })
        .expect(201);
      const created = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/payments`)
        .set('Cookie', cookies)
        .send({
          payment_method: PaymentMethod.CASH,
          amount: 10,
          cash_received: 10,
        })
        .expect(201);
      const cashId = created.body.payments[1].id;

      const over = await request(app.getHttpServer())
        .patch(`/api/v1/sales/${sale.id}/payments/${cashId}`)
        .set('Cookie', cookies)
        .send({ amount: 50.21, cash_received: 50.21 })
        .expect(400);
      expect(over.body.message).toBe(
        'Payment amount 50.21 exceeds remaining balance 50.20',
      );

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/sales/${sale.id}/payments/${cashId}`)
        .set('Cookie', cookies)
        .send({ amount: 50.2, cash_received: 50.2 })
        .expect(200);

      expect(response.body.amount_paid).toBe('100.30');
    });

    // F2: 100.10 * 3 is 300.29999... in floats.
    it('accepts an AMOUNT discount equal to the full subtotal (100.10 x 3); rejects 300.31', async () => {
      const { branch, sale, cookies } = await setup();
      const product = await seedProduct(branch.id, {
        selling_price: '100.10',
      });

      const over = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({
          product_id: product.id,
          quantity: 3,
          discount_type: DiscountType.AMOUNT,
          discount_value: 300.31,
        })
        .expect(400);
      expect(over.body.message).toBe(
        'Discount amount 300.31 exceeds line subtotal 300.30',
      );

      const response = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({
          product_id: product.id,
          quantity: 3,
          discount_type: DiscountType.AMOUNT,
          discount_value: 300.3,
        })
        .expect(201);

      expect(response.body.lines[0]).toMatchObject({
        discount_amount: '300.30',
        line_total: '0.00',
      });
      expect(response.body.total).toBe('0.00');
    });

    describe('shrinking the total below amount_paid', () => {
      const SHRINK_MESSAGE =
        'Cannot reduce the sale total below the amount already paid. ' +
        'Remove or reduce payments first.';

      // Sale with one line (100.00 x 2 = 200.00), fully paid by CARD.
      async function setupPaidSale() {
        const { branch, sale, cookies } = await setup();
        const product = await seedProduct(branch.id, {
          selling_price: '100.00',
        });
        const created = await request(app.getHttpServer())
          .post(`/api/v1/sales/${sale.id}/lines`)
          .set('Cookie', cookies)
          .send({ product_id: product.id, quantity: 2 })
          .expect(201);
        await request(app.getHttpServer())
          .post(`/api/v1/sales/${sale.id}/payments`)
          .set('Cookie', cookies)
          .send({
            payment_method: PaymentMethod.CARD,
            amount: 200,
            reference_number: 'AUTH-1',
          })
          .expect(201);
        return { sale, cookies, lineId: created.body.lines[0].id as string };
      }

      async function expectSaleUnchanged(saleId: string, lineId: string) {
        const line = await dataSource
          .getRepository(SaleLine)
          .findOneOrFail({ where: { id: lineId } });
        expect(line.quantity).toBe(2);
        expect(line.discount_amount).toBe('0.00');
        expect(line.line_total).toBe('200.00');
        const sale = await dataSource
          .getRepository(Sale)
          .findOneOrFail({ where: { id: saleId } });
        expect(sale.total).toBe('200.00');
        expect(sale.amount_paid).toBe('200.00');
      }

      it('PATCH line reducing quantity → 400, sale unchanged', async () => {
        const { sale, cookies, lineId } = await setupPaidSale();

        const response = await request(app.getHttpServer())
          .patch(`/api/v1/sales/${sale.id}/lines/${lineId}`)
          .set('Cookie', cookies)
          .send({ quantity: 1 })
          .expect(400);

        expect(response.body.message).toBe(SHRINK_MESSAGE);
        await expectSaleUnchanged(sale.id, lineId);
      });

      it('PATCH line raising the discount → 400, sale unchanged', async () => {
        const { sale, cookies, lineId } = await setupPaidSale();

        const response = await request(app.getHttpServer())
          .patch(`/api/v1/sales/${sale.id}/lines/${lineId}`)
          .set('Cookie', cookies)
          .send({ discount_type: DiscountType.AMOUNT, discount_value: 50 })
          .expect(400);

        expect(response.body.message).toBe(SHRINK_MESSAGE);
        await expectSaleUnchanged(sale.id, lineId);
      });

      it('DELETE line → 400, line and sale unchanged', async () => {
        const { sale, cookies, lineId } = await setupPaidSale();

        const response = await request(app.getHttpServer())
          .delete(`/api/v1/sales/${sale.id}/lines/${lineId}`)
          .set('Cookie', cookies)
          .expect(400);

        expect(response.body.message).toBe(SHRINK_MESSAGE);
        await expectSaleUnchanged(sale.id, lineId);
      });
    });
  });
});
