import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { createTestApp, truncateAllTables } from './setup';
import { AuthService } from '../src/auth/auth.service';
import { User } from '../src/users/entities/user.entity';
import { UserRole } from '../src/users/enums/user-role.enum';
import { Branch } from '../src/branches/entities/branch.entity';
import { Customer } from '../src/customers/entities/customer.entity';
import { Sale } from '../src/sales/entities/sale.entity';
import { SaleStatus } from '../src/sales/enums/sale-status.enum';
import { SaleType } from '../src/sales/enums/sale-type.enum';
import { Brand } from '../src/brands/entities/brand.entity';
import { Category } from '../src/categories/entities/category.entity';
import { Product } from '../src/products/entities/product.entity';
import { TrackingMethod } from '../src/products/enums/tracking-method.enum';
import { WarrantyPeriod } from '../src/products/enums/warranty-period.enum';
import { PhonePurchase } from '../src/phone-purchases/entities/phone-purchase.entity';
import { ProductUnit } from '../src/product-units/entities/product-unit.entity';
import { ProductUnitStatus } from '../src/product-units/enums/product-unit-status.enum';
import { SaleLine } from '../src/sales/entities/sale-line.entity';

type Response = request.Response;

/**
 * Branch-scoped reads (Phase 2), through the real endpoints: admins read
 * any branch; managers and cashiers only their own. A list or summary
 * asked for another branch is 403 WRONG_BRANCH; one record at another
 * branch is 404, exactly as a missing id, so its existence isn't revealed.
 * Writes keep their own codes (SALE_WRONG_BRANCH etc.).
 *
 * P2-1: the sales list, detail and daily summary, and customer purchase
 * history (the sales list by customerId). P2-2: the phone-purchase list
 * and detail; POST /phone-purchases keeps its own check. P2-3: the
 * product-unit list and detail (with their sales and phone purchase) and
 * the till's IMEI/serial lookup.
 *
 * Sessions come from AuthService.login: no HTTP logins.
 */
