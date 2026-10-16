import { INestApplication } from '@nestjs/common';
import request, { Response } from 'supertest';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { createTestApp, truncateAllTables } from './setup';
import { User } from '../src/users/entities/user.entity';
import { UserRole } from '../src/users/enums/user-role.enum';
import { Branch } from '../src/branches/entities/branch.entity';
import { Brand } from '../src/brands/entities/brand.entity';
import { Category } from '../src/categories/entities/category.entity';
import { Product } from '../src/products/entities/product.entity';
import { ProductType } from '../src/products/enums/product-type.enum';
import { Stock } from '../src/stock/entities/stock.entity';
import { Customer } from '../src/customers/entities/customer.entity';
import { AuditLog } from '../src/audit-log/entities/audit-log.entity';
import { AuditAction } from '../src/audit-log/enums/audit-action.enum';
import { PaymentMethod } from '../src/sales/enums/payment-method.enum';

/**
 * Regression guard: no response may carry a password hash or a refresh
 * token hash, directly or through a relation (sale.cashier,
 * phone_purchase.cashier, …). User.password_hash is `select: false` and
 * `@Exclude()`; RefreshToken.token_hash is `@Exclude()`.
 *
 * One app, seeded once; the `it` blocks run in order and share state.
 */
describe('Secret exposure (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  const PASSWORD = 'testpass123';
  let branch: Branch;
  let admin: User;
  let manager: User;
  let cashier: User;
  let customer: Customer;
  let product: Product;
  let serializedProduct: Product;
  let adminCookies: string[];
  let managerCookies: string[];
  let cashierCookies: string[];

  const http = () => request(app.getHttpServer());
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /** Every path in `node` that names or holds a secret. */
  function secretPaths(node: unknown, path = '$'): string[] {
    if (Array.isArray(node)) {
      return node.flatMap((v, i) => secretPaths(v, `${path}[${i}]`));
    }
    if (node && typeof node === 'object') {
      return Object.entries(node).flatMap(([k, v]) => [
        ...(k === 'password_hash' || k === 'token_hash'
          ? [`${path}.${k}`]
          : []),
        ...secretPaths(v, `${path}.${k}`),
      ]);
    }
    if (typeof node === 'string' && /^\$2[aby]\$\d\d\$/.test(node)) {
      return [`${path} (bcrypt value)`];
    }
    return [];
  }

  function expectNoSecrets(res: Response): void {
    expect(secretPaths(res.body)).toEqual([]);
  }

  async function seedUser(
    role: UserRole,
    email: string,
    branchId: string | null,
  ): Promise<User> {
    const repo = dataSource.getRepository(User);
    return repo.save(
      repo.create({
        email,
        password_hash: await bcrypt.hash(PASSWORD, 4),
        full_name: `Test ${role}`,
        role,
        is_active: true,
        branch_id: branchId,
      }),
    );
  }

  async function login(email: string): Promise<string[]> {
    await pause(110); // stay under the 10 req/s throttler
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return res.headers['set-cookie'] as unknown as string[];
  }

  async function storedHash(userId: string): Promise<string> {
    const row = await dataSource
      .getRepository(User)
      .createQueryBuilder('user')
      .addSelect('user.password_hash')
      .where('user.id = :id', { id: userId })
      .getOneOrFail();
    return row.password_hash;
  }

  async function seedProduct(isSerialized: boolean): Promise<Product> {
    const suffix = Math.random().toString(36).slice(2, 8);
    const repo = dataSource.getRepository(Product);
    const saved = await repo.save(
      repo.create({
        product_type: ProductType.PHONE,
        name: `Probe Product ${suffix}`,
        sku: `SKU-SEC-${suffix}`,
        barcode: `BC-SEC-${suffix}`,
        brand_id: (
          await dataSource
            .getRepository(Brand)
            .save({ name: `Brand ${suffix}`, is_active: true } as Brand)
        ).id,
        category_id: (
          await dataSource
            .getRepository(Category)
            .save({ name: `Cat ${suffix}`, is_active: true } as Category)
        ).id,
        branch_id: branch.id,
        buying_price: '80.00',
        selling_price: '100.00',
        is_active: true,
        is_serialized: isSerialized,
      }),
    );
    await dataSource.getRepository(Stock).save({
      product_id: saved.id,
      branch_id: branch.id,
      quantity: isSerialized ? 0 : 10,
      min_quantity: 0,
    } as Stock);
    return saved;
  }

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
    await truncateAllTables(app);

    branch = await dataSource
      .getRepository(Branch)
      .save({ name: 'Main Shop', is_active: true } as Branch);
    admin = await seedUser(UserRole.ADMIN, 'admin@sec.test', null);
    manager = await seedUser(UserRole.MANAGER, 'manager@sec.test', branch.id);
    cashier = await seedUser(UserRole.CASHIER, 'cashier@sec.test', branch.id);
    customer = await dataSource
      .getRepository(Customer)
      .save({ name: 'Kamal', phone: '0771234567', nic: null, notes: null });
    product = await seedProduct(false);
    serializedProduct = await seedProduct(true);

    adminCookies = await login(admin.email);
    managerCookies = await login(manager.email);
    cashierCookies = await login(cashier.email);
  });

  // Spaces requests out to stay under the 10 req/s throttler.
  beforeEach(() => pause(150));

  afterAll(async () => {
    await app.close();
  });

  describe('auth', () => {
    it('POST /auth/login succeeds and returns no secrets', async () => {
      const res = await http()
        .post('/api/v1/auth/login')
        .send({ email: cashier.email, password: PASSWORD })
        .expect(200);
      expect(res.body.user).toMatchObject({ id: cashier.id });
      expectNoSecrets(res);
    });

    it('POST /auth/login with a wrong password is 401', async () => {
      const res = await http()
        .post('/api/v1/auth/login')
        .send({ email: cashier.email, password: 'wrong-password' })
        .expect(401);
      expectNoSecrets(res);
    });

    it('GET /auth/me returns no secrets', async () => {
      const res = await http()
        .get('/api/v1/auth/me')
        .set('Cookie', cashierCookies)
        .expect(200);
      expect(res.body.user).toMatchObject({ id: cashier.id });
      expectNoSecrets(res);
    });

    it('POST /auth/refresh rotates tokens and returns no secrets', async () => {
      // Its own session, so the shared cashier cookies stay valid.
      const cookies = await login(cashier.email);
      const res = await http()
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookies)
        .expect(200);
      expect(res.body).toEqual({ success: true });
      expect(res.headers['set-cookie']).toBeDefined();
      expectNoSecrets(res);
    });
  });

  describe('sales (read as a cashier; cashier relation is loaded)', () => {
    let saleId: string;
    let lineId: string;
    let paymentId: string;

    it('POST /sales', async () => {
      const res = await http()
        .post('/api/v1/sales')
        .set('Cookie', cashierCookies)
        .send({ branch_id: branch.id })
        .expect(201);
      saleId = res.body.id;
      expectNoSecrets(res);
    });

    it('GET /sales', async () => {
      const res = await http()
        .get('/api/v1/sales')
        .set('Cookie', cashierCookies)
        .expect(200);
      expect(res.body.data[0].cashier).toMatchObject({ id: cashier.id });
      expectNoSecrets(res);
    });

    it('GET /sales/:id', async () => {
      const res = await http()
        .get(`/api/v1/sales/${saleId}`)
        .set('Cookie', cashierCookies)
        .expect(200);
      expect(res.body.cashier).toMatchObject({ id: cashier.id });
      expectNoSecrets(res);
    });

    it('PATCH /sales/:id', async () => {
      const res = await http()
        .patch(`/api/v1/sales/${saleId}`)
        .set('Cookie', cashierCookies)
        .send({ notes: 'secret-exposure probe' })
        .expect(200);
      expect(res.body.cashier).toMatchObject({ id: cashier.id });
      expectNoSecrets(res);
    });

    it('POST /sales/:id/lines', async () => {
      const res = await http()
        .post(`/api/v1/sales/${saleId}/lines`)
        .set('Cookie', cashierCookies)
        .send({ product_id: product.id, quantity: 1 })
        .expect(201);
      expect(res.body.cashier).toMatchObject({ id: cashier.id });
      lineId = res.body.lines[0].id;
      expectNoSecrets(res);
    });

    it('PATCH /sales/:id/lines/:lineId', async () => {
      const res = await http()
        .patch(`/api/v1/sales/${saleId}/lines/${lineId}`)
        .set('Cookie', cashierCookies)
        .send({ quantity: 2 })
        .expect(200);
      expect(res.body.cashier).toMatchObject({ id: cashier.id });
      expect(res.body.total).toBe('200.00');
      expectNoSecrets(res);
    });

    it('POST /sales/:id/payments', async () => {
      const res = await http()
        .post(`/api/v1/sales/${saleId}/payments`)
        .set('Cookie', cashierCookies)
        .send({
          payment_method: PaymentMethod.CASH,
          amount: 150,
          cash_received: 150,
        })
        .expect(201);
      expect(res.body.cashier).toMatchObject({ id: cashier.id });
      paymentId = res.body.payments[0].id;
      expectNoSecrets(res);
    });

    it('PATCH /sales/:id/payments/:paymentId', async () => {
      const res = await http()
        .patch(`/api/v1/sales/${saleId}/payments/${paymentId}`)
        .set('Cookie', cashierCookies)
        .send({ amount: 200, cash_received: 200 })
        .expect(200);
      expect(res.body.cashier).toMatchObject({ id: cashier.id });
      expect(res.body.amount_paid).toBe('200.00');
      expectNoSecrets(res);
    });

    it('POST /sales/:id/complete', async () => {
      const res = await http()
        .post(`/api/v1/sales/${saleId}/complete`)
        .set('Cookie', cashierCookies)
        .expect(200);
      expect(res.body.cashier).toMatchObject({ id: cashier.id });
      expect(res.body.status).toBe('COMPLETED');
      expectNoSecrets(res);
    });

    it('POST /sales/:id/void (manager)', async () => {
      const res = await http()
        .post(`/api/v1/sales/${saleId}/void`)
        .set('Cookie', managerCookies)
        .send({ void_reason: 'secret-exposure probe' })
        .expect(200);
      expect(res.body.cashier).toMatchObject({ id: cashier.id });
      expect(res.body.voided_by).toBe(manager.id);
      expectNoSecrets(res);
    });
  });

  describe('phone purchases (cashier relation is loaded)', () => {
    let purchaseId: string;

    it('POST /phone-purchases', async () => {
      const res = await http()
        .post('/api/v1/phone-purchases')
        .set('Cookie', cashierCookies)
        .send({
          customer_id: customer.id,
          branch_id: branch.id,
          product_id: serializedProduct.id,
          imei: `${Date.now()}`.padEnd(15, '0'),
          buying_price: 80000,
          selling_price: 100000,
        })
        .expect(201);
      expect(res.body.cashier).toMatchObject({ id: cashier.id });
      purchaseId = res.body.id;
      expectNoSecrets(res);
    });

    it('GET /phone-purchases', async () => {
      const res = await http()
        .get('/api/v1/phone-purchases')
        .set('Cookie', cashierCookies)
        .expect(200);
      expect(res.body.data[0].cashier).toMatchObject({ id: cashier.id });
      expectNoSecrets(res);
    });

    it('GET /phone-purchases/:id', async () => {
      const res = await http()
        .get(`/api/v1/phone-purchases/${purchaseId}`)
        .set('Cookie', cashierCookies)
        .expect(200);
      expect(res.body.cashier).toMatchObject({ id: cashier.id });
      expectNoSecrets(res);
    });

    it('GET /product-units and /product-units/:id', async () => {
      const list = await http()
        .get('/api/v1/product-units')
        .set('Cookie', adminCookies)
        .expect(200);
      expectNoSecrets(list);
      const one = await http()
        .get(`/api/v1/product-units/${list.body.data[0].id}`)
        .set('Cookie', adminCookies)
        .expect(200);
      expectNoSecrets(one);
    });
  });

  describe('users and audit log', () => {
    it('GET /users/:id returns no secrets', async () => {
      const res = await http()
        .get(`/api/v1/users/${cashier.id}`)
        .set('Cookie', adminCookies)
        .expect(200);
      expect(res.body).toMatchObject({ id: cashier.id });
      expectNoSecrets(res);
    });

    it('PATCH /users/:id returns no secrets, keeps the stored hash, and login still works', async () => {
      const hashBefore = await storedHash(cashier.id);

      const res = await http()
        .patch(`/api/v1/users/${cashier.id}`)
        .set('Cookie', adminCookies)
        .send({ full_name: 'Cashier Renamed' })
        .expect(200);
      expect(res.body).toMatchObject({
        id: cashier.id,
        full_name: 'Cashier Renamed',
      });
      expectNoSecrets(res);

      expect(await storedHash(cashier.id)).toBe(hashBefore);
      const cookies = await login(cashier.email);
      expect(cookies.length).toBeGreaterThan(0);
    });

    it('the audit "before" lookup no longer loads the hash', async () => {
      // Same call AuditLogInterceptor makes for its UPDATE "before" snapshot.
      const before = await dataSource
        .getRepository('User')
        .findOne({ where: { id: cashier.id } });
      expect(before).not.toBeNull();
      // The key can exist on the entity instance (class field), but the
      // column is not selected, so it carries no value.
      expect((before as User).password_hash).toBeUndefined();
    });

    it('the PATCH /users/:id audit entry stores no hash in changes', async () => {
      // AuditLogInterceptor writes fire-and-forget; let it land.
      await pause(200);
      const entry = await dataSource.getRepository(AuditLog).findOneOrFail({
        where: {
          entity_type: 'User',
          entity_id: cashier.id,
          action: AuditAction.UPDATE,
        },
      });
      expect(entry.changes).toMatchObject({
        full_name: { old: 'Test cashier', new: 'Cashier Renamed' },
      });
      expect(secretPaths(entry.changes)).toEqual([]);
    });

    it('GET /audit-logs returns no secrets', async () => {
      const res = await http()
        .get('/api/v1/audit-logs')
        .set('Cookie', adminCookies)
        .expect(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expectNoSecrets(res);
    });
  });
});
