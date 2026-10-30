import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { createTestApp, truncateAllTables } from './setup';
import { giveApprovalPin } from './approval-pin.helper';
import { User } from '../src/users/entities/user.entity';
import { UserRole } from '../src/users/enums/user-role.enum';
import { Branch } from '../src/branches/entities/branch.entity';
import { RefreshToken } from '../src/auth/entities/refresh-token.entity';
import { AuditLog } from '../src/audit-log/entities/audit-log.entity';
import { AuditAction } from '../src/audit-log/enums/audit-action.enum';
import { UsersService } from '../src/users/users.service';

const PASSWORD = 'testpass123';
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/**
 * PATCH /users/:id/role (Task 2.2): role and branch rules, PIN clearing on
 * demotion to cashier, last-admin protection under the deactivate locks,
 * the ROLE_CHANGED audit row, and sessions after a change. One database is
 * seeded for most tests (logins are throttled); the last-admin tests at
 * the end start from an empty one.
 */
describe('User role management (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let seq = 0;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  async function seedBranch(active = true): Promise<Branch> {
    const repo = dataSource.getRepository(Branch);
    return repo.save(
      repo.create({ name: `Branch ${++seq}`, is_active: active }),
    );
  }

  async function seedUser(
    role: UserRole,
    branchId: string | null,
    opts: { active?: boolean; pin?: boolean } = {},
  ): Promise<User> {
    const repo = dataSource.getRepository(User);
    const n = ++seq;
    const user = await repo.save(
      repo.create({
        email: `${role}${n}@roles.test`,
        password_hash: await bcrypt.hash(PASSWORD, 4),
        full_name: `Test ${role} ${n}`,
        role,
        is_active: opts.active ?? true,
        branch_id: role === UserRole.ADMIN ? null : branchId,
      }),
    );
    if (opts.pin) await giveApprovalPin(dataSource, user.id);
    return dataSource.getRepository(User).findOneByOrFail({ id: user.id });
  }

  async function cookiesFor(user: User): Promise<string[]> {
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    return res.headers['set-cookie'] as unknown as string[];
  }

  const refreshTokenIn = (cookies: string[]): string => {
    const cookie = cookies.find((c) => c.startsWith('refresh_token='))!;
    return cookie.slice('refresh_token='.length, cookie.indexOf(';'));
  };

  /** The stored user with the PIN hash opted in. */
  const storedUser = (id: string) =>
    dataSource
      .getRepository(User)
      .createQueryBuilder('u')
      .addSelect('u.approval_pin_hash')
      .where('u.id = :id', { id })
      .getOneOrFail();

  const roleAudits = (entityId: string) =>
    dataSource.getRepository(AuditLog).findBy({
      action: AuditAction.ROLE_CHANGED,
      entity_type: 'User',
      entity_id: entityId,
    });

  describe('with a seeded shop', () => {
    let branch: Branch;
    let otherBranch: Branch;
    let admin: User;
    let adminCookies: string[];
    let managerCookies: string[];
    let cashierCookies: string[];

    const changeRole = (id: string, body: object, cookies = adminCookies) =>
      http()
        .patch(`/api/v1/users/${id}/role`)
        .set('Cookie', cookies)
        .send(body);

    beforeAll(async () => {
      await truncateAllTables(app);
      branch = await seedBranch();
      otherBranch = await seedBranch();
      admin = await seedUser(UserRole.ADMIN, null);
      await seedUser(UserRole.ADMIN, null); // so admins can be demoted
      managerCookies = await cookiesFor(
        await seedUser(UserRole.MANAGER, branch.id),
      );
      cashierCookies = await cookiesFor(
        await seedUser(UserRole.CASHIER, branch.id),
      );
      adminCookies = await cookiesFor(admin);
    });

    beforeEach(async () => {
      // Keeps each test clear of the per-route throttle (10 a second).
      await pause(1_100);
    });

    describe('authorization', () => {
      it('401 without a session', async () => {
        const target = await seedUser(UserRole.CASHIER, branch.id);
        await http()
          .patch(`/api/v1/users/${target.id}/role`)
          .send({ role: UserRole.ADMIN })
          .expect(401);
      });

      it.each([
        ['manager', () => managerCookies],
        ['cashier', () => cashierCookies],
      ])('403 for a %s, changing nothing', async (_, cookies) => {
        const target = await seedUser(UserRole.CASHIER, branch.id);
        await changeRole(target.id, { role: UserRole.ADMIN }, cookies()).expect(
          403,
        );
        expect((await storedUser(target.id)).role).toBe(UserRole.CASHIER);
        expect(await roleAudits(target.id)).toHaveLength(0);
      });
    });

    describe('role and branch rules', () => {
      it.each([UserRole.MANAGER, UserRole.CASHIER])(
        'admin → %s at an active branch',
        async (role) => {
          const target = await seedUser(UserRole.ADMIN, null);
          const res = await changeRole(target.id, {
            role,
            branch_id: branch.id,
          }).expect(200);
          expect(res.body).toMatchObject({
            id: target.id,
            role,
            branch_id: branch.id,
            branch: { id: branch.id },
          });
        },
      );

      it.each([UserRole.MANAGER, UserRole.CASHIER])(
        'admin → %s is a 400 without a branch, with a null branch, or at an inactive or unknown one',
        async (role) => {
          const target = await seedUser(UserRole.ADMIN, null);
          const closed = await seedBranch(false);
          for (const body of [
            { role },
            { role, branch_id: null },
            { role, branch_id: closed.id },
            { role, branch_id: randomUUID() },
          ]) {
            await changeRole(target.id, body).expect(400);
          }
          const stored = await storedUser(target.id);
          expect(stored).toMatchObject({
            role: UserRole.ADMIN,
            branch_id: null,
          });
        },
      );

      it.each([
        ['manager', UserRole.MANAGER, {}],
        ['cashier', UserRole.CASHIER, { branch_id: null }],
      ])(
        '%s → admin clears the branch (branch_id omitted or null)',
        async (_, role, extra) => {
          const target = await seedUser(role, branch.id);
          const res = await changeRole(target.id, {
            role: UserRole.ADMIN,
            ...extra,
          }).expect(200);
          expect(res.body).toMatchObject({
            role: UserRole.ADMIN,
            branch_id: null,
            branch: null,
          });
          expect((await storedUser(target.id)).branch_id).toBeNull();
        },
      );

      it('manager → admin keeps the approval PIN', async () => {
        const target = await seedUser(UserRole.MANAGER, branch.id, {
          pin: true,
        });
        await changeRole(target.id, { role: UserRole.ADMIN }).expect(200);
        const stored = await storedUser(target.id);
        expect(stored.approval_pin_hash).not.toBeNull();
        expect(stored.approval_pin_set_at).toEqual(target.approval_pin_set_at);
      });

      it('moves a staff user to another active branch with the same role', async () => {
        const target = await seedUser(UserRole.MANAGER, branch.id);
        await changeRole(target.id, {
          role: UserRole.MANAGER,
          branch_id: otherBranch.id,
        }).expect(200);
        expect((await storedUser(target.id)).branch_id).toBe(otherBranch.id);
      });

      it('refuses a staff move to an inactive or unknown branch', async () => {
        const target = await seedUser(UserRole.CASHIER, branch.id);
        const closed = await seedBranch(false);
        for (const branchId of [closed.id, randomUUID()]) {
          await changeRole(target.id, {
            role: UserRole.CASHIER,
            branch_id: branchId,
          }).expect(400);
        }
        expect((await storedUser(target.id)).branch_id).toBe(branch.id);
      });

      it.each([
        ['an admin with a branch', { role: UserRole.ADMIN, branch_id: 'B' }],
        ['a missing role', { branch_id: 'B' }],
        ['a null role', { role: null, branch_id: 'B' }],
        ['an unknown role', { role: 'owner', branch_id: 'B' }],
        [
          'a branch that is not a UUID',
          { role: UserRole.CASHIER, branch_id: 'x' },
        ],
        [
          'an extra field',
          { role: UserRole.CASHIER, branch_id: 'B', is_active: false },
        ],
      ])('400 for %s, changing nothing', async (_, template) => {
        const target = await seedUser(UserRole.MANAGER, branch.id);
        const body = JSON.parse(
          JSON.stringify(template).replace('"B"', `"${otherBranch.id}"`),
        ) as object;
        await changeRole(target.id, body).expect(400);
        const stored = await storedUser(target.id);
        expect(stored).toMatchObject({
          role: UserRole.MANAGER,
          branch_id: branch.id,
        });
        expect(await roleAudits(target.id)).toHaveLength(0);
      });

      it('404 for an unknown or soft-deleted user, 400 for a bad id', async () => {
        const deleted = await seedUser(UserRole.CASHIER, branch.id);
        await dataSource.getRepository(User).softDelete(deleted.id);
        await changeRole(randomUUID(), { role: UserRole.ADMIN }).expect(404);
        await changeRole(deleted.id, { role: UserRole.ADMIN }).expect(404);
        await changeRole('not-a-uuid', { role: UserRole.ADMIN }).expect(400);
      });

      it('asking for the current role and branch changes nothing', async () => {
        const target = await seedUser(UserRole.CASHIER, branch.id);
        const session = await cookiesFor(target);
        await changeRole(target.id, {
          role: UserRole.CASHIER,
          branch_id: branch.id,
        }).expect(200);
        expect(await roleAudits(target.id)).toHaveLength(0);
        const token = await dataSource
          .getRepository(RefreshToken)
          .findOneByOrFail({ token_hash: hash(refreshTokenIn(session)) });
        expect(token.revoked_at).toBeNull();
      });
    });

    describe('approval PIN on demotion', () => {
      it.each([
        ['a manager', UserRole.MANAGER],
        ['an admin', UserRole.ADMIN],
      ])(
        'demoting %s to cashier clears the PIN, its count and lock; they no longer approve',
        async (_, role) => {
          const target = await seedUser(role, branch.id, { pin: true });
          await dataSource.query(
            `UPDATE users SET approval_pin_failed_attempts = 3,
                              approval_pin_locked_until = now() + interval '1 hour'
              WHERE id = $1`,
            [target.id],
          );

          const res = await changeRole(target.id, {
            role: UserRole.CASHIER,
            branch_id: branch.id,
          }).expect(200);
          expect(res.body).toMatchObject({ approval_pin_set_at: null });

          expect(await storedUser(target.id)).toMatchObject({
            role: UserRole.CASHIER,
            approval_pin_hash: null,
            approval_pin_set_at: null,
            approval_pin_failed_attempts: 0,
            approval_pin_locked_until: null,
          });
          const approvers = await http()
            .get(`/api/v1/approvers?branchId=${branch.id}`)
            .set('Cookie', adminCookies)
            .expect(200);
          expect(
            (approvers.body as { id: string }[]).map((a) => a.id),
          ).not.toContain(target.id);

          const [audit] = await roleAudits(target.id);
          expect(audit.changes).toMatchObject({
            approval_pin_set_at: { new: null },
          });
        },
      );
    });

    describe('audit', () => {
      it('records old and new role and branch, and the acting admin, never a secret', async () => {
        const target = await seedUser(UserRole.MANAGER, branch.id, {
          pin: true,
        });
        await changeRole(target.id, {
          role: UserRole.CASHIER,
          branch_id: otherBranch.id,
        }).expect(200);

        const audits = await roleAudits(target.id);
        expect(audits).toHaveLength(1);
        expect(audits[0]).toMatchObject({
          user_id: admin.id,
          user_name: admin.full_name,
          user_role: UserRole.ADMIN,
          changes: {
            role: { old: UserRole.MANAGER, new: UserRole.CASHIER },
            branch_id: { old: branch.id, new: otherBranch.id },
            approval_pin_set_at: { new: null },
          },
        });
        const text = JSON.stringify(audits[0]);
        expect(text).not.toMatch(/\$2[aby]\$/);
        expect(text).not.toContain(PASSWORD);
        expect(text).not.toContain('482916'); // TEST_PIN
      });

      it('the response carries no secret', async () => {
        const target = await seedUser(UserRole.MANAGER, branch.id, {
          pin: true,
        });
        const res = await changeRole(target.id, {
          role: UserRole.ADMIN,
        }).expect(200);
        const text = JSON.stringify(res.body);
        for (const key of [
          'password_hash',
          'approval_pin_hash',
          'approval_pin_failed_attempts',
          'approval_pin_locked_until',
          'token_hash',
        ]) {
          expect(text).not.toContain(`"${key}"`);
        }
        expect(text).not.toMatch(/\$2[aby]\$/);
      });
    });

    describe('sessions', () => {
      it('a demotion applies to the next request and revokes refresh tokens', async () => {
        const target = await seedUser(UserRole.MANAGER, branch.id);
        const session = await cookiesFor(target);
        await http()
          .get('/api/v1/product-units')
          .set('Cookie', session)
          .expect(200);

        await changeRole(target.id, {
          role: UserRole.CASHIER,
          branch_id: branch.id,
        }).expect(200);

        // Same access token, new role: managers-only route now refused.
        await http()
          .get('/api/v1/product-units')
          .set('Cookie', session)
          .expect(403);
        const me = await http()
          .get('/api/v1/auth/me')
          .set('Cookie', session)
          .expect(200);
        expect(me.body).toMatchObject({ user: { role: UserRole.CASHIER } });

        await http()
          .post('/api/v1/auth/refresh')
          .set('Cookie', `refresh_token=${refreshTokenIn(session)}`)
          .expect(401);
        // A new login works and carries the new role.
        await cookiesFor(target);
      });

      it('a promotion applies to the next request', async () => {
        const target = await seedUser(UserRole.CASHIER, branch.id);
        const session = await cookiesFor(target);
        await http().get('/api/v1/users').set('Cookie', session).expect(403);

        await changeRole(target.id, { role: UserRole.ADMIN }).expect(200);

        await http().get('/api/v1/users').set('Cookie', session).expect(200);
      });
    });

    it('400 CANNOT_CHANGE_OWN_ROLE for your own account', async () => {
      const res = await changeRole(admin.id, {
        role: UserRole.MANAGER,
        branch_id: branch.id,
      }).expect(400);
      expect(res.body).toMatchObject({ code: 'CANNOT_CHANGE_OWN_ROLE' });
      expect((await storedUser(admin.id)).role).toBe(UserRole.ADMIN);
    });
  });

  describe('last active admin', () => {
    let branch: Branch;

    beforeEach(async () => {
      await truncateAllTables(app);
      branch = await seedBranch();
    });

    it('cannot be demoted (service, real locks)', async () => {
      const only = await seedUser(UserRole.ADMIN, null);
      // An actor no longer an active admin: reachable over HTTP only
      // through a race, since the caller is always an active admin.
      const formerAdmin = await seedUser(UserRole.ADMIN, null, {
        active: false,
      });

      await expect(
        app
          .get(UsersService)
          .changeRole(
            only.id,
            { role: UserRole.MANAGER, branch_id: branch.id },
            formerAdmin,
          ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'LAST_ACTIVE_ADMIN',
        }) as object,
      });
      expect((await storedUser(only.id)).role).toBe(UserRole.ADMIN);
    });

    it('waits for a concurrent demotion, then refuses to demote the last admin', async () => {
      const a = await seedUser(UserRole.ADMIN, null);
      const b = await seedUser(UserRole.ADMIN, null);

      // Another transaction (as changeRole does) locks the active admins
      // and demotes A, but has not committed yet.
      const other = dataSource.createQueryRunner();
      await other.connect();
      await other.startTransaction();
      let outcome: unknown;
      try {
        await other.query(
          `SELECT id FROM users WHERE role = 'admin' AND is_active ORDER BY id FOR UPDATE`,
        );
        await other.query(
          `UPDATE users SET role = 'manager', branch_id = $2 WHERE id = $1`,
          [a.id, branch.id],
        );

        // A, still signed in, demotes B meanwhile: it must wait.
        const pending = app
          .get(UsersService)
          .changeRole(b.id, { role: UserRole.MANAGER, branch_id: branch.id }, a)
          .then(
            () => 'changed',
            (error: unknown) => error,
          );
        await pause(500);
        await other.commitTransaction();
        outcome = await pending;
      } finally {
        if (other.isTransactionActive) await other.rollbackTransaction();
        await other.release();
      }

      expect(outcome).toMatchObject({
        response: expect.objectContaining({
          code: 'LAST_ACTIVE_ADMIN',
        }) as object,
      });
      expect((await storedUser(b.id)).role).toBe(UserRole.ADMIN);
    });

    it('a concurrent deactivation and demotion leave one active admin', async () => {
      const a = await seedUser(UserRole.ADMIN, null);
      const b = await seedUser(UserRole.ADMIN, null);

      // A deactivation of A holds the admin locks; demoting B waits for it.
      const other = dataSource.createQueryRunner();
      await other.connect();
      await other.startTransaction();
      let outcome: unknown;
      try {
        await other.query(
          `SELECT id FROM users WHERE role = 'admin' AND is_active ORDER BY id FOR UPDATE`,
        );
        await other.query(`UPDATE users SET is_active = false WHERE id = $1`, [
          a.id,
        ]);
        const pending = app
          .get(UsersService)
          .changeRole(b.id, { role: UserRole.CASHIER, branch_id: branch.id }, a)
          .then(
            () => 'changed',
            (error: unknown) => error,
          );
        await pause(500);
        await other.commitTransaction();
        outcome = await pending;
      } finally {
        if (other.isTransactionActive) await other.rollbackTransaction();
        await other.release();
      }

      expect(outcome).toMatchObject({
        response: expect.objectContaining({
          code: 'LAST_ACTIVE_ADMIN',
        }) as object,
      });
      expect(
        await dataSource
          .getRepository(User)
          .countBy({ role: UserRole.ADMIN, is_active: true }),
      ).toBe(1);
    });
  });
});