describe('Branch-scoped reads (e2e)', () => {
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

  // ---- Seeding ----

  interface Ctx {
    branchA: Branch;
    branchB: Branch;
    customer: Customer;
    cashierA: User;
    cashierB: User;
    cookies: {
      admin: string[];
      managerA: string[];
      cashierA: string[];
      cashierB: string[];
    };
    /** Completed sales at A (2, one for the customer) and B (1, for the customer). */
    saleA1: Sale;
    saleA2: Sale;
    saleB1: Sale;
  }

  async function seedUser(
    email: string,
    role: UserRole,
    branch: Branch | null,
  ): Promise<User> {
    const users = dataSource.getRepository(User);
    const saved = await users.save(
      users.create({
        email,
        password_hash: await bcrypt.hash('testpass123', 4),
        full_name: email.split('@')[0],
        role,
        is_active: true,
        branch_id: branch?.id ?? null,
      }),
    );
    return users.findOneByOrFail({ id: saved.id });
  }

  async function sessionFor(user: User): Promise<string[]> {
    const tokens = await app.get(AuthService).login(user, null, null);
    return [
      `access_token=${tokens.access_token}`,
      `refresh_token=${tokens.refresh_token}`,
    ];
  }

  let saleSeq = 0;
  async function seedCompletedSale(
    branch: Branch,
    cashier: User,
    total: string,
    customer: Customer | null,
  ): Promise<Sale> {
    saleSeq += 1;
    const repo = dataSource.getRepository(Sale);
    return repo.save(
      repo.create({
        sale_type: SaleType.RETAIL,
        status: SaleStatus.COMPLETED,
        branch_id: branch.id,
        cashier_id: cashier.id,
        customer_id: customer?.id ?? null,
        sale_number: `INV-20261102-${String(saleSeq).padStart(4, '0')}`,
        completed_at: new Date(),
        subtotal: total,
        discount_total: '0',
        tax_total: '0',
        total,
        amount_paid: total,
        change_due: '0',
      }),
    );
  }

  async function setup(): Promise<Ctx> {
    const branches = dataSource.getRepository(Branch);
    const branchA = await branches.save({
      name: 'Branch A',
      is_active: true,
    } as Branch);
    const branchB = await branches.save({
      name: 'Branch B',
      is_active: true,
    } as Branch);
    const admin = await seedUser('admin@scope.test', UserRole.ADMIN, null);
    const managerA = await seedUser(
      'manager.a@scope.test',
      UserRole.MANAGER,
      branchA,
    );
    const cashierA = await seedUser(
      'cashier.a@scope.test',
      UserRole.CASHIER,
      branchA,
    );
    const cashierB = await seedUser(
      'cashier.b@scope.test',
      UserRole.CASHIER,
      branchB,
    );
    const customer = await dataSource.getRepository(Customer).save(
      dataSource.getRepository(Customer).create({
        name: 'Kamal Perera',
        phone: '0771234567',
        nic: '199000000001',
        notes: null,
      }),
    );
    return {
      branchA,
      branchB,
      customer,
      cashierA,
      cashierB,
      cookies: {
        admin: await sessionFor(admin),
        managerA: await sessionFor(managerA),
        cashierA: await sessionFor(cashierA),
        cashierB: await sessionFor(cashierB),
      },
      saleA1: await seedCompletedSale(branchA, cashierA, '1000.00', customer),
      saleA2: await seedCompletedSale(branchA, cashierA, '500.00', null),
      saleB1: await seedCompletedSale(branchB, cashierB, '2000.00', customer),
    };
  }

  // ---- Requests ----

  /**
   * The API allows 10 requests a second per route (config/throttle.ts), and
   * these tests send many GET /sales in a row: each request waits this
   * long first, so the spec stays under the limit instead of getting 429s.
   */
  const REQUEST_GAP_MS = 120;

  /** Send a request and resolve with its response, whatever the status. */
  const send = async (test: request.Test): Promise<Response> => {
    await new Promise((r) => setTimeout(r, REQUEST_GAP_MS));
    return new Promise((resolve, reject) => {
      void test.end((err: unknown, res?: Response) => {
        if (res) resolve(res);
        else reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  };

  const get = (path: string, cookies: string[]) =>
    send(
      request(app.getHttpServer()).get(`/api/v1${path}`).set('Cookie', cookies),
    );

  const ids = (res: Response) =>
    (res.body as { data: { id: string }[] }).data.map((sale) => sale.id).sort();

  const sorted = (...sales: Sale[]) => sales.map((sale) => sale.id).sort();

  /** A list's ids in the order the API returned them. */
  const orderedIds = (res: Response) =>
    (res.body as { data: { id: string }[] }).data.map((row) => row.id);

  const sortedIds = (...rows: { id: string }[]) =>
    rows.map((row) => row.id).sort();

  const WRONG_BRANCH = {
    message: 'You can only access data for your own branch.',
    code: 'WRONG_BRANCH',
  };

  /** Today in Colombo, as the daily summary's from and to. */
  const today = () =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Colombo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

  function expectStatus(res: Response, status: number) {
    if (res.status !== status) {
      throw new Error(
        `Expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`,
      );
    }
  }

  // ---- GET /sales ----

  describe('GET /sales', () => {
    it('an admin lists every branch, or the branch asked for', async () => {
      const ctx = await setup();

      const all = await get('/sales', ctx.cookies.admin);
      const onlyB = await get(
        `/sales?branchId=${ctx.branchB.id}`,
        ctx.cookies.admin,
      );

      expectStatus(all, 200);
      expect(ids(all)).toEqual(sorted(ctx.saleA1, ctx.saleA2, ctx.saleB1));
      expectStatus(onlyB, 200);
      expect(ids(onlyB)).toEqual(sorted(ctx.saleB1));
    });

    it('a manager and a cashier get only their own branch, with branchId left out or their own', async () => {
      const ctx = await setup();

      for (const cookies of [ctx.cookies.managerA, ctx.cookies.cashierA]) {
        for (const path of ['/sales', `/sales?branchId=${ctx.branchA.id}`]) {
          const res = await get(path, cookies);
          expectStatus(res, 200);
          expect(ids(res)).toEqual(sorted(ctx.saleA1, ctx.saleA2));
          expect((res.body as { meta: { total: number } }).meta.total).toBe(2);
        }
      }
      const b = await get('/sales', ctx.cookies.cashierB);
      expect(ids(b)).toEqual(sorted(ctx.saleB1));
    });

    it('staff asking for another branch get 403 WRONG_BRANCH', async () => {
      const ctx = await setup();

      for (const cookies of [ctx.cookies.managerA, ctx.cookies.cashierA]) {
        const res = await get(`/sales?branchId=${ctx.branchB.id}`, cookies);
        expectStatus(res, 403);
        expect(res.body).toMatchObject(WRONG_BRANCH);
      }
    });

    it('search, filters, sorting and pagination still work, inside the branch', async () => {
      const ctx = await setup();

      // Another branch's sale number finds nothing for staff; the admin finds it.
      const staffSearch = await get(
        `/sales?q=${ctx.saleB1.sale_number}`,
        ctx.cookies.cashierA,
      );
      const adminSearch = await get(
        `/sales?q=${ctx.saleB1.sale_number}`,
        ctx.cookies.admin,
      );
      expect(ids(staffSearch)).toEqual([]);
      expect(ids(adminSearch)).toEqual(sorted(ctx.saleB1));

      const ownSearch = await get(
        `/sales?q=${ctx.saleA2.sale_number}`,
        ctx.cookies.cashierA,
      );
      expect(ids(ownSearch)).toEqual(sorted(ctx.saleA2));

      const filtered = await get(
        `/sales?status=COMPLETED&sort=completed_at`,
        ctx.cookies.managerA,
      );
      expectStatus(filtered, 200);
      expect(ids(filtered)).toEqual(sorted(ctx.saleA1, ctx.saleA2));

      const pageTwo = await get('/sales?page=2&limit=1', ctx.cookies.cashierA);
      expectStatus(pageTwo, 200);
      expect(pageTwo.body).toMatchObject({
        data: [expect.objectContaining({ branch_id: ctx.branchA.id })],
        meta: { total: 2, page: 2, limit: 1, totalPages: 2 },
      });
    });
  });

  // ---- GET /sales/:id ----

  describe('GET /sales/:id', () => {
    it('an admin opens a sale at any branch', async () => {
      const ctx = await setup();

      for (const sale of [ctx.saleA1, ctx.saleB1]) {
        const res = await get(`/sales/${sale.id}`, ctx.cookies.admin);
        expectStatus(res, 200);
        expect(res.body).toMatchObject({
          id: sale.id,
          branch: expect.objectContaining({ id: sale.branch_id }),
          lines: [],
          payments: [],
          returns: [],
        });
      }
    });

    it('staff open their own branch’s sale', async () => {
      const ctx = await setup();

      for (const cookies of [ctx.cookies.managerA, ctx.cookies.cashierA]) {
        const res = await get(`/sales/${ctx.saleA1.id}`, cookies);
        expectStatus(res, 200);
        expect((res.body as { id: string }).id).toBe(ctx.saleA1.id);
      }
    });

    it('another branch’s sale is 404 for staff, the same answer as a missing id', async () => {
      const ctx = await setup();

      for (const cookies of [ctx.cookies.managerA, ctx.cookies.cashierA]) {
        const otherBranch = await get(`/sales/${ctx.saleB1.id}`, cookies);
        const missing = await get(`/sales/${randomUUID()}`, cookies);

        expectStatus(otherBranch, 404);
        expectStatus(missing, 404);
        expect(otherBranch.body).toEqual(missing.body);
        expect(JSON.stringify(otherBranch.body)).not.toContain(
          ctx.saleB1.sale_number,
        );
      }
    });
  });

  // ---- GET /sales/daily-summary ----

  describe('GET /sales/daily-summary', () => {
    const range = () => `from=${today()}&to=${today()}`;

    it('staff get their own branch with branchId left out or their own', async () => {
      const ctx = await setup();

      for (const cookies of [ctx.cookies.managerA, ctx.cookies.cashierA]) {
        for (const branchParam of ['', `&branchId=${ctx.branchA.id}`]) {
          const res = await get(
            `/sales/daily-summary?${range()}${branchParam}`,
            cookies,
          );
          expectStatus(res, 200);
          expect(res.body).toMatchObject({
            sales_count: 2,
            sales_amount: '1500.00',
          });
        }
      }
    });

    it('staff asking for another branch get 403 WRONG_BRANCH', async () => {
      const ctx = await setup();

      const res = await get(
        `/sales/daily-summary?${range()}&branchId=${ctx.branchB.id}`,
        ctx.cookies.cashierA,
      );

      expectStatus(res, 403);
      expect(res.body).toMatchObject(WRONG_BRANCH);
    });

    it('an admin gets the branch asked for, and 400 without one', async () => {
      const ctx = await setup();

      const b = await get(
        `/sales/daily-summary?${range()}&branchId=${ctx.branchB.id}`,
        ctx.cookies.admin,
      );
      const none = await get(
        `/sales/daily-summary?${range()}`,
        ctx.cookies.admin,
      );

      expectStatus(b, 200);
      expect(b.body).toEqual({
        sales_count: 1,
        sales_amount: '2000.00',
        quantity_count: 0,
        cost_of_sales: '0',
        return_count: 0,
        return_quantity: 0,
        voided_count: 0,
      });
      expectStatus(none, 400);
    });
  });

  // ---- Customer purchase history (GET /sales?customerId=) ----

  describe('customer purchase history', () => {
    it('an admin sees the customer’s sales at every branch; staff only at their own', async () => {
      const ctx = await setup();
      const path = `/sales?customerId=${ctx.customer.id}&sort=completed_at`;

      const admin = await get(path, ctx.cookies.admin);
      const manager = await get(path, ctx.cookies.managerA);
      const cashier = await get(path, ctx.cookies.cashierA);
      const cashierB = await get(path, ctx.cookies.cashierB);

      expect(ids(admin)).toEqual(sorted(ctx.saleA1, ctx.saleB1));
      expect(ids(manager)).toEqual(sorted(ctx.saleA1));
      expect(ids(cashier)).toEqual(sorted(ctx.saleA1));
      expect(ids(cashierB)).toEqual(sorted(ctx.saleB1));
    });

    it('the customer record itself stays readable by every role', async () => {
      const ctx = await setup();

      for (const cookies of Object.values(ctx.cookies)) {
        const res = await get(`/customers/${ctx.customer.id}`, cookies);
        expectStatus(res, 200);
      }
    });
  });

  // ---- Phone purchases (P2-2) ----

  describe('phone purchases', () => {
    interface PhoneCtx {
      ctx: Ctx;
      otherCustomer: Customer;
      /** Oldest first: A1 (shared customer), A2 (other customer), B1 (shared customer). */
      ppA1: PhonePurchase;
      ppA2: PhonePurchase;
      ppB1: PhonePurchase;
    }

    const seedPhonePurchase = (
      branch: Branch,
      cashier: User,
      customer: Customer,
      total: string,
    ) => {
      const repo = dataSource.getRepository(PhonePurchase);
      return repo.save(
        repo.create({
          customer_id: customer.id,
          branch_id: branch.id,
          cashier_id: cashier.id,
          total_amount: total,
          notes: null,
        }),
      );
    };

    async function phoneSetup(): Promise<PhoneCtx> {
      const ctx = await setup();
      const otherCustomer = await dataSource.getRepository(Customer).save(
        dataSource.getRepository(Customer).create({
          name: 'Nimal Silva',
          phone: '0779876543',
          nic: '199100000002',
          notes: null,
        }),
      );
      // One at a time, so created_at gives them a fixed order.
      const ppA1 = await seedPhonePurchase(
        ctx.branchA,
        ctx.cashierA,
        ctx.customer,
        '41000.00',
      );
      const ppA2 = await seedPhonePurchase(
        ctx.branchA,
        ctx.cashierA,
        otherCustomer,
        '42000.00',
      );
      const ppB1 = await seedPhonePurchase(
        ctx.branchB,
        ctx.cashierB,
        ctx.customer,
        '93000.00',
      );
      return { ctx, otherCustomer, ppA1, ppA2, ppB1 };
    }

    describe('GET /phone-purchases', () => {
      it('an admin lists every branch, or the branch asked for', async () => {
        const { ctx, ppA1, ppA2, ppB1 } = await phoneSetup();

        const all = await get('/phone-purchases', ctx.cookies.admin);
        const onlyB = await get(
          `/phone-purchases?branchId=${ctx.branchB.id}`,
          ctx.cookies.admin,
        );

        expectStatus(all, 200);
        expect(ids(all)).toEqual(sortedIds(ppA1, ppA2, ppB1));
        expectStatus(onlyB, 200);
        expect(ids(onlyB)).toEqual(sortedIds(ppB1));
      });

      it('a manager and a cashier get only their own branch, newest first, with branchId left out or their own', async () => {
        const { ctx, ppA1, ppA2, ppB1 } = await phoneSetup();

        for (const cookies of [ctx.cookies.managerA, ctx.cookies.cashierA]) {
          for (const path of [
            '/phone-purchases',
            `/phone-purchases?branchId=${ctx.branchA.id}`,
          ]) {
            const res = await get(path, cookies);
            expectStatus(res, 200);
            expect(orderedIds(res)).toEqual([ppA2.id, ppA1.id]);
            expect((res.body as { meta: { total: number } }).meta.total).toBe(
              2,
            );
          }
        }
        const b = await get('/phone-purchases', ctx.cookies.cashierB);
        expect(ids(b)).toEqual(sortedIds(ppB1));
      });

      it('staff asking for another branch get 403 WRONG_BRANCH', async () => {
        const { ctx } = await phoneSetup();

        for (const cookies of [ctx.cookies.managerA, ctx.cookies.cashierA]) {
          const res = await get(
            `/phone-purchases?branchId=${ctx.branchB.id}`,
            cookies,
          );
          expectStatus(res, 403);
          expect(res.body).toMatchObject(WRONG_BRANCH);
        }
      });

      it('the customer filter combines with the branch scope', async () => {
        const { ctx, ppA1, ppB1 } = await phoneSetup();
        const path = `/phone-purchases?customer_id=${ctx.customer.id}`;

        const admin = await get(path, ctx.cookies.admin);
        const manager = await get(path, ctx.cookies.managerA);
        const cashier = await get(path, ctx.cookies.cashierA);

        expect(ids(admin)).toEqual(sortedIds(ppA1, ppB1));
        expect(ids(manager)).toEqual(sortedIds(ppA1));
        expect(ids(cashier)).toEqual(sortedIds(ppA1));
      });

      it('pagination stays inside the branch, and meta.total counts only it', async () => {
        const { ctx, ppA1 } = await phoneSetup();

        const pageTwo = await get(
          '/phone-purchases?page=2&limit=1',
          ctx.cookies.cashierA,
        );

        expectStatus(pageTwo, 200);
        expect(orderedIds(pageTwo)).toEqual([ppA1.id]);
        expect(pageTwo.body).toMatchObject({
          meta: { total: 2, page: 2, limit: 1, totalPages: 2 },
        });
      });
    });

    describe('GET /phone-purchases/:id', () => {
      it('an admin opens a purchase at any branch', async () => {
        const { ctx, ppA1, ppB1 } = await phoneSetup();

        for (const purchase of [ppA1, ppB1]) {
          const res = await get(
            `/phone-purchases/${purchase.id}`,
            ctx.cookies.admin,
          );
          expectStatus(res, 200);
          expect(res.body).toMatchObject({
            id: purchase.id,
            branch: expect.objectContaining({ id: purchase.branch_id }),
            customer: expect.objectContaining({ id: purchase.customer_id }),
          });
        }
      });

      it('staff open their own branch’s purchase', async () => {
        const { ctx, ppA1 } = await phoneSetup();

        for (const cookies of [ctx.cookies.managerA, ctx.cookies.cashierA]) {
          const res = await get(`/phone-purchases/${ppA1.id}`, cookies);
          expectStatus(res, 200);
          expect((res.body as { id: string }).id).toBe(ppA1.id);
        }
      });

      it('another branch’s purchase is 404 for staff, the same answer as a missing id, with nothing of it in the body', async () => {
        const { ctx, ppB1 } = await phoneSetup();

        for (const cookies of [ctx.cookies.managerA, ctx.cookies.cashierA]) {
          const otherBranch = await get(`/phone-purchases/${ppB1.id}`, cookies);
          const missing = await get(
            `/phone-purchases/${randomUUID()}`,
            cookies,
          );

          expectStatus(otherBranch, 404);
          expectStatus(missing, 404);
          expect(otherBranch.body).toEqual(missing.body);
          const text = JSON.stringify(otherBranch.body);
          for (const detail of [
            ppB1.id,
            ppB1.total_amount,
            ctx.customer.id,
            ctx.customer.nic!,
          ]) {
            expect(text).not.toContain(detail);
          }
        }
      });
    });

    describe('POST /phone-purchases (unchanged)', () => {
      async function seedPhoneModel(branch: Branch): Promise<Product> {
        const brand = await dataSource
          .getRepository(Brand)
          .save({ name: 'ScopeBrand', is_active: true } as Brand);
        const category = await dataSource
          .getRepository(Category)
          .save({ name: 'ScopeCategory', is_active: true } as Category);
        const products = dataSource.getRepository(Product);
        return products.save(
          products.create({
            product_type: null,
            name: 'iPhone 13 Used',
            sku: 'SKU-SCOPE-PHONE',
            barcode: 'BC-SCOPE-PHONE',
            brand_id: brand.id,
            category_id: category.id,
            branch_id: branch.id,
            buying_price: '50000.00',
            selling_price: '65000.00',
            is_active: true,
            is_serialized: true,
            tracking_method: TrackingMethod.IMEI,
            default_warranty: WarrantyPeriod.MONTH_1,
          }),
        );
      }

      const post = (path: string, cookies: string[], body: object) =>
        send(
          request(app.getHttpServer())
            .post(`/api/v1${path}`)
            .set('Cookie', cookies)
            .send(body),
        );

      it('a cashier intaking at their own branch still succeeds (201)', async () => {
        const ctx = await setup();
        const phone = await seedPhoneModel(ctx.branchA);

        const res = await post('/phone-purchases', ctx.cookies.cashierA, {
          customer_id: ctx.customer.id,
          branch_id: ctx.branchA.id,
          product_id: phone.id,
          imei: '356938035643810',
          buying_price: 50000,
        });

        expectStatus(res, 201);
        expect(res.body).toMatchObject({
          branch_id: ctx.branchA.id,
          customer: expect.objectContaining({ id: ctx.customer.id }),
          product_units: [
            expect.objectContaining({ imei_number: '356938035643810' }),
          ],
        });
      });

      it('a cashier intaking at another branch is still 403, with the same message', async () => {
        const ctx = await setup();

        const res = await post('/phone-purchases', ctx.cookies.cashierA, {
          customer_id: ctx.customer.id,
          branch_id: ctx.branchB.id,
          product_id: randomUUID(),
          imei: '356938035643828',
          buying_price: 50000,
        });

        expectStatus(res, 403);
        expect(res.body).toMatchObject({
          message: 'You can only intake phones at your own branch',
        });
        expect(await dataSource.getRepository(PhonePurchase).count()).toBe(0);
      });
    });
  });

  // ---- Product units and the till lookup (P2-3) ----

  describe('product units', () => {
    const IMEI_A_IN_STOCK = '356938035641001';
    const IMEI_A_SOLD = '356938035641002';
    const IMEI_A_INSPECTION = '356938035641003';
    const IMEI_B_IN_STOCK = '356938035642001';
    const SERIAL_A_IN_STOCK = 'SN-HUB-A0001';

    interface UnitCtx {
      ctx: Ctx;
      phone: Product;
      hub: Product;
      phonePurchaseA: PhonePurchase;
      /** IN_STOCK, bought from the shared customer (phone purchase at A). */
      unitA1: ProductUnit;
      /** SOLD on saleA1. */
      unitA2: ProductUnit;
      /** INSPECTION. */
      unitA3: ProductUnit;
      /** A serial-tracked hub, IN_STOCK. */
      unitA4: ProductUnit;
      /** IN_STOCK at B. */
      unitB1: ProductUnit;
    }

    async function seedModel(
      name: string,
      tracking: TrackingMethod,
      suffix: string,
    ): Promise<Product> {
      const brand = await dataSource
        .getRepository(Brand)
        .save({ name: `UnitBrand ${suffix}`, is_active: true } as Brand);
      const category = await dataSource
        .getRepository(Category)
        .save({ name: `UnitCategory ${suffix}`, is_active: true } as Category);
      const products = dataSource.getRepository(Product);
      return products.save(
        products.create({
          product_type: null,
          name,
          sku: `SKU-UNIT-${suffix}`,
          barcode: `BC-UNIT-${suffix}`,
          brand_id: brand.id,
          category_id: category.id,
          branch_id: null,
          buying_price: '50000.00',
          selling_price: '65000.00',
          is_active: true,
          is_serialized: true,
          tracking_method: tracking,
          default_warranty: WarrantyPeriod.MONTH_1,
        }),
      );
    }

    const seedUnit = (fields: Partial<ProductUnit>) => {
      const units = dataSource.getRepository(ProductUnit);
      return units.save(
        units.create({
          imei_number: null,
          serial_number: null,
          buying_price: '50000.00',
          selling_price: '65000.00',
          phone_purchase_id: null,
          ...fields,
        }),
      );
    };

    async function unitSetup(): Promise<UnitCtx> {
      const ctx = await setup();
      const phone = await seedModel(
        'iPhone 12 Used',
        TrackingMethod.IMEI,
        'PH',
      );
      const hub = await seedModel(
        'UGREEN Hub',
        TrackingMethod.SERIAL_NUMBER,
        'HUB',
      );
      const phonePurchaseA = await dataSource.getRepository(PhonePurchase).save(
        dataSource.getRepository(PhonePurchase).create({
          customer_id: ctx.customer.id,
          branch_id: ctx.branchA.id,
          cashier_id: ctx.cashierA.id,
          total_amount: '50000.00',
          notes: null,
        }),
      );
      const imeiUnit = (
        branch: Branch,
        imei: string,
        status: ProductUnitStatus,
        extra: Partial<ProductUnit> = {},
      ) =>
        seedUnit({
          product_id: phone.id,
          branch_id: branch.id,
          imei,
          imei_number: imei,
          status,
          ...extra,
        });
      const unitA1 = await imeiUnit(
        ctx.branchA,
        IMEI_A_IN_STOCK,
        ProductUnitStatus.IN_STOCK,
        { phone_purchase_id: phonePurchaseA.id },
      );
      const unitA2 = await imeiUnit(
        ctx.branchA,
        IMEI_A_SOLD,
        ProductUnitStatus.SOLD,
      );
      const unitA3 = await imeiUnit(
        ctx.branchA,
        IMEI_A_INSPECTION,
        ProductUnitStatus.INSPECTION,
      );
      const unitA4 = await seedUnit({
        product_id: hub.id,
        branch_id: ctx.branchA.id,
        imei: SERIAL_A_IN_STOCK,
        serial_number: SERIAL_A_IN_STOCK,
        status: ProductUnitStatus.IN_STOCK,
      });
      const unitB1 = await imeiUnit(
        ctx.branchB,
        IMEI_B_IN_STOCK,
        ProductUnitStatus.IN_STOCK,
      );
      // unitA2 was sold on saleA1 (branch A).
      await dataSource.getRepository(SaleLine).save(
        dataSource.getRepository(SaleLine).create({
          sale_id: ctx.saleA1.id,
          line_number: 1,
          product_id: phone.id,
          product_sku_snapshot: phone.sku,
          product_name_snapshot: phone.name,
          unit_price: '1000.00',
          cost_price_snapshot: '500.00',
          quantity: 1,
          discount_amount: '0',
          line_total: '1000.00',
          imei_snapshot: IMEI_A_SOLD,
          warranty: WarrantyPeriod.MONTH_1,
          product_unit_id: unitA2.id,
        }),
      );
      return {
        ctx,
        phone,
        hub,
        phonePurchaseA,
        unitA1,
        unitA2,
        unitA3,
        unitA4,
        unitB1,
      };
    }

    const unitsAtA = (u: UnitCtx) =>
      sortedIds(u.unitA1, u.unitA2, u.unitA3, u.unitA4);

    describe('GET /product-units', () => {
      it('an admin lists every branch, or the branch asked for', async () => {
        const u = await unitSetup();

        const all = await get('/product-units', u.ctx.cookies.admin);
        const onlyB = await get(
          `/product-units?branchId=${u.ctx.branchB.id}`,
          u.ctx.cookies.admin,
        );

        expectStatus(all, 200);
        expect(ids(all)).toEqual(
          sortedIds(u.unitA1, u.unitA2, u.unitA3, u.unitA4, u.unitB1),
        );
        expectStatus(onlyB, 200);
        expect(ids(onlyB)).toEqual(sortedIds(u.unitB1));
      });

      it('a manager gets only their own branch, with branchId left out or their own', async () => {
        const u = await unitSetup();

        for (const path of [
          '/product-units',
          `/product-units?branchId=${u.ctx.branchA.id}`,
        ]) {
          const res = await get(path, u.ctx.cookies.managerA);
          expectStatus(res, 200);
          expect(ids(res)).toEqual(unitsAtA(u));
          expect((res.body as { meta: { total: number } }).meta.total).toBe(4);
        }
      });

      it('a manager asking for another branch gets 403 WRONG_BRANCH; a cashier still gets 403 by role', async () => {
        const u = await unitSetup();

        const manager = await get(
          `/product-units?branchId=${u.ctx.branchB.id}`,
          u.ctx.cookies.managerA,
        );
        const cashier = await get('/product-units', u.ctx.cookies.cashierA);

        expectStatus(manager, 403);
        expect(manager.body).toMatchObject(WRONG_BRANCH);
        expectStatus(cashier, 403);
      });

      it('status, IMEI and product filters, and pagination, stay inside the branch', async () => {
        const u = await unitSetup();
        const manager = u.ctx.cookies.managerA;

        const inStock = await get('/product-units?status=IN_STOCK', manager);
        const byImei = await get(
          `/product-units?imei=${IMEI_B_IN_STOCK}`,
          manager,
        );
        const byProduct = await get(
          `/product-units?productId=${u.phone.id}`,
          manager,
        );
        const pageTwo = await get('/product-units?page=2&limit=3', manager);

        expect(ids(inStock)).toEqual(sortedIds(u.unitA1, u.unitA4));
        // Branch B's IMEI: found by the admin, not by a branch-A manager.
        expect(ids(byImei)).toEqual([]);
        expect(ids(byProduct)).toEqual(sortedIds(u.unitA1, u.unitA2, u.unitA3));
        expectStatus(pageTwo, 200);
        expect(pageTwo.body).toMatchObject({
          data: [expect.objectContaining({ branch_id: u.ctx.branchA.id })],
          meta: { total: 4, page: 2, limit: 3, totalPages: 2 },
        });
      });
    });

    describe('GET /product-units/:id', () => {
      it('an admin opens a unit at any branch', async () => {
        const u = await unitSetup();

        for (const unit of [u.unitA1, u.unitB1]) {
          const res = await get(
            `/product-units/${unit.id}`,
            u.ctx.cookies.admin,
          );
          expectStatus(res, 200);
          expect(res.body).toMatchObject({
            id: unit.id,
            branch: expect.objectContaining({ id: unit.branch_id }),
          });
        }
      });

      it('a manager opens their own branch’s unit, with its sale and its seller', async () => {
        const u = await unitSetup();

        const sold = await get(
          `/product-units/${u.unitA2.id}`,
          u.ctx.cookies.managerA,
        );
        const bought = await get(
          `/product-units/${u.unitA1.id}`,
          u.ctx.cookies.managerA,
        );

        expectStatus(sold, 200);
        expect(sold.body).toMatchObject({
          id: u.unitA2.id,
          sale_lines: [
            expect.objectContaining({
              sale: expect.objectContaining({
                id: u.ctx.saleA1.id,
                branch_id: u.ctx.branchA.id,
              }),
            }),
          ],
        });
        expectStatus(bought, 200);
        expect(bought.body).toMatchObject({
          phone_purchase: expect.objectContaining({
            id: u.phonePurchaseA.id,
            branch_id: u.ctx.branchA.id,
            customer: expect.objectContaining({ id: u.ctx.customer.id }),
          }),
        });
      });

      it('another branch’s unit is 404 for a manager, the same answer as a missing id, with nothing of it in the body', async () => {
        const u = await unitSetup();

        const otherBranch = await get(
          `/product-units/${u.unitB1.id}`,
          u.ctx.cookies.managerA,
        );
        const missing = await get(
          `/product-units/${randomUUID()}`,
          u.ctx.cookies.managerA,
        );

        expectStatus(otherBranch, 404);
        expectStatus(missing, 404);
        expect(otherBranch.body).toEqual(missing.body);
        const text = JSON.stringify(otherBranch.body);
        for (const detail of [u.unitB1.id, IMEI_B_IN_STOCK]) {
          expect(text).not.toContain(detail);
        }
      });
    });

    describe('GET /product-units/sellable/by-identifier/:identifier (till lookup)', () => {
      const lookup = (identifier: string, branch: Branch, cookies: string[]) =>
        get(
          `/product-units/sellable/by-identifier/${identifier}?branchId=${branch.id}`,
          cookies,
        );

      it('a cashier and a manager find an in-stock IMEI and serial number at their own branch', async () => {
        const u = await unitSetup();

        for (const cookies of [
          u.ctx.cookies.cashierA,
          u.ctx.cookies.managerA,
        ]) {
          const phone = await lookup(IMEI_A_IN_STOCK, u.ctx.branchA, cookies);
          const hub = await lookup(SERIAL_A_IN_STOCK, u.ctx.branchA, cookies);

          expectStatus(phone, 200);
          expect(phone.body).toMatchObject({
            identifier: IMEI_A_IN_STOCK,
            identifierType: TrackingMethod.IMEI,
            unitId: u.unitA1.id,
            product: expect.objectContaining({ id: u.phone.id }),
          });
          expectStatus(hub, 200);
          expect(hub.body).toMatchObject({
            identifier: SERIAL_A_IN_STOCK,
            identifierType: TrackingMethod.SERIAL_NUMBER,
            unitId: u.unitA4.id,
          });
        }
      });

      it('a unit at their branch that is not in stock keeps its 409', async () => {
        const u = await unitSetup();

        const res = await lookup(
          IMEI_A_INSPECTION,
          u.ctx.branchA,
          u.ctx.cookies.cashierA,
        );

        expectStatus(res, 409);
        expect(res.body).toMatchObject({
          existing_unit: {
            id: u.unitA3.id,
            branch_id: u.ctx.branchA.id,
            status: ProductUnitStatus.INSPECTION,
          },
        });
      });

      it('staff asking for another branch get 403 WRONG_BRANCH', async () => {
        const u = await unitSetup();

        for (const cookies of [
          u.ctx.cookies.cashierA,
          u.ctx.cookies.managerA,
        ]) {
          const res = await lookup(IMEI_B_IN_STOCK, u.ctx.branchB, cookies);
          expectStatus(res, 403);
          expect(res.body).toMatchObject(WRONG_BRANCH);
        }
      });

      it('an identifier only branch B holds is 404 at branch A', async () => {
        const u = await unitSetup();

        const res = await lookup(
          IMEI_B_IN_STOCK,
          u.ctx.branchA,
          u.ctx.cookies.cashierA,
        );

        expectStatus(res, 404);
      });

      it('an admin looks up any branch', async () => {
        const u = await unitSetup();

        const res = await lookup(
          IMEI_B_IN_STOCK,
          u.ctx.branchB,
          u.ctx.cookies.admin,
        );

        expectStatus(res, 200);
        expect(res.body).toMatchObject({
          unitId: u.unitB1.id,
          identifierType: TrackingMethod.IMEI,
        });
      });

      it('branchId is still required and must be a UUID (400)', async () => {
        const u = await unitSetup();

        const missing = await get(
          `/product-units/sellable/by-identifier/${IMEI_A_IN_STOCK}`,
          u.ctx.cookies.cashierA,
        );
        const invalid = await get(
          `/product-units/sellable/by-identifier/${IMEI_A_IN_STOCK}?branchId=not-a-uuid`,
          u.ctx.cookies.cashierA,
        );

        expectStatus(missing, 400);
        expectStatus(invalid, 400);
      });

      it('adding a branch-B unit to a branch-A sale is still refused', async () => {
        const u = await unitSetup();
        const sales = dataSource.getRepository(Sale);
        const draft = await sales.save(
          sales.create({
            sale_type: SaleType.RETAIL,
            status: SaleStatus.DRAFT,
            branch_id: u.ctx.branchA.id,
            cashier_id: u.ctx.cashierA.id,
            subtotal: '0',
            discount_total: '0',
            tax_total: '0',
            total: '0',
            amount_paid: '0',
            change_due: '0',
          }),
        );

        const res = await send(
          request(app.getHttpServer())
            .post(`/api/v1/sales/${draft.id}/lines`)
            .set('Cookie', u.ctx.cookies.cashierA)
            .send({
              product_id: u.phone.id,
              quantity: 1,
              imei_snapshot: IMEI_B_IN_STOCK,
            }),
        );

        expectStatus(res, 400);
        expect(JSON.stringify(res.body)).toContain(
          'is not available at this branch',
        );
      });
    });
  });

  // ---- Writes are unchanged ----

  it('changing another branch’s sale is still 403 SALE_WRONG_BRANCH', async () => {
    const ctx = await setup();

    const res = await send(
      request(app.getHttpServer())
        .patch(`/api/v1/sales/${ctx.saleB1.id}`)
        .set('Cookie', ctx.cookies.cashierA)
        .send({ notes: 'Not mine' }),
    );

    expectStatus(res, 403);
    expect(res.body).toMatchObject({ code: 'SALE_WRONG_BRANCH' });
  });
});
