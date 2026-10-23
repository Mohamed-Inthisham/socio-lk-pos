import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { DataSource, QueryFailedError } from 'typeorm';
import { createTestApp, truncateAllTables } from './setup';
import { User } from '../src/users/entities/user.entity';
import { UserRole } from '../src/users/enums/user-role.enum';
import { Sale } from '../src/sales/entities/sale.entity';
import { SaleStatus } from '../src/sales/enums/sale-status.enum';
import { SaleType } from '../src/sales/enums/sale-type.enum';
import { PaymentMethod } from '../src/sales/enums/payment-method.enum';
import { Branch } from '../src/branches/entities/branch.entity';
import { Brand } from '../src/brands/entities/brand.entity';
import { Category } from '../src/categories/entities/category.entity';
import { Product } from '../src/products/entities/product.entity';
import { ProductType } from '../src/products/enums/product-type.enum';
import { WarrantyPeriod } from '../src/products/enums/warranty-period.enum';
import { Stock } from '../src/stock/entities/stock.entity';
import { Customer } from '../src/customers/entities/customer.entity';
import { Supplier } from '../src/suppliers/entities/supplier.entity';
import { ProductUnit } from '../src/product-units/entities/product-unit.entity';
import { ProductUnitStatus } from '../src/product-units/enums/product-unit-status.enum';
import { PhonePurchase } from '../src/phone-purchases/entities/phone-purchase.entity';
import { AuditLog } from '../src/audit-log/entities/audit-log.entity';
import { AuditAction } from '../src/audit-log/enums/audit-action.enum';

/**
 * The INSPECTION unit status (Phase 6.4 P7-6, P7-7; step 0a). A returned
 * phone waits in INSPECTION: held by the shop (live in
 * uq_product_units_imei_live) but not sellable, until a manager or admin
 * passes it back to IN_STOCK.
 *
 * Nothing creates INSPECTION units through the API until returns ship
 * (step 0b), so these tests set the status directly in the database.
 */
