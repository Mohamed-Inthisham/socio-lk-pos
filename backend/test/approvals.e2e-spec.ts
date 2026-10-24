import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { createTestApp, truncateAllTables } from './setup';
import { approvalFor, giveApprovalPin, TEST_PIN } from './approval-pin.helper';
import { User } from '../src/users/entities/user.entity';
import { UserRole } from '../src/users/enums/user-role.enum';
import { UsersService } from '../src/users/users.service';
import { Branch } from '../src/branches/entities/branch.entity';
import { Brand } from '../src/brands/entities/brand.entity';
import { Category } from '../src/categories/entities/category.entity';
import { Product } from '../src/products/entities/product.entity';
import { ProductType } from '../src/products/enums/product-type.enum';
import { WarrantyPeriod } from '../src/products/enums/warranty-period.enum';
import { Stock } from '../src/stock/entities/stock.entity';
import { Sale } from '../src/sales/entities/sale.entity';
import { SaleLine } from '../src/sales/entities/sale-line.entity';
import { SaleStatus } from '../src/sales/enums/sale-status.enum';
import { SaleType } from '../src/sales/enums/sale-type.enum';
import { AuditLog } from '../src/audit-log/entities/audit-log.entity';
import { AuditAction } from '../src/audit-log/enums/audit-action.enum';

/**
 * Manager approval PIN (Phase 6.4 P6-15 – P6-21): the approver list,
 * setting and clearing a PIN, and the PIN check on a void (refusals, the
 * lock at 5, 423 without comparing, reset on success, lock expiry,
 * concurrent guesses, the count surviving a refused void) and that the
 * PIN never leaks into bodies, audit rows or console output.
 */
