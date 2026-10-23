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

  /**
   * Keys no response may carry: password and refresh-token hashes, and the
   * approval PIN's hash, wrong-PIN count and lock (Phase 6.4 P6-15), and
   * the PIN or password a request sent.
   */
  const SECRET_KEYS = new Set([
    'password_hash',
    'token_hash',
    'approval_pin_hash',
    'approval_pin_failed_attempts',
    'approval_pin_locked_until',
    'pin',
    'current_password',
  ]);

  /** The manager's approval PIN, set through the API below. */
  const MANAGER_PIN = '730415';

  /** Every path in `node` that names or holds a secret. */
  function secretPaths(node: unknown, path = '$'): string[] {
    if (Array.isArray(node)) {
      return node.flatMap((v, i) => secretPaths(v, `${path}[${i}]`));
    }
    if (node && typeof node === 'object') {
      return Object.entries(node).flatMap(([k, v]) => [
        ...(SECRET_KEYS.has(k) ? [`${path}.${k}`] : []),
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
    // Nor the PIN or the password as a value, anywhere in the body
    const text = JSON.stringify(res.body ?? {});
    expect(text).not.toContain(MANAGER_PIN);
    expect(text).not.toContain(PASSWORD);
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
      // NIC: POST /phone-purchases needs the seller's (P4-13)
      .save({
        name: 'Kamal',
        phone: '0771234567',
        nic: '199300000001',
        notes: null,
      });
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
        // customer_id: so the list after the void carries a customer (P6-5)
        .send({ notes: 'secret-exposure probe', customer_id: customer.id })
        .expect(200);
      expect(res.body.cashier).toMatchObject({ id: cashier.id });
      expect(res.body.customer).toMatchObject({ id: customer.id });
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

    // ---- Approval PIN (P6-15 – P6-19): set, refused, locked, approved ----

    it('PUT /auth/me/approval-pin (manager sets their own PIN)', async () => {
      const res = await http()
        .put('/api/v1/auth/me/approval-pin')
        .set('Cookie', managerCookies)
        .send({ current_password: PASSWORD, pin: MANAGER_PIN })
        .expect(200);
      expect(res.body).toMatchObject({ has_approval_pin: true });
      expectNoSecrets(res);
    });

    it('PUT /auth/me/approval-pin with a wrong password (403 body)', async () => {
      const res = await http()
        .put('/api/v1/auth/me/approval-pin')
        .set('Cookie', managerCookies)
        .send({ current_password: 'not-the-password', pin: '193728' })
        .expect(403);
      expect(res.body.code).toBe('WRONG_PASSWORD');
      expectNoSecrets(res);
      expect(JSON.stringify(res.body)).not.toContain('not-the-password');
      expect(JSON.stringify(res.body)).not.toContain('193728');
    });

    it('GET /auth/me (manager) shows the PIN state, not the PIN', async () => {
      const res = await http()
        .get('/api/v1/auth/me')
        .set('Cookie', managerCookies)
        .expect(200);
      expect(res.body.user).toMatchObject({ has_approval_pin: true });
      expectNoSecrets(res);
    });

    it('GET /approvers (id and full_name only)', async () => {
      const res = await http()
        .get('/api/v1/approvers')
        .query({ branchId: branch.id })
        .set('Cookie', cashierCookies)
        .expect(200);
      expect(res.body).toEqual([
        { id: manager.id, full_name: manager.full_name },
      ]);
      expectNoSecrets(res);
    });

    it('POST /sales/:id/void with a wrong PIN (403 body)', async () => {
      const res = await http()
        .post(`/api/v1/sales/${saleId}/void`)
        .set('Cookie', cashierCookies)
        .send({
          void_reason: 'secret-exposure probe',
          approval: { approver_id: manager.id, pin: '193728' },
        })
        .expect(403);
      expect(res.body).toMatchObject({ code: 'WRONG_PIN', attempts_left: 4 });
      expectNoSecrets(res);
      expect(JSON.stringify(res.body)).not.toContain('193728');
    });

    it('POST /sales/:id/void while the PIN is locked (423 body)', async () => {
      await dataSource.query(
        `UPDATE users SET approval_pin_locked_until = now() + interval '1 hour' WHERE id = $1`,
        [manager.id],
      );
      const res = await http()
        .post(`/api/v1/sales/${saleId}/void`)
        .set('Cookie', cashierCookies)
        .send({
          void_reason: 'secret-exposure probe',
          approval: { approver_id: manager.id, pin: MANAGER_PIN },
        })
        .expect(423);
      expect(res.body.code).toBe('PIN_LOCKED');
      expectNoSecrets(res);
      await dataSource.query(
        `UPDATE users SET approval_pin_locked_until = NULL WHERE id = $1`,
        [manager.id],
      );
    });

    it("POST /sales/:id/void (cashier's session, manager's PIN)", async () => {
      const res = await http()
        .post(`/api/v1/sales/${saleId}/void`)
        .set('Cookie', cashierCookies)
        .send({
          void_reason: 'secret-exposure probe',
          approval: { approver_id: manager.id, pin: MANAGER_PIN },
        })
        .expect(200);
      expect(res.body.cashier).toMatchObject({ id: cashier.id });
      expect(res.body.voided_by).toBe(manager.id);
      // The voider (P6-6) and the void requester (P6-17) are loaded on
      // every hydrated sale
      expect(res.body.voider).toMatchObject({ id: manager.id });
      expect(res.body.void_requester).toMatchObject({ id: cashier.id });
      expectNoSecrets(res);
    });

    it('GET /sales/:id on the voided sale (voider and void requester loaded)', async () => {
      const res = await http()
        .get(`/api/v1/sales/${saleId}`)
        .set('Cookie', cashierCookies)
        .expect(200);
      expect(res.body.voider).toMatchObject({ id: manager.id });
      expect(res.body.void_requester).toMatchObject({ id: cashier.id });
      expectNoSecrets(res);
    });

    it('GET /sales recent-sales list (cashier and customer loaded)', async () => {
      const res = await http()
        .get('/api/v1/sales')
        .query({
          branchId: branch.id,
          completedFrom: '2000-01-01T00:00:00+05:30',
          completedTo: '2100-01-01T00:00:00+05:30',
          sort: 'completed_at',
        })
        .set('Cookie', cashierCookies)
        .expect(200);
      expect(res.body.data[0]).toMatchObject({
        id: saleId,
        cashier: { id: cashier.id },
        customer: { id: customer.id },
      });
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

    it('POST /product-units/:id/inspection-pass (Phase 6.4 P7-7)', async () => {
      // Returns ship in P7 step 0b; until then a unit is put in
      // INSPECTION directly. Passing it puts it back to IN_STOCK.
      const rows: { id: string }[] = await dataSource.query(
        `SELECT id FROM product_units WHERE phone_purchase_id = $1`,
        [purchaseId],
      );
      await dataSource.query(
        `UPDATE product_units SET status = 'INSPECTION' WHERE id = $1`,
        [rows[0].id],
      );
      const res = await http()
        .post(`/api/v1/product-units/${rows[0].id}/inspection-pass`)
        .set('Cookie', adminCookies)
        .expect(200);
      expect(res.body).toMatchObject({ status: 'IN_STOCK' });
      expectNoSecrets(res);
    });
  });

  describe('returns (Phase 6.4 P7; approver and requester as id and full_name only)', () => {
    let saleId: string;
    let lineId: string;
    let phoneLineId: string;
    let clientRequestId: string;

    const returnBody = (pin: string, refund = 100) => ({
      client_request_id: clientRequestId,
      lines: [
        { sale_line_id: lineId, quantity: 1, condition: 'RESALEABLE' },
        { sale_line_id: phoneLineId, quantity: 1 },
      ],
      refunds: [{ method: PaymentMethod.CASH, amount: refund }],
      reason: 'secret-exposure probe',
      // These products have no warranty: every line is outside it (P7-23).
      override_reason: 'secret-exposure override',
      approval: { approver_id: manager.id, pin },
    });

    it('a completed sale with a stock line and a phone', async () => {
      // The phone passed inspection above and is back in stock.
      const units: { imei: string }[] = await dataSource.query(
        `SELECT imei FROM product_units WHERE product_id = $1 AND status = 'IN_STOCK'`,
        [serializedProduct.id],
      );
      const created = await http()
        .post('/api/v1/sales')
        .set('Cookie', cashierCookies)
        .send({ branch_id: branch.id })
        .expect(201);
      saleId = created.body.id;
      await pause(150);
      await http()
        .post(`/api/v1/sales/${saleId}/lines`)
        .set('Cookie', cashierCookies)
        .send({ product_id: product.id, quantity: 2 })
        .expect(201);
      await pause(150);
      const withPhone = await http()
        .post(`/api/v1/sales/${saleId}/lines`)
        .set('Cookie', cashierCookies)
        .send({
          product_id: serializedProduct.id,
          quantity: 1,
          imei_snapshot: units[0].imei,
        })
        .expect(201);
      lineId = withPhone.body.lines[0].id;
      phoneLineId = withPhone.body.lines[1].id;
      const total = Number(withPhone.body.total);
      await pause(150);
      await http()
        .post(`/api/v1/sales/${saleId}/payments`)
        .set('Cookie', cashierCookies)
        .send({
          payment_method: PaymentMethod.CASH,
          amount: total,
          cash_received: total,
        })
        .expect(201);
      await pause(150);
      await http()
        .post(`/api/v1/sales/${saleId}/complete`)
        .set('Cookie', cashierCookies)
        .expect(200);
      clientRequestId = '9f0f5a3e-6a43-4d54-9a8b-2a7c3d1e5b01';
    });

    it('POST /sales/:id/returns with a wrong PIN (403 body)', async () => {
      const res = await http()
        .post(`/api/v1/sales/${saleId}/returns`)
        .set('Cookie', cashierCookies)
        .send(returnBody('193728'))
        .expect(403);
      expect(res.body.code).toBe('WRONG_PIN');
      expectNoSecrets(res);
      expect(JSON.stringify(res.body)).not.toContain('193728');
    });

    it('POST /sales/:id/returns refused before the PIN (400 REFUND_TOO_HIGH body)', async () => {
      const res = await http()
        .post(`/api/v1/sales/${saleId}/returns`)
        .set('Cookie', cashierCookies)
        .send(returnBody(MANAGER_PIN, 999999))
        .expect(400);
      expect(res.body.code).toBe('REFUND_TOO_HIGH');
      expectNoSecrets(res);
    });

    it("POST /sales/:id/returns (cashier's session, manager's PIN; 201)", async () => {
      const res = await http()
        .post(`/api/v1/sales/${saleId}/returns`)
        .set('Cookie', cashierCookies)
        .send(returnBody(MANAGER_PIN))
        .expect(201);
      const ret = res.body.sale.returns[0];
      expect(ret.approver).toEqual({
        id: manager.id,
        full_name: manager.full_name,
      });
      expect(ret.requester).toEqual({
        id: cashier.id,
        full_name: cashier.full_name,
      });
      expect(ret.lines[1].product_unit).toEqual({
        id: expect.any(String),
        imei: expect.any(String),
      });
      expectNoSecrets(res);
    });

    it('POST /sales/:id/returns resent (200)', async () => {
      const res = await http()
        .post(`/api/v1/sales/${saleId}/returns`)
        .set('Cookie', cashierCookies)
        .send(returnBody(MANAGER_PIN))
        .expect(200);
      expectNoSecrets(res);
    });

    it('POST /sales/:id/returns with the id from another user (409 body)', async () => {
      const res = await http()
        .post(`/api/v1/sales/${saleId}/returns`)
        .set('Cookie', managerCookies)
        .send(returnBody(MANAGER_PIN))
        .expect(409);
      expect(res.body).toEqual({
        message: expect.any(String),
        code: 'CLIENT_REQUEST_ID_CONFLICT',
      });
      expectNoSecrets(res);
    });

    it('GET /sales/:id with returns', async () => {
      const res = await http()
        .get(`/api/v1/sales/${saleId}`)
        .set('Cookie', cashierCookies)
        .expect(200);
      expect(Object.keys(res.body.returns[0].approver).sort()).toEqual([
        'full_name',
        'id',
      ]);
      expect(Object.keys(res.body.returns[0].requester).sort()).toEqual([
        'full_name',
        'id',
      ]);
      expectNoSecrets(res);
    });

    it('GET /sales with return_state', async () => {
      const res = await http()
        .get('/api/v1/sales')
        .query({ branchId: branch.id })
        .set('Cookie', cashierCookies)
        .expect(200);
      const rows = res.body.data as { id: string }[];
      expect(rows.find((s) => s.id === saleId)).toMatchObject({
        return_state: 'PARTIAL',
      });
      expectNoSecrets(res);
    });

    it('GET /sale-returns/inspection', async () => {
      const res = await http()
        .get('/api/v1/sale-returns/inspection')
        .query({ branchId: branch.id })
        .set('Cookie', managerCookies)
        .expect(200);
      expect(res.body).toHaveLength(1);
      expectNoSecrets(res);
    });

    it('POST /sales/:id/void on a sale with a return (409 SALE_HAS_RETURNS body)', async () => {
      const res = await http()
        .post(`/api/v1/sales/${saleId}/void`)
        .set('Cookie', cashierCookies)
        .send({
          void_reason: 'secret-exposure probe',
          approval: { approver_id: manager.id, pin: MANAGER_PIN },
        })
        .expect(409);
      expect(res.body.code).toBe('SALE_HAS_RETURNS');
      expectNoSecrets(res);
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

    it('GET /users/:id of a PIN holder returns no PIN hash, count or lock', async () => {
      const res = await http()
        .get(`/api/v1/users/${manager.id}`)
        .set('Cookie', adminCookies)
        .expect(200);
      expect(res.body.approval_pin_set_at).toBeTruthy();
      expectNoSecrets(res);
    });

    it('PATCH /users/:id of a PIN holder returns no secrets', async () => {
      const res = await http()
        .patch(`/api/v1/users/${manager.id}`)
        .set('Cookie', adminCookies)
        .send({ full_name: 'Manager Renamed' })
        .expect(200);
      expectNoSecrets(res);
    });

    it('DELETE /users/:id/approval-pin (admin) returns no body', async () => {
      const res = await http()
        .delete(`/api/v1/users/${manager.id}/approval-pin`)
        .set('Cookie', adminCookies)
        .expect(204);
      expect(res.text).toBe('');
      expectNoSecrets(res);
    });

    it('GET /audit-logs returns no secrets', async () => {
      const res = await http()
        .get('/api/v1/audit-logs')
        .set('Cookie', adminCookies)
        .expect(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expectNoSecrets(res);
    });

    it('no audit row holds a PIN, a password or a hash (P6-18, P6-19)', async () => {
      await pause(200); // fire-and-forget interceptor writes
      const rows = await dataSource.getRepository(AuditLog).find();
      const actions = rows.map((r) => r.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          AuditAction.APPROVAL_PIN_SET,
          AuditAction.APPROVAL_PIN_SET_REJECTED,
          AuditAction.APPROVAL_PIN_FAILED,
          AuditAction.APPROVAL_PIN_CLEARED,
          AuditAction.VOID,
        ]),
      );
      const text = JSON.stringify(rows);
      for (const secret of [
        MANAGER_PIN,
        '193728',
        PASSWORD,
        'not-the-password',
      ]) {
        expect(text).not.toContain(secret);
      }
      expect(text).not.toMatch(/\$2[aby]\$\d\d\$/);
    });
  });
});