describe('INSPECTION status (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  const IMEI = '356938035643809';
  const OTHER_IMEI = '490154203237518';

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

  async function seedBranch(name: string): Promise<Branch> {
    return dataSource
      .getRepository(Branch)
      .save({ name, is_active: true } as Branch);
  }

  async function seedUser(
    role: UserRole,
    email: string,
    branch: Branch | null,
  ): Promise<{ user: User; cookies: string[] }> {
    const password = 'testpass123';
    const user = await dataSource.getRepository(User).save(
      dataSource.getRepository(User).create({
        email,
        password_hash: await bcrypt.hash(password, 4),
        full_name: `Test ${role} ${email}`,
        role,
        is_active: true,
        branch_id: role === UserRole.ADMIN ? null : branch!.id,
      }),
    );
    // Login throttle (FOLLOWUPS "Login throttle limit is not env-driven").
    await new Promise((r) => setTimeout(r, 500));
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return {
      user,
      cookies: login.headers['set-cookie'] as unknown as string[],
    };
  }

  async function seedCustomer(): Promise<Customer> {
    return dataSource.getRepository(Customer).save(
      dataSource.getRepository(Customer).create({
        name: 'Kamal Perera',
        phone: '0771234567',
        nic: '199000000001',
        notes: null,
      }),
    );
  }

  async function seedProduct(
    branch: Branch,
    name: string,
    opts: { serialized?: boolean; stock?: number } = {},
  ): Promise<Product> {
    const brand =
      (await dataSource.getRepository(Brand).findOne({ where: {} })) ??
      (await dataSource
        .getRepository(Brand)
        .save({ name: 'TestBrand', is_active: true } as Brand));
    const category =
      (await dataSource.getRepository(Category).findOne({ where: {} })) ??
      (await dataSource
        .getRepository(Category)
        .save({ name: 'TestCategory', is_active: true } as Category));
    const suffix = Math.random().toString(36).slice(2, 8);
    const product = await dataSource.getRepository(Product).save(
      dataSource.getRepository(Product).create({
        product_type: ProductType.PHONE,
        name,
        sku: `SKU-INSP-${suffix}`,
        barcode: `BC-INSP-${suffix}`,
        brand_id: brand.id,
        category_id: category.id,
        branch_id: branch.id,
        buying_price: '500.00',
        selling_price: '1000.00',
        is_active: true,
        is_serialized: opts.serialized ?? true,
        default_warranty: WarrantyPeriod.NO_WARRANTY,
      }),
    );
    await dataSource.getRepository(Stock).save(
      dataSource.getRepository(Stock).create({
        product_id: product.id,
        branch_id: branch.id,
        quantity: opts.stock ?? 0,
        min_quantity: 0,
        manage_stock: true,
      }),
    );
    return product;
  }

  async function seedUnit(
    product: Product,
    customer: Customer,
    cashier: User,
    imei: string,
    status: ProductUnitStatus,
  ): Promise<ProductUnit> {
    const purchase = await dataSource.getRepository(PhonePurchase).save(
      dataSource.getRepository(PhonePurchase).create({
        customer_id: customer.id,
        branch_id: product.branch_id,
        cashier_id: cashier.id,
        total_amount: '500.00',
        notes: null,
      }),
    );
    return dataSource.getRepository(ProductUnit).save(
      dataSource.getRepository(ProductUnit).create({
        product_id: product.id,
        branch_id: product.branch_id,
        imei,
        status,
        buying_price: '500.00',
        selling_price: null,
        phone_purchase_id: purchase.id,
      }),
    );
  }

  /** An empty DRAFT at the branch, for lines and payments over HTTP. */
  async function seedEmptyDraft(
    branch: Branch,
    cashier: User,
    customer: Customer | null = null,
  ): Promise<Sale> {
    return dataSource.getRepository(Sale).save(
      dataSource.getRepository(Sale).create({
        sale_type: SaleType.RETAIL,
        status: SaleStatus.DRAFT,
        branch_id: branch.id,
        cashier_id: cashier.id,
        customer_id: customer?.id ?? null,
        subtotal: '0',
        discount_total: '0',
        tax_total: '0',
        total: '0',
        amount_paid: '0',
        change_due: '0',
      }),
    );
  }

  const setStatus = (unit: ProductUnit, status: ProductUnitStatus) =>
    dataSource.getRepository(ProductUnit).update(unit.id, { status });

  async function stockQty(product: Product): Promise<number | undefined> {
    const row = await dataSource
      .getRepository(Stock)
      .findOne({ where: { product_id: product.id } });
    return row?.quantity;
  }

  async function unitStatus(unit: ProductUnit): Promise<ProductUnitStatus> {
    return (
      await dataSource
        .getRepository(ProductUnit)
        .findOneByOrFail({ id: unit.id })
    ).status;
  }

  const passInspection = (cookies: string[], unitId: string) =>
    request(app.getHttpServer())
      .post(`/api/v1/product-units/${unitId}/inspection-pass`)
      .set('Cookie', cookies);

  // ---- The live index and intake ----

  describe('an INSPECTION unit holds its IMEI (live)', () => {
    it('the live-IMEI index refuses a second live unit for that IMEI', async () => {
      const branch = await seedBranch('Main Shop');
      const { user } = await seedUser(UserRole.ADMIN, 'a@t.com', null);
      const customer = await seedCustomer();
      const used = await seedProduct(branch, 'Used iPhone 12');
      await seedUnit(used, customer, user, IMEI, ProductUnitStatus.INSPECTION);

      const err = await seedUnit(
        used,
        customer,
        user,
        IMEI,
        ProductUnitStatus.IN_STOCK,
      ).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(QueryFailedError);
      expect(
        ((err as QueryFailedError).driverError as { constraint?: string })
          .constraint,
      ).toBe('uq_product_units_imei_live');
    });

    it('a trade-in of that IMEI is refused at addPayment, with existing_unit.status INSPECTION', async () => {
      const branch = await seedBranch('Main Shop');
      const { user, cookies } = await seedUser(UserRole.ADMIN, 'a@t.com', null);
      const customer = await seedCustomer();
      const used = await seedProduct(branch, 'Used iPhone 12');
      const unit = await seedUnit(
        used,
        customer,
        user,
        IMEI,
        ProductUnitStatus.INSPECTION,
      );
      const charger = await seedProduct(branch, 'Charger', {
        serialized: false,
        stock: 5,
      });
      const sale = await seedEmptyDraft(branch, user, customer);
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({ product_id: charger.id, quantity: 1 })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/payments`)
        .set('Cookie', cookies)
        .send({
          payment_method: PaymentMethod.TRADE_IN,
          amount: 600,
          trade_in_product_id: used.id,
          trade_in_imei: IMEI,
          trade_in_buying_price: 600,
        })
        .expect(409);

      expect(res.body).toEqual(
        expect.objectContaining({
          message: 'IMEI already exists in inventory',
          existing_unit: {
            id: unit.id,
            status: ProductUnitStatus.INSPECTION,
            product_id: used.id,
          },
        }),
      );
    });

    it('a trade-in of that IMEI is refused at complete, naming the IMEI and the payment', async () => {
      const branch = await seedBranch('Main Shop');
      const { user, cookies } = await seedUser(UserRole.ADMIN, 'a@t.com', null);
      const customer = await seedCustomer();
      const used = await seedProduct(branch, 'Used iPhone 12');
      const charger = await seedProduct(branch, 'Charger', {
        serialized: false,
        stock: 5,
      });
      const sale = await seedEmptyDraft(branch, user, customer);
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({ product_id: charger.id, quantity: 1 })
        .expect(201);
      const payment = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/payments`)
        .set('Cookie', cookies)
        .send({
          payment_method: PaymentMethod.TRADE_IN,
          amount: 600,
          trade_in_product_id: used.id,
          trade_in_imei: IMEI,
          trade_in_buying_price: 600,
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/payments`)
        .set('Cookie', cookies)
        .send({
          payment_method: PaymentMethod.CASH,
          amount: 400,
          cash_received: 400,
        })
        .expect(201);
      // Meanwhile the same phone came back to the shop as a return.
      const unit = await seedUnit(
        used,
        customer,
        user,
        IMEI,
        ProductUnitStatus.INSPECTION,
      );
      const paymentId = (
        payment.body as {
          payments: { id: string; payment_method: PaymentMethod }[];
        }
      ).payments.find((p) => p.payment_method === PaymentMethod.TRADE_IN)!.id;

      const res = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/complete`)
        .set('Cookie', cookies)
        .expect(409);

      expect(res.body).toEqual(
        expect.objectContaining({
          message: 'IMEI already exists in inventory',
          imei: IMEI,
          payment_id: paymentId,
          existing_unit: {
            id: unit.id,
            status: ProductUnitStatus.INSPECTION,
            product_id: used.id,
          },
        }),
      );
      const reread = await dataSource
        .getRepository(Sale)
        .findOneByOrFail({ id: sale.id });
      expect(reread.status).toBe(SaleStatus.DRAFT);
    });

    it('a phone purchase of that IMEI is refused, with existing_unit.status INSPECTION', async () => {
      const branch = await seedBranch('Main Shop');
      const { user, cookies } = await seedUser(UserRole.ADMIN, 'a@t.com', null);
      const customer = await seedCustomer();
      const used = await seedProduct(branch, 'Used iPhone 12');
      const unit = await seedUnit(
        used,
        customer,
        user,
        IMEI,
        ProductUnitStatus.INSPECTION,
      );

      const res = await request(app.getHttpServer())
        .post('/api/v1/phone-purchases')
        .set('Cookie', cookies)
        .send({
          customer_id: customer.id,
          branch_id: branch.id,
          product_id: used.id,
          imei: IMEI,
          buying_price: 500,
        })
        .expect(409);

      expect(res.body).toEqual(
        expect.objectContaining({
          message: 'IMEI already exists in inventory',
          imei: IMEI,
          existing_unit: {
            id: unit.id,
            status: ProductUnitStatus.INSPECTION,
            product_id: used.id,
          },
        }),
      );
      expect(await stockQty(used)).toBe(0);
    });
  });

  // ---- Not sellable ----

  describe('an INSPECTION unit cannot be sold', () => {
    it('addLine refuses it as our own phone (409 with its status)', async () => {
      const branch = await seedBranch('Main Shop');
      const { user, cookies } = await seedUser(UserRole.ADMIN, 'a@t.com', null);
      const customer = await seedCustomer();
      const used = await seedProduct(branch, 'Used iPhone 12');
      const unit = await seedUnit(
        used,
        customer,
        user,
        IMEI,
        ProductUnitStatus.INSPECTION,
      );
      const sale = await seedEmptyDraft(branch, user);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({ product_id: used.id, quantity: 1, imei_snapshot: IMEI })
        .expect(409);

      expect(res.body).toEqual(
        expect.objectContaining({
          message: `IMEI '${IMEI}' is not available (status: INSPECTION)`,
          existing_unit: {
            id: unit.id,
            status: ProductUnitStatus.INSPECTION,
            product_id: used.id,
            branch_id: branch.id,
          },
        }),
      );
    });

    it('complete refuses a draft line whose phone went to INSPECTION after it was added', async () => {
      const branch = await seedBranch('Main Shop');
      const { user, cookies } = await seedUser(UserRole.ADMIN, 'a@t.com', null);
      const customer = await seedCustomer();
      const used = await seedProduct(branch, 'Used iPhone 12', { stock: 1 });
      const unit = await seedUnit(
        used,
        customer,
        user,
        IMEI,
        ProductUnitStatus.IN_STOCK,
      );
      const sale = await seedEmptyDraft(branch, user);
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/lines`)
        .set('Cookie', cookies)
        .send({ product_id: used.id, quantity: 1, imei_snapshot: IMEI })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/payments`)
        .set('Cookie', cookies)
        .send({
          payment_method: PaymentMethod.CASH,
          amount: 1000,
          cash_received: 1000,
        })
        .expect(201);
      await setStatus(unit, ProductUnitStatus.INSPECTION);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/sales/${sale.id}/complete`)
        .set('Cookie', cookies)
        .expect(409);

      expect((res.body as { message: string }).message).toMatch(
        new RegExp(
          `^Cannot sell IMEI '${IMEI}': status is INSPECTION, expected IN_STOCK`,
        ),
      );
      expect(await unitStatus(unit)).toBe(ProductUnitStatus.INSPECTION);
      expect(await stockQty(used)).toBe(1);
    });
  });

  // ---- "Other shop" lines ----

  describe('an external-supplier line refuses an IMEI the shop holds', () => {
    async function setupExternal() {
      const branch = await seedBranch('Main Shop');
      const admin = await seedUser(UserRole.ADMIN, 'a@t.com', null);
      const customer = await seedCustomer();
      const used = await seedProduct(branch, 'Used iPhone 12');
      const supplier = await dataSource
        .getRepository(Supplier)
        .save({ name: 'Ranjith Mobile', is_active: true } as Supplier);
      const sale = await seedEmptyDraft(branch, admin.user);
      const addExternal = (imei: string) =>
        request(app.getHttpServer())
          .post(`/api/v1/sales/${sale.id}/lines`)
          .set('Cookie', admin.cookies)
          .send({
            product_id: used.id,
            quantity: 1,
            external_supplier_id: supplier.id,
            imei_snapshot: imei,
          });
      return { ...admin, customer, used, addExternal };
    }

    it.each([
      ProductUnitStatus.INSPECTION,
      ProductUnitStatus.WRITTEN_OFF,
      ProductUnitStatus.IN_STOCK,
    ])(
      'refuses an IMEI the shop holds as %s, naming the status',
      async (status) => {
        const ctx = await setupExternal();
        const unit = await seedUnit(
          ctx.used,
          ctx.customer,
          ctx.user,
          IMEI,
          status,
        );

        const res = await ctx.addExternal(IMEI).expect(409);

        expect(res.body).toEqual(
          expect.objectContaining({
            message:
              `IMEI '${IMEI}' is currently in your stock (status: ${status}). ` +
              'If you meant to sell your own inventory, remove external_supplier_id.',
            existing_unit: {
              id: unit.id,
              product_id: ctx.used.id,
              branch_id: unit.branch_id,
            },
          }),
        );
      },
    );

    it('still allows an IMEI the shop only has history for (SOLD)', async () => {
      const ctx = await setupExternal();
      await seedUnit(
        ctx.used,
        ctx.customer,
        ctx.user,
        OTHER_IMEI,
        ProductUnitStatus.SOLD,
      );

      await ctx.addExternal(OTHER_IMEI).expect(201);
    });
  });

  // ---- POST /product-units/:id/inspection-pass ----

  describe('POST /product-units/:id/inspection-pass', () => {
    async function setupPass() {
      const main = await seedBranch('Main Shop');
      const other = await seedBranch('Other Shop');
      const admin = await seedUser(UserRole.ADMIN, 'a@t.com', null);
      const customer = await seedCustomer();
      const used = await seedProduct(main, 'Used iPhone 12', { stock: 3 });
      const unit = await seedUnit(
        used,
        customer,
        admin.user,
        IMEI,
        ProductUnitStatus.INSPECTION,
      );
      return { main, other, admin, customer, used, unit };
    }

    it('a manager at the unit branch passes it: IN_STOCK, stock +1, audited, the unit returned', async () => {
      const ctx = await setupPass();
      const manager = await seedUser(UserRole.MANAGER, 'm@t.com', ctx.main);

      const res = await passInspection(manager.cookies, ctx.unit.id).expect(
        200,
      );

      expect(res.body).toEqual(
        expect.objectContaining({
          id: ctx.unit.id,
          imei: IMEI,
          status: ProductUnitStatus.IN_STOCK,
          product: expect.objectContaining({ id: ctx.used.id }),
        }),
      );
      expect(await unitStatus(ctx.unit)).toBe(ProductUnitStatus.IN_STOCK);
      expect(await stockQty(ctx.used)).toBe(4);

      const audits = await dataSource
        .getRepository(AuditLog)
        .find({ where: { action: AuditAction.INSPECTION_PASSED } });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toEqual(
        expect.objectContaining({
          user_id: manager.user.id,
          entity_type: 'ProductUnit',
          entity_id: ctx.unit.id,
          description: `Inspection passed: IMEI ${IMEI} (Used iPhone 12) back in stock`,
          changes: {
            status: {
              old: ProductUnitStatus.INSPECTION,
              new: ProductUnitStatus.IN_STOCK,
            },
          },
        }),
      );
    });

    it('an admin passes it at any branch', async () => {
      const ctx = await setupPass();

      await passInspection(ctx.admin.cookies, ctx.unit.id).expect(200);

      expect(await unitStatus(ctx.unit)).toBe(ProductUnitStatus.IN_STOCK);
      expect(await stockQty(ctx.used)).toBe(4);
    });

    it.each([ProductUnitStatus.IN_STOCK, ProductUnitStatus.SOLD])(
      '409 NOT_IN_INSPECTION for a %s unit, and nothing changes',
      async (status) => {
        const ctx = await setupPass();
        await setStatus(ctx.unit, status);

        const res = await passInspection(ctx.admin.cookies, ctx.unit.id).expect(
          409,
        );

        expect(res.body).toEqual({
          message: `This phone (IMEI ${IMEI}) is not waiting for inspection (status: ${status}).`,
          code: 'NOT_IN_INSPECTION',
          status,
        });
        expect(await unitStatus(ctx.unit)).toBe(status);
        expect(await stockQty(ctx.used)).toBe(3);
      },
    );

    it('a second pass of the same phone gets 409 and adds no more stock', async () => {
      const ctx = await setupPass();

      await passInspection(ctx.admin.cookies, ctx.unit.id).expect(200);
      await passInspection(ctx.admin.cookies, ctx.unit.id).expect(409);

      expect(await stockQty(ctx.used)).toBe(4);
    });

    it('404 for an unknown unit; 400 for a malformed id', async () => {
      const ctx = await setupPass();

      await passInspection(
        ctx.admin.cookies,
        '00000000-0000-4000-8000-000000000000',
      ).expect(404);
      await passInspection(ctx.admin.cookies, 'not-a-uuid').expect(400);
    });

    it('403 for a cashier', async () => {
      const ctx = await setupPass();
      const cashier = await seedUser(UserRole.CASHIER, 'c@t.com', ctx.main);

      await passInspection(cashier.cookies, ctx.unit.id).expect(403);

      expect(await unitStatus(ctx.unit)).toBe(ProductUnitStatus.INSPECTION);
      expect(await stockQty(ctx.used)).toBe(3);
    });

    it('403 INSPECTION_WRONG_BRANCH for a manager of another branch', async () => {
      const ctx = await setupPass();
      const manager = await seedUser(UserRole.MANAGER, 'm2@t.com', ctx.other);

      const res = await passInspection(manager.cookies, ctx.unit.id).expect(
        403,
      );

      expect(res.body).toEqual({
        message: 'You can only pass inspection for phones at your own branch.',
        code: 'INSPECTION_WRONG_BRANCH',
      });
      expect(await unitStatus(ctx.unit)).toBe(ProductUnitStatus.INSPECTION);
      expect(await stockQty(ctx.used)).toBe(3);
    });
  });
});