describe('Approval PIN (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  const PASSWORD = 'testpass123';
  const http = () => request(app.getHttpServer());

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

  async function seedBranch(name = 'Main Shop'): Promise<Branch> {
    return dataSource
      .getRepository(Branch)
      .save({ name, is_active: true } as Branch);
  }

  let emailSeq = 0;
  async function seedUser(
    role: UserRole,
    branchId: string | null,
    opts: { pin?: boolean; name?: string; active?: boolean } = {},
  ): Promise<User> {
    const repo = dataSource.getRepository(User);
    const user = await repo.save(
      repo.create({
        email: `${role}${++emailSeq}@pin.test`,
        password_hash: await bcrypt.hash(PASSWORD, 4),
        full_name: opts.name ?? `Test ${role} ${emailSeq}`,
        role,
        is_active: opts.active ?? true,
        branch_id: role === UserRole.ADMIN ? null : branchId,
      }),
    );
    if (opts.pin) await giveApprovalPin(dataSource, user.id);
    return user;
  }

  async function login(user: User): Promise<string[]> {
    await new Promise((r) => setTimeout(r, 500));
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    return res.headers['set-cookie'] as unknown as string[];
  }

  /** A COMPLETED one-line sale at `branchId`, seeded straight into the DB. */
  let saleSeq = 0;
  async function seedCompletedSale(
    branchId: string,
    cashierId: string,
  ): Promise<Sale> {
    const suffix = `${++saleSeq}-${Math.random().toString(36).slice(2, 8)}`;
    const brand = await dataSource
      .getRepository(Brand)
      .save({ name: `Brand ${suffix}`, is_active: true } as Brand);
    const category = await dataSource
      .getRepository(Category)
      .save({ name: `Cat ${suffix}`, is_active: true } as Category);
    const product = await dataSource.getRepository(Product).save(
      dataSource.getRepository(Product).create({
        product_type: ProductType.ACCESSORY,
        name: `Cable ${suffix}`,
        sku: `SKU-PIN-${suffix}`,
        barcode: `BC-PIN-${suffix}`,
        brand_id: brand.id,
        category_id: category.id,
        branch_id: branchId,
        buying_price: '80.00',
        selling_price: '100.00',
        is_active: true,
        is_serialized: false,
        default_warranty: WarrantyPeriod.NO_WARRANTY,
      }),
    );
    const stockRepo = dataSource.getRepository(Stock);
    const stock = await stockRepo.findOne({
      where: { product_id: product.id, branch_id: branchId },
    });
    if (!stock) {
      await stockRepo.save({
        product_id: product.id,
        branch_id: branchId,
        quantity: 4,
        min_quantity: 0,
      } as Stock);
    }
    const sale = await dataSource.getRepository(Sale).save(
      dataSource.getRepository(Sale).create({
        sale_type: SaleType.RETAIL,
        status: SaleStatus.COMPLETED,
        sale_number: `INV-20261022-${String(saleSeq).padStart(4, '0')}`,
        branch_id: branchId,
        cashier_id: cashierId,
        subtotal: '100.00',
        discount_total: '0',
        tax_total: '0',
        total: '100.00',
        amount_paid: '100.00',
        change_due: '0',
        completed_at: new Date(),
      }),
    );
    await dataSource.getRepository(SaleLine).save(
      dataSource.getRepository(SaleLine).create({
        sale_id: sale.id,
        line_number: 1,
        product_id: product.id,
        product_sku_snapshot: product.sku,
        product_name_snapshot: product.name,
        unit_price: '100.00',
        cost_price_snapshot: '80.00',
        quantity: 1,
        discount_amount: '0',
        line_total: '100.00',
        warranty: WarrantyPeriod.NO_WARRANTY,
      }),
    );
    return sale;
  }

  function voidReq(
    cookies: string[],
    saleId: string,
    approval: { approver_id: string; pin: string },
  ) {
    return http()
      .post(`/api/v1/sales/${saleId}/void`)
      .set('Cookie', cookies)
      .send({ void_reason: 'Wrong price', approval });
  }

  const pinState = (userId: string) =>
    dataSource
      .getRepository(User)
      .findOneByOrFail({ id: userId })
      .then((u) => ({
        attempts: u.approval_pin_failed_attempts,
        lockedUntil: u.approval_pin_locked_until,
      }));

  const saleStatus = (saleId: string) =>
    dataSource
      .getRepository(Sale)
      .findOneByOrFail({ id: saleId })
      .then((s) => s.status);

  /** A branch with a cashier (logged in), a PIN-holding manager and a completed sale. */
  async function tillWithSale() {
    const branch = await seedBranch();
    const cashier = await seedUser(UserRole.CASHIER, branch.id);
    const manager = await seedUser(UserRole.MANAGER, branch.id, {
      pin: true,
      name: 'Shop Manager',
    });
    const sale = await seedCompletedSale(branch.id, cashier.id);
    const cookies = await login(cashier);
    return { branch, cashier, manager, sale, cookies };
  }

  // ------------------------------------------------------------------
  // GET /approvers (P6-16)
  // ------------------------------------------------------------------

  describe('GET /approvers', () => {
    it('lists only id + full_name of active, PIN-holding admins and this branch managers', async () => {
      const branch = await seedBranch('Branch A');
      const other = await seedBranch('Branch B');
      const cashier = await seedUser(UserRole.CASHIER, branch.id);
      const managerA = await seedUser(UserRole.MANAGER, branch.id, {
        pin: true,
        name: 'Anil Manager',
      });
      const admin = await seedUser(UserRole.ADMIN, null, {
        pin: true,
        name: 'Zara Admin',
      });
      // Not listed: no PIN, other branch, inactive, soft-deleted
      await seedUser(UserRole.MANAGER, branch.id, { name: 'No Pin' });
      await seedUser(UserRole.MANAGER, other.id, {
        pin: true,
        name: 'Other Branch',
      });
      await seedUser(UserRole.MANAGER, branch.id, {
        pin: true,
        active: false,
        name: 'Inactive',
      });
      const gone = await seedUser(UserRole.MANAGER, branch.id, {
        pin: true,
        name: 'Gone',
      });
      await dataSource.getRepository(User).softDelete(gone.id);
      const cookies = await login(cashier);

      const res = await http()
        .get('/api/v1/approvers')
        .query({ branchId: branch.id })
        .set('Cookie', cookies)
        .expect(200);

      expect(res.body).toEqual([
        { id: managerA.id, full_name: 'Anil Manager' },
        { id: admin.id, full_name: 'Zara Admin' },
      ]);
    });

    it('403 when a cashier asks for another branch', async () => {
      const branch = await seedBranch('Branch A');
      const other = await seedBranch('Branch B');
      const cashier = await seedUser(UserRole.CASHIER, branch.id);
      const cookies = await login(cashier);

      await http()
        .get('/api/v1/approvers')
        .query({ branchId: other.id })
        .set('Cookie', cookies)
        .expect(403);
    });

    it('lets an admin ask for any branch', async () => {
      const other = await seedBranch('Branch B');
      const manager = await seedUser(UserRole.MANAGER, other.id, { pin: true });
      const admin = await seedUser(UserRole.ADMIN, null);
      const cookies = await login(admin);

      const res = await http()
        .get('/api/v1/approvers')
        .query({ branchId: other.id })
        .set('Cookie', cookies)
        .expect(200);

      expect(res.body).toEqual([
        { id: manager.id, full_name: manager.full_name },
      ]);
    });

    it('400 without a branchId', async () => {
      const branch = await seedBranch();
      const cashier = await seedUser(UserRole.CASHIER, branch.id);
      const cookies = await login(cashier);

      await http().get('/api/v1/approvers').set('Cookie', cookies).expect(400);
    });
  });

  // ------------------------------------------------------------------
  // PUT /auth/me/approval-pin (P6-18)
  // ------------------------------------------------------------------

  describe('PUT /auth/me/approval-pin', () => {
    it('sets the PIN; /auth/me with the same token then shows has_approval_pin: true', async () => {
      const branch = await seedBranch();
      const manager = await seedUser(UserRole.MANAGER, branch.id);
      const cookies = await login(manager);

      const before = await http()
        .get('/api/v1/auth/me')
        .set('Cookie', cookies)
        .expect(200);
      expect(before.body.user).toMatchObject({
        has_approval_pin: false,
        approval_pin_set_at: null,
      });

      const res = await http()
        .put('/api/v1/auth/me/approval-pin')
        .set('Cookie', cookies)
        .send({ current_password: PASSWORD, pin: '730415' })
        .expect(200);
      expect(res.body.has_approval_pin).toBe(true);
      expect(res.body.approval_pin_set_at).toBeTruthy();

      // Same access token: the state comes from the DB, not the JWT
      const after = await http()
        .get('/api/v1/auth/me')
        .set('Cookie', cookies)
        .expect(200);
      expect(after.body.user).toMatchObject({ has_approval_pin: true });

      // The stored value is a bcrypt hash of the PIN
      const stored = await dataSource
        .getRepository(User)
        .createQueryBuilder('u')
        .addSelect('u.approval_pin_hash')
        .where('u.id = :id', { id: manager.id })
        .getOneOrFail();
      expect(stored.approval_pin_hash).toMatch(/^\$2[aby]\$/);
      expect(await bcrypt.compare('730415', stored.approval_pin_hash!)).toBe(
        true,
      );
      const audit = await dataSource.getRepository(AuditLog).findOneByOrFail({
        action: AuditAction.APPROVAL_PIN_SET,
      });
      expect(audit).toMatchObject({
        user_id: manager.id,
        entity_id: manager.id,
      });
    });

    it('login returns has_approval_pin from the DB', async () => {
      const branch = await seedBranch();
      const manager = await seedUser(UserRole.MANAGER, branch.id, {
        pin: true,
      });

      const res = await http()
        .post('/api/v1/auth/login')
        .send({ email: manager.email, password: PASSWORD })
        .expect(200);
      expect(res.body.user).toMatchObject({ has_approval_pin: true });
    });

    it.each(['000000', '999999', '123456', '456789', '654321', '987654'])(
      'refuses the weak PIN %s with 400, without echoing it',
      async (pin) => {
        const branch = await seedBranch();
        const manager = await seedUser(UserRole.MANAGER, branch.id);
        const cookies = await login(manager);

        const res = await http()
          .put('/api/v1/auth/me/approval-pin')
          .set('Cookie', cookies)
          .send({ current_password: PASSWORD, pin })
          .expect(400);
        expect(res.body.message).toMatch(/too easy to guess/);
        expect((await pinState(manager.id)).attempts).toBe(0);
        const user = await dataSource
          .getRepository(User)
          .findOneByOrFail({ id: manager.id });
        expect(user.approval_pin_set_at).toBeNull();
      },
    );

    it('refuses a malformed PIN with 400, without echoing it', async () => {
      const branch = await seedBranch();
      const manager = await seedUser(UserRole.MANAGER, branch.id);
      const cookies = await login(manager);

      const res = await http()
        .put('/api/v1/auth/me/approval-pin')
        .set('Cookie', cookies)
        .send({ current_password: PASSWORD, pin: '73a41x' })
        .expect(400);
      expect(JSON.stringify(res.body)).not.toContain('73a41x');
      expect(JSON.stringify(res.body)).toContain(
        'pin must be exactly 6 digits',
      );
    });

    it('refuses a wrong current password with 403 WRONG_PASSWORD (not 401), audited', async () => {
      const branch = await seedBranch();
      const manager = await seedUser(UserRole.MANAGER, branch.id);
      const cookies = await login(manager);

      const res = await http()
        .put('/api/v1/auth/me/approval-pin')
        .set('Cookie', cookies)
        .send({ current_password: 'wrong-password-x', pin: '730415' })
        .expect(403);
      expect(res.body).toEqual({
        message: 'Current password is incorrect.',
        code: 'WRONG_PASSWORD',
      });
      const user = await dataSource
        .getRepository(User)
        .findOneByOrFail({ id: manager.id });
      expect(user.approval_pin_set_at).toBeNull();
      const audit = await dataSource.getRepository(AuditLog).findOneByOrFail({
        action: AuditAction.APPROVAL_PIN_SET_REJECTED,
      });
      expect(audit).toMatchObject({
        user_id: manager.id,
        entity_id: manager.id,
      });
      expect(JSON.stringify(audit)).not.toContain('wrong-password-x');
      expect(JSON.stringify(audit)).not.toContain('730415');
    });

    it('403 for a cashier', async () => {
      const branch = await seedBranch();
      const cashier = await seedUser(UserRole.CASHIER, branch.id);
      const cookies = await login(cashier);

      await http()
        .put('/api/v1/auth/me/approval-pin')
        .set('Cookie', cookies)
        .send({ current_password: PASSWORD, pin: '730415' })
        .expect(403);
    });

    it('setting a new PIN resets the count and a lock', async () => {
      const branch = await seedBranch();
      const manager = await seedUser(UserRole.MANAGER, branch.id, {
        pin: true,
      });
      await dataSource.query(
        `UPDATE users SET approval_pin_failed_attempts = 5,
                          approval_pin_locked_until = now() + interval '10 minutes'
          WHERE id = $1`,
        [manager.id],
      );
      const cookies = await login(manager);

      await http()
        .put('/api/v1/auth/me/approval-pin')
        .set('Cookie', cookies)
        .send({ current_password: PASSWORD, pin: '730415' })
        .expect(200);

      expect(await pinState(manager.id)).toEqual({
        attempts: 0,
        lockedUntil: null,
      });
    });
  });

  // ------------------------------------------------------------------
  // DELETE /users/:id/approval-pin (P6-18)
  // ------------------------------------------------------------------

  describe('DELETE /users/:id/approval-pin', () => {
    it('an admin clears a PIN with its count and lock, audited; the user then cannot approve', async () => {
      const { manager, sale, cookies } = await tillWithSale();
      await dataSource.query(
        `UPDATE users SET approval_pin_failed_attempts = 3 WHERE id = $1`,
        [manager.id],
      );
      const admin = await seedUser(UserRole.ADMIN, null);
      const adminCookies = await login(admin);

      await http()
        .delete(`/api/v1/users/${manager.id}/approval-pin`)
        .set('Cookie', adminCookies)
        .expect(204);

      const user = await dataSource
        .getRepository(User)
        .findOneByOrFail({ id: manager.id });
      expect(user.approval_pin_set_at).toBeNull();
      expect(user.approval_pin_failed_attempts).toBe(0);
      expect(user.approval_pin_locked_until).toBeNull();
      const audit = await dataSource.getRepository(AuditLog).findOneByOrFail({
        action: AuditAction.APPROVAL_PIN_CLEARED,
      });
      expect(audit).toMatchObject({ user_id: admin.id, entity_id: manager.id });

      const refused = await voidReq(
        cookies,
        sale.id,
        approvalFor(manager.id),
      ).expect(403);
      expect(refused.body.code).toBe('APPROVER_NO_PIN');
    });

    it('clearing an unset PIN is still 204 and still audited', async () => {
      const branch = await seedBranch();
      const manager = await seedUser(UserRole.MANAGER, branch.id);
      const admin = await seedUser(UserRole.ADMIN, null);
      const cookies = await login(admin);

      await http()
        .delete(`/api/v1/users/${manager.id}/approval-pin`)
        .set('Cookie', cookies)
        .expect(204);
      expect(
        await dataSource.getRepository(AuditLog).countBy({
          action: AuditAction.APPROVAL_PIN_CLEARED,
          entity_id: manager.id,
        }),
      ).toBe(1);
    });

    it('403 for a manager, 404 for an unknown user', async () => {
      const branch = await seedBranch();
      const manager = await seedUser(UserRole.MANAGER, branch.id, {
        pin: true,
      });
      const managerCookies = await login(manager);
      await http()
        .delete(`/api/v1/users/${manager.id}/approval-pin`)
        .set('Cookie', managerCookies)
        .expect(403);

      const admin = await seedUser(UserRole.ADMIN, null);
      const adminCookies = await login(admin);
      await http()
        .delete(
          '/api/v1/users/00000000-0000-0000-0000-000000000000/approval-pin',
        )
        .set('Cookie', adminCookies)
        .expect(404);
    });
  });

  // ------------------------------------------------------------------
  // The PIN check on a void (P6-17, P6-19)
  // ------------------------------------------------------------------

  describe('void: approver refusals', () => {
    it('APPROVER_NOT_FOUND for an unknown approver', async () => {
      const { sale, cookies } = await tillWithSale();
      const res = await voidReq(
        cookies,
        sale.id,
        approvalFor('00000000-0000-0000-0000-000000000000'),
      ).expect(403);
      expect(res.body).toEqual({
        message: 'Approval failed: approver not found.',
        code: 'APPROVER_NOT_FOUND',
      });
    });

    it('APPROVER_INACTIVE for an inactive manager', async () => {
      const { branch, sale, cookies } = await tillWithSale();
      const inactive = await seedUser(UserRole.MANAGER, branch.id, {
        pin: true,
        active: false,
      });
      const res = await voidReq(
        cookies,
        sale.id,
        approvalFor(inactive.id),
      ).expect(403);
      expect(res.body.code).toBe('APPROVER_INACTIVE');
    });

    it('APPROVER_NOT_MANAGER for a cashier as approver', async () => {
      const { cashier, sale, cookies } = await tillWithSale();
      const res = await voidReq(
        cookies,
        sale.id,
        approvalFor(cashier.id),
      ).expect(403);
      expect(res.body.code).toBe('APPROVER_NOT_MANAGER');
    });

    it('APPROVER_WRONG_BRANCH for a manager of another branch', async () => {
      const { sale, cookies } = await tillWithSale();
      const other = await seedBranch('Branch B');
      const otherManager = await seedUser(UserRole.MANAGER, other.id, {
        pin: true,
      });
      const res = await voidReq(
        cookies,
        sale.id,
        approvalFor(otherManager.id),
      ).expect(403);
      expect(res.body.code).toBe('APPROVER_WRONG_BRANCH');
      expect(await saleStatus(sale.id)).toBe(SaleStatus.COMPLETED);
    });

    it('APPROVER_NO_PIN for a manager without a PIN', async () => {
      const { branch, sale, cookies } = await tillWithSale();
      const noPin = await seedUser(UserRole.MANAGER, branch.id);
      const res = await voidReq(cookies, sale.id, approvalFor(noPin.id)).expect(
        403,
      );
      expect(res.body.code).toBe('APPROVER_NO_PIN');
    });

    it('an admin approves at any branch', async () => {
      const { sale, cookies } = await tillWithSale();
      const admin = await seedUser(UserRole.ADMIN, null, { pin: true });
      const res = await voidReq(cookies, sale.id, approvalFor(admin.id)).expect(
        200,
      );
      expect(res.body).toMatchObject({
        voided_by: admin.id,
        status: SaleStatus.VOIDED,
      });
    });

    it("a malformed PIN is a 400 that doesn't echo it", async () => {
      const { manager, sale, cookies } = await tillWithSale();
      const res = await voidReq(cookies, sale.id, {
        approver_id: manager.id,
        pin: '73a41x',
      }).expect(400);
      expect(JSON.stringify(res.body)).not.toContain('73a41x');
      expect((await pinState(manager.id)).attempts).toBe(0);
    });
  });

  describe('void: count, lock and reset', () => {
    it('counts wrong PINs (403 with attempts_left 4…1), locks at exactly the 5th (423), and then refuses even the right PIN without comparing', async () => {
      const { manager, sale, cookies } = await tillWithSale();

      for (const left of [4, 3, 2, 1]) {
        const res = await voidReq(
          cookies,
          sale.id,
          approvalFor(manager.id, '000001'),
        ).expect(403);
        expect(res.body).toMatchObject({
          code: 'WRONG_PIN',
          attempts_left: left,
        });
        expect(res.body.message).toBe(
          `Wrong PIN. ${left} ${left === 1 ? 'attempt' : 'attempts'} left.`,
        );
      }
      expect((await pinState(manager.id)).attempts).toBe(4);

      const fifth = await voidReq(
        cookies,
        sale.id,
        approvalFor(manager.id, '000001'),
      ).expect(423);
      expect(fifth.body).toMatchObject({ code: 'PIN_LOCKED' });
      expect(fifth.body.message).toMatch(
        /^Wrong PIN\. Shop Manager's PIN is locked until \d{1,2}:\d\d [AP]M\.$/,
      );
      // Locked for 15 minutes on the DB clock
      const [{ ok }] = await dataSource.query(
        `SELECT approval_pin_locked_until - now()
                  BETWEEN interval '14 minutes' AND interval '15 minutes' AS ok
           FROM users WHERE id = $1`,
        [manager.id],
      );
      expect(ok).toBe(true);
      expect(new Date(fifth.body.locked_until).toISOString()).toBe(
        (await pinState(manager.id)).lockedUntil!.toISOString(),
      );

      // During the lock, the RIGHT PIN is refused too, and nothing changes
      const locked = await voidReq(
        cookies,
        sale.id,
        approvalFor(manager.id),
      ).expect(423);
      expect(locked.body.code).toBe('PIN_LOCKED');
      expect(locked.body.message).toMatch(
        /^Shop Manager's PIN is locked until/,
      );
      expect((await pinState(manager.id)).attempts).toBe(5);
      expect(await saleStatus(sale.id)).toBe(SaleStatus.COMPLETED);

      // Audited: 5 failures and one lock, never the PIN
      const audits = await dataSource.getRepository(AuditLog).find();
      expect(
        audits.filter((a) => a.action === AuditAction.APPROVAL_PIN_FAILED),
      ).toHaveLength(5);
      expect(
        audits.filter((a) => a.action === AuditAction.APPROVAL_PIN_LOCKED),
      ).toHaveLength(1);
      expect(JSON.stringify(audits)).not.toContain(TEST_PIN);
      expect(JSON.stringify(audits)).not.toContain('000001');
    });

    it('a correct PIN resets the count to 0', async () => {
      const { manager, sale, cookies } = await tillWithSale();
      await voidReq(cookies, sale.id, approvalFor(manager.id, '000001')).expect(
        403,
      );
      await voidReq(cookies, sale.id, approvalFor(manager.id, '000001')).expect(
        403,
      );
      expect((await pinState(manager.id)).attempts).toBe(2);

      await voidReq(cookies, sale.id, approvalFor(manager.id)).expect(200);

      expect(await pinState(manager.id)).toEqual({
        attempts: 0,
        lockedUntil: null,
      });
    });

    it('after the lock expires the count starts again from 0', async () => {
      const { manager, sale, cookies } = await tillWithSale();
      await dataSource.query(
        `UPDATE users SET approval_pin_failed_attempts = 5,
                          approval_pin_locked_until = now() - interval '1 minute'
          WHERE id = $1`,
        [manager.id],
      );

      const res = await voidReq(
        cookies,
        sale.id,
        approvalFor(manager.id, '000001'),
      ).expect(403);
      expect(res.body).toMatchObject({ code: 'WRONG_PIN', attempts_left: 4 });
      expect(await pinState(manager.id)).toEqual({
        attempts: 1,
        lockedUntil: null,
      });

      await voidReq(cookies, sale.id, approvalFor(manager.id)).expect(200);
      expect((await pinState(manager.id)).attempts).toBe(0);
    });

    it('a wrong PIN is counted even though nothing is voided (its own committed write)', async () => {
      const { manager, sale, cookies } = await tillWithSale();

      await voidReq(cookies, sale.id, approvalFor(manager.id, '000001')).expect(
        403,
      );

      expect((await pinState(manager.id)).attempts).toBe(1);
      expect(await saleStatus(sale.id)).toBe(SaleStatus.COMPLETED);
      // ...and the next request still sees it
      const next = await voidReq(
        cookies,
        sale.id,
        approvalFor(manager.id, '000001'),
      ).expect(403);
      expect(next.body.attempts_left).toBe(3);
    });

    it('concurrent guesses queue on the approver row: the count cannot be raced past', async () => {
      const { manager, sale, cookies } = await tillWithSale();
      await dataSource.query(
        `UPDATE users SET approval_pin_failed_attempts = 3 WHERE id = $1`,
        [manager.id],
      );

      const responses = await Promise.all(
        [1, 2, 3].map(() =>
          voidReq(cookies, sale.id, approvalFor(manager.id, '000001')),
        ),
      );

      // Without the row lock all three would read 3 and write 4.
      expect(responses.map((r) => r.status).sort()).toEqual([403, 423, 423]);
      const state = await pinState(manager.id);
      expect(state.attempts).toBe(5);
      expect(state.lockedUntil).not.toBeNull();
      expect(
        await dataSource.getRepository(AuditLog).countBy({
          action: AuditAction.APPROVAL_PIN_FAILED,
        }),
      ).toBe(2);
    });

    it("self-approval on a manager's session: voided_by = void_requested_by = the manager", async () => {
      const { manager, sale } = await tillWithSale();
      const managerCookies = await login(manager);

      const res = await voidReq(
        managerCookies,
        sale.id,
        approvalFor(manager.id),
      ).expect(200);

      expect(res.body).toMatchObject({
        voided_by: manager.id,
        void_requested_by: manager.id,
      });
      const audit = await dataSource.getRepository(AuditLog).findOneByOrFail({
        action: AuditAction.VOID,
        entity_id: sale.id,
      });
      expect(audit.user_id).toBe(manager.id);
      expect(audit.description).toContain(
        `approval by Shop Manager (${manager.id})`,
      );
    });

    it('the VOID audit row names the approver and the cashier whose session it was', async () => {
      const { cashier, manager, sale, cookies } = await tillWithSale();

      await voidReq(cookies, sale.id, approvalFor(manager.id)).expect(200);

      const audit = await dataSource.getRepository(AuditLog).findOneByOrFail({
        action: AuditAction.VOID,
        entity_id: sale.id,
      });
      expect(audit).toMatchObject({
        user_id: cashier.id,
        entity_type: 'Sale',
        changes: {
          voided_by: { old: null, new: manager.id },
          void_requested_by: { old: null, new: cashier.id },
        },
      });
      expect(audit.description).toContain(
        `approval by Shop Manager (${manager.id})`,
      );
      expect(audit.description).toContain(
        `requested by ${cashier.full_name} (${cashier.id})`,
      );
      // Exactly one VOID row: the interceptor no longer writes one
      expect(
        await dataSource
          .getRepository(AuditLog)
          .countBy({ action: AuditAction.VOID }),
      ).toBe(1);
    });
  });

  // ------------------------------------------------------------------
  // Auto-clear and the role CHECK (P6-15)
  // ------------------------------------------------------------------

  describe('auto-clear', () => {
    it('deactivating a user clears their PIN, count and lock', async () => {
      const branch = await seedBranch();
      const manager = await seedUser(UserRole.MANAGER, branch.id, {
        pin: true,
      });
      await dataSource.query(
        `UPDATE users SET approval_pin_failed_attempts = 2 WHERE id = $1`,
        [manager.id],
      );

      await app.get(UsersService).deactivate(manager.id);

      const user = await dataSource
        .getRepository(User)
        .createQueryBuilder('u')
        .addSelect('u.approval_pin_hash')
        .where('u.id = :id', { id: manager.id })
        .getOneOrFail();
      expect(user).toMatchObject({
        is_active: false,
        approval_pin_hash: null,
        approval_pin_set_at: null,
        approval_pin_failed_attempts: 0,
        approval_pin_locked_until: null,
      });
    });

    it('a PIN holder cannot become a cashier until the PIN is cleared (CHK_users_approval_pin_role)', async () => {
      const branch = await seedBranch();
      const manager = await seedUser(UserRole.MANAGER, branch.id, {
        pin: true,
      });

      await expect(
        dataSource.query(`UPDATE users SET role = 'cashier' WHERE id = $1`, [
          manager.id,
        ]),
      ).rejects.toThrow(/CHK_users_approval_pin_role/);

      await dataSource.query(
        `UPDATE users SET approval_pin_hash = NULL, approval_pin_set_at = NULL WHERE id = $1`,
        [manager.id],
      );
      await dataSource.query(
        `UPDATE users SET role = 'cashier' WHERE id = $1`,
        [manager.id],
      );
    });
  });

  // ------------------------------------------------------------------
  // Never leak the PIN (P6-19)
  // ------------------------------------------------------------------

  describe('no leaks', () => {
    it('the PIN and the password never reach console output', async () => {
      const { manager, sale, cookies } = await tillWithSale();
      const managerCookies = await login(manager);
      const written: string[] = [];
      const capture =
        (orig: (...a: never[]) => unknown) =>
        (...args: unknown[]) => {
          written.push(args.map((a) => String(a)).join(' '));
          return Reflect.apply(orig, undefined, args) as unknown;
        };
      const spies = [
        jest
          .spyOn(process.stdout, 'write')
          .mockImplementation(
            capture(process.stdout.write.bind(process.stdout)) as never,
          ),
        jest
          .spyOn(process.stderr, 'write')
          .mockImplementation(
            capture(process.stderr.write.bind(process.stderr)) as never,
          ),
        jest
          .spyOn(console, 'log')
          .mockImplementation(capture(console.log) as never),
        jest
          .spyOn(console, 'error')
          .mockImplementation(capture(console.error) as never),
        jest
          .spyOn(console, 'warn')
          .mockImplementation(capture(console.warn) as never),
      ];
      try {
        await voidReq(
          cookies,
          sale.id,
          approvalFor(manager.id, '264850'),
        ).expect(403);
        await voidReq(cookies, sale.id, {
          approver_id: manager.id,
          pin: 'x26485',
        }).expect(400);
        await http()
          .put('/api/v1/auth/me/approval-pin')
          .set('Cookie', managerCookies)
          .send({ current_password: 'leak-check-pw', pin: '591736' })
          .expect(403);
        await http()
          .put('/api/v1/auth/me/approval-pin')
          .set('Cookie', managerCookies)
          .send({ current_password: PASSWORD, pin: '591736' })
          .expect(200);
        await voidReq(
          cookies,
          sale.id,
          approvalFor(manager.id, '591736'),
        ).expect(200);
        await new Promise((r) => setTimeout(r, 100));
      } finally {
        spies.forEach((s) => s.mockRestore());
      }

      const out = written.join('\n');
      for (const secret of [
        '264850',
        'x26485',
        '591736',
        'leak-check-pw',
        PASSWORD,
      ]) {
        expect(out).not.toContain(secret);
      }
    });
  });
});
