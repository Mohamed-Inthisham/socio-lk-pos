import { INestApplication, Logger } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { createTestApp, truncateAllTables } from './setup';
import { User } from '../src/users/entities/user.entity';
import { UserRole } from '../src/users/enums/user-role.enum';
import { Branch } from '../src/branches/entities/branch.entity';
import { AuditLog } from '../src/audit-log/entities/audit-log.entity';
import { AuditAction } from '../src/audit-log/enums/audit-action.enum';
import { UsersService } from '../src/users/users.service';
import { AuthService } from '../src/auth/auth.service';

const PASSWORD = 'testpass123';
const NEW_PASSWORD = 'fresh-pass-456';
// 37 two-byte letters: 37 characters, 74 bytes.
const TOO_LONG = 'é'.repeat(37);
const BCRYPT_VALUE = /\$2[aby]\$\d\d\$/;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * POST /users/:id/password and PUT /auth/me/password (Task 2.3): password
 * rules, hashing, refresh-token revocation, the PASSWORD_RESET and
 * PASSWORD_CHANGED audit rows, and no secret in a response or an audit row.
 *
 * Sessions are mostly started with AuthService.login (what POST /auth/login
 * does after checking the password), not over HTTP: the login route allows
 * only 20 attempts per IP per 15 minutes. HTTP login is used where the
 * point is which password it accepts.
 */
describe('User password management (e2e)', () => {
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

  async function seedBranch(): Promise<Branch> {
    const repo = dataSource.getRepository(Branch);
    return repo.save(repo.create({ name: `Branch ${++seq}`, is_active: true }));
  }

  async function seedUser(
    role: UserRole,
    branchId: string | null,
    opts: { active?: boolean } = {},
  ): Promise<User> {
    const repo = dataSource.getRepository(User);
    const n = ++seq;
    const user = await repo.save(
      repo.create({
        email: `${role}${n}@passwords.test`,
        password_hash: await bcrypt.hash(PASSWORD, 4),
        full_name: `Test ${role} ${n}`,
        role,
        is_active: opts.active ?? true,
        branch_id: role === UserRole.ADMIN ? null : branchId,
      }),
    );
    return repo.findOneByOrFail({ id: user.id });
  }

  /** Session cookies for a user, as a login would set them. */
  async function sessionFor(user: User): Promise<string[]> {
    const tokens = await app.get(AuthService).login(user, null, null);
    return [
      `access_token=${tokens.access_token}`,
      `refresh_token=${tokens.refresh_token}`,
    ];
  }

  const accessOnly = (cookies: string[]) =>
    cookies.filter((c) => c.startsWith('access_token='));

  /** Cookie pairs (name=value) from a response's Set-Cookie headers. */
  const setCookies = (res: request.Response): string[] =>
    ((res.headers['set-cookie'] as unknown as string[] | undefined) ?? []).map(
      (c) => c.slice(0, c.indexOf(';')),
    );

  const refresh = (cookies: string[]) =>
    http()
      .post('/api/v1/auth/refresh')
      .set(
        'Cookie',
        cookies.filter((c) => c.startsWith('refresh_token=')),
      );

  const login = (email: string, password: string) =>
    http().post('/api/v1/auth/login').send({ email, password });

  const storedHash = async (id: string): Promise<string> =>
    (
      await dataSource
        .getRepository(User)
        .createQueryBuilder('u')
        .addSelect('u.password_hash')
        .where('u.id = :id', { id })
        .getOneOrFail()
    ).password_hash;

  const audits = (action: AuditAction, entityId: string) =>
    dataSource.getRepository(AuditLog).findBy({
      action,
      entity_type: 'User',
      entity_id: entityId,
    });

  /** Nothing a password, its hash or a bcrypt value could hide in. */
  function expectNoSecrets(value: unknown, ...passwords: string[]) {
    const text = JSON.stringify(value ?? null);
    for (const password of passwords) expect(text).not.toContain(password);
    expect(text).not.toMatch(BCRYPT_VALUE);
    expect(text).not.toMatch(
      /"(password_hash|new_password|current_password)":/,
    );
  }

  describe('with a seeded shop', () => {
    let branch: Branch;
    let admin: User;
    let adminCookies: string[];
    let managerCookies: string[];
    let cashierCookies: string[];

    beforeAll(async () => {
      await truncateAllTables(app);
      branch = await seedBranch();
      admin = await seedUser(UserRole.ADMIN, null);
      adminCookies = await sessionFor(admin);
      managerCookies = await sessionFor(
        await seedUser(UserRole.MANAGER, branch.id),
      );
      cashierCookies = await sessionFor(
        await seedUser(UserRole.CASHIER, branch.id),
      );
    });

    beforeEach(async () => {
      // Keeps each test clear of the per-route throttle (10 a second).
      await pause(1_100);
    });

    describe('POST /users/:id/password (admin reset)', () => {
      const reset = (id: string, body: object, cookies = adminCookies) =>
        http()
          .post(`/api/v1/users/${id}/password`)
          .set('Cookie', accessOnly(cookies))
          .send(body);

      it('401 without a session', async () => {
        const target = await seedUser(UserRole.CASHIER, branch.id);
        await http()
          .post(`/api/v1/users/${target.id}/password`)
          .send({ new_password: NEW_PASSWORD })
          .expect(401);
      });

      it.each([
        ['manager', () => managerCookies],
        ['cashier', () => cashierCookies],
      ])('403 for a %s, password unchanged', async (_, cookies) => {
        const target = await seedUser(UserRole.CASHIER, branch.id);
        await reset(
          target.id,
          { new_password: NEW_PASSWORD },
          cookies(),
        ).expect(403);
        expect(
          await bcrypt.compare(PASSWORD, await storedHash(target.id)),
        ).toBe(true);
      });

      it('resets a cashier: 204, new hash, old password refused, new accepted, sessions revoked, audited', async () => {
        const target = await seedUser(UserRole.CASHIER, branch.id);
        const targetSession = await sessionFor(target);
        const before = await storedHash(target.id);

        const res = await reset(target.id, {
          new_password: NEW_PASSWORD,
        }).expect(204);
        expect(res.text).toBe('');

        const after = await storedHash(target.id);
        expect(after).not.toBe(before);
        expect(after).toMatch(BCRYPT_VALUE);
        expect(await bcrypt.compare(NEW_PASSWORD, after)).toBe(true);

        await login(target.email, PASSWORD).expect(401);
        await login(target.email, NEW_PASSWORD).expect(200);
        await refresh(targetSession).expect(401);

        const [entry, ...more] = await audits(
          AuditAction.PASSWORD_RESET,
          target.id,
        );
        expect(more).toHaveLength(0);
        expect(entry).toMatchObject({
          user_id: admin.id,
          user_name: admin.full_name,
          user_role: UserRole.ADMIN,
          changes: null,
          description: `Password of ${target.full_name} reset by an admin.`,
        });
        expect(entry.created_at).toBeInstanceOf(Date);
        expectNoSecrets(entry, PASSWORD, NEW_PASSWORD, before, after);
      });

      it.each([UserRole.MANAGER, UserRole.ADMIN])(
        'resets a %s',
        async (role) => {
          const target = await seedUser(role, branch.id);
          await reset(target.id, { new_password: NEW_PASSWORD }).expect(204);
          expect(
            await bcrypt.compare(NEW_PASSWORD, await storedHash(target.id)),
          ).toBe(true);
        },
      );

      it('resets an inactive user, who stays inactive', async () => {
        const target = await seedUser(UserRole.CASHIER, branch.id, {
          active: false,
        });
        await reset(target.id, { new_password: NEW_PASSWORD }).expect(204);
        const stored = await dataSource
          .getRepository(User)
          .findOneByOrFail({ id: target.id });
        expect(stored.is_active).toBe(false);
        expect(
          await bcrypt.compare(NEW_PASSWORD, await storedHash(target.id)),
        ).toBe(true);
      });

      it.each([
        ['too short', { new_password: 'short7!' }],
        ['over 72 bytes', { new_password: TOO_LONG }],
        ['missing', {}],
        ['not a string', { new_password: 12345678 }],
        [
          'with an unknown field',
          { new_password: NEW_PASSWORD, password_confirmation: NEW_PASSWORD },
        ],
      ])(
        '400 for a password %s; nothing changed, sessions kept',
        async (_, body) => {
          const target = await seedUser(UserRole.CASHIER, branch.id);
          const targetSession = await sessionFor(target);
          const before = await storedHash(target.id);

          const res = await reset(target.id, body).expect(400);

          expectNoSecrets(res.body, NEW_PASSWORD, TOO_LONG);
          expect(await storedHash(target.id)).toBe(before);
          await refresh(targetSession).expect(200);
          expect(await audits(AuditAction.PASSWORD_RESET, target.id)).toEqual(
            [],
          );
        },
      );

      it('404 for an unknown user, 404 for a deleted one, 400 for a bad id', async () => {
        await reset(randomUUID(), { new_password: NEW_PASSWORD }).expect(404);
        const deleted = await seedUser(UserRole.CASHIER, branch.id);
        await app.get(UsersService).softDelete(deleted.id);
        await reset(deleted.id, { new_password: NEW_PASSWORD }).expect(404);
        await reset('not-a-uuid', { new_password: NEW_PASSWORD }).expect(400);
      });

      it("refuses the admin's own account (400 CANNOT_RESET_OWN_PASSWORD)", async () => {
        const before = await storedHash(admin.id);
        const res = await reset(admin.id, {
          new_password: NEW_PASSWORD,
        }).expect(400);
        expect(res.body).toMatchObject({ code: 'CANNOT_RESET_OWN_PASSWORD' });
        expect(await storedHash(admin.id)).toBe(before);
      });
    });

    describe('PUT /auth/me/password (own change)', () => {
      const change = (cookies: string[], body: object) =>
        http()
          .put('/api/v1/auth/me/password')
          .set('Cookie', accessOnly(cookies))
          .send(body);
      const valid = {
        current_password: PASSWORD,
        new_password: NEW_PASSWORD,
      };

      it('401 without a session', async () => {
        await http().put('/api/v1/auth/me/password').send(valid).expect(401);
      });

      it.each([UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER])(
        'a %s changes their own password: 204, new cookies, every old refresh token revoked, audited',
        async (role) => {
          const user = await seedUser(role, branch.id);
          const thisDevice = await sessionFor(user);
          const otherDevice = await sessionFor(user);
          const before = await storedHash(user.id);

          const res = await change(thisDevice, valid).expect(204);

          expect(res.text).toBe('');
          const after = await storedHash(user.id);
          expect(await bcrypt.compare(NEW_PASSWORD, after)).toBe(true);
          expect(await bcrypt.compare(PASSWORD, after)).toBe(false);

          // The pair set on this response is a working session.
          const issued = setCookies(res);
          expect(issued.map((c) => c.split('=')[0]).sort()).toEqual([
            'access_token',
            'refresh_token',
          ]);
          await http()
            .get('/api/v1/auth/me')
            .set('Cookie', accessOnly(issued))
            .expect(200);

          // Every refresh token from before is revoked, this device's too.
          await refresh(otherDevice).expect(401);
          await refresh(thisDevice).expect(401);

          const [entry, ...more] = await audits(
            AuditAction.PASSWORD_CHANGED,
            user.id,
          );
          expect(more).toHaveLength(0);
          expect(entry).toMatchObject({
            user_id: user.id,
            user_name: user.full_name,
            user_role: role,
            changes: null,
            description: 'Password changed.',
          });
          expectNoSecrets(entry, PASSWORD, NEW_PASSWORD, before, after);
        },
      );

      it('the new session cookies refresh, and the old access token lasts until it expires', async () => {
        const user = await seedUser(UserRole.CASHIER, branch.id);
        const thisDevice = await sessionFor(user);

        const res = await change(thisDevice, valid).expect(204);

        await refresh(setCookies(res)).expect(200);
        // Access tokens aren't revoked: the old one works for the rest of
        // its 15 minutes (the user is re-read, not the password).
        await http()
          .get('/api/v1/auth/me')
          .set('Cookie', accessOnly(thisDevice))
          .expect(200);
      });

      describe('when no new session can be started after the change', () => {
        // Words an internal error might carry; none may reach the client.
        const INTERNAL = 'QueryFailedError secret-signing-key at Pool.connect';

        afterEach(() => {
          jest.restoreAllMocks();
        });

        it.each([
          ['signing the new tokens', () => AuthService, 'login'],
          ['re-reading the user', () => UsersService, 'findByIdForAuth'],
        ] as const)(
          'fails while %s: 503 PASSWORD_CHANGED_SIGN_IN_AGAIN, no cookies, the change kept',
          async (_, service, method) => {
            const user = await seedUser(UserRole.CASHIER, branch.id);
            const thisDevice = await sessionFor(user);
            const otherDevice = await sessionFor(user);
            const before = await storedHash(user.id);
            const logged = jest
              .spyOn(Logger.prototype, 'error')
              .mockImplementation(() => undefined);
            jest
              .spyOn(app.get<object>(service()), method as never)
              .mockRejectedValueOnce(new Error(INTERNAL) as never);

            const res = await change(thisDevice, valid).expect(503);

            expect(res.body).toEqual({
              message: 'Your password was changed. Please sign in again.',
              code: 'PASSWORD_CHANGED_SIGN_IN_AGAIN',
            });
            expect(res.text).not.toContain('secret-signing-key');
            expect(res.text).not.toMatch(/QueryFailedError|at \w+\.|stack/);
            expectNoSecrets(res.body, PASSWORD, NEW_PASSWORD);
            expect(setCookies(res)).toEqual([]);

            // Logged on the server, without a password or a token.
            expect(logged).toHaveBeenCalledTimes(1);
            const line = String(logged.mock.calls[0][0]);
            expect(line).toContain(user.id);
            for (const secret of [PASSWORD, NEW_PASSWORD, ...thisDevice]) {
              expect(line).not.toContain(secret);
            }

            // The committed change stays: new hash, old sessions revoked,
            // one audit row.
            const after = await storedHash(user.id);
            expect(after).not.toBe(before);
            expect(await bcrypt.compare(NEW_PASSWORD, after)).toBe(true);
            await refresh(otherDevice).expect(401);
            expect(
              await audits(AuditAction.PASSWORD_CHANGED, user.id),
            ).toHaveLength(1);

            // Once sessions can be issued again, the new password logs in.
            jest.restoreAllMocks();
            await login(user.email, PASSWORD).expect(401);
            const relogin = await login(user.email, NEW_PASSWORD).expect(200);
            expect(
              setCookies(relogin)
                .map((c) => c.split('=')[0])
                .sort(),
            ).toEqual(['access_token', 'refresh_token']);
          },
        );
      });

      it('over HTTP login: the old password is refused, the new one accepted', async () => {
        const user = await seedUser(UserRole.MANAGER, branch.id);
        await change(await sessionFor(user), valid).expect(204);
        await login(user.email, PASSWORD).expect(401);
        await login(user.email, NEW_PASSWORD).expect(200);
      });

      it('403 WRONG_PASSWORD for a wrong current password: nothing changed, sessions kept, not audited', async () => {
        const user = await seedUser(UserRole.CASHIER, branch.id);
        const session = await sessionFor(user);
        const before = await storedHash(user.id);

        const res = await change(session, {
          current_password: 'not-my-password',
          new_password: NEW_PASSWORD,
        }).expect(403);

        expect(res.body).toMatchObject({ code: 'WRONG_PASSWORD' });
        expectNoSecrets(res.body, 'not-my-password', NEW_PASSWORD);
        expect(setCookies(res)).toEqual([]);
        expect(await storedHash(user.id)).toBe(before);
        await refresh(session).expect(200);
        expect(await audits(AuditAction.PASSWORD_CHANGED, user.id)).toEqual([]);
      });

      it('400 SAME_PASSWORD for an unchanged password', async () => {
        const user = await seedUser(UserRole.CASHIER, branch.id);
        const before = await storedHash(user.id);
        const res = await change(await sessionFor(user), {
          current_password: PASSWORD,
          new_password: PASSWORD,
        }).expect(400);
        expect(res.body).toMatchObject({ code: 'SAME_PASSWORD' });
        expect(await storedHash(user.id)).toBe(before);
      });

      it.each([
        ['a short new password', { ...valid, new_password: 'short7!' }],
        ['a new password over 72 bytes', { ...valid, new_password: TOO_LONG }],
        ['no new password', { current_password: PASSWORD }],
        ['no current password', { new_password: NEW_PASSWORD }],
        ['an empty current password', { ...valid, current_password: '' }],
        ['a confirmation field', { ...valid, confirm_password: NEW_PASSWORD }],
      ])('400 for %s; nothing changed, sessions kept', async (_, body) => {
        const user = await seedUser(UserRole.CASHIER, branch.id);
        const session = await sessionFor(user);
        const before = await storedHash(user.id);

        const res = await change(session, body).expect(400);

        expectNoSecrets(res.body, PASSWORD, NEW_PASSWORD, TOO_LONG);
        expect(await storedHash(user.id)).toBe(before);
        await refresh(session).expect(200);
      });

      it("can't change another user's password: an id in the body is refused, and only the caller's own password ever changes", async () => {
        const caller = await seedUser(UserRole.CASHIER, branch.id);
        const other = await seedUser(UserRole.CASHIER, branch.id);
        const callerSession = await sessionFor(caller);
        const otherBefore = await storedHash(other.id);

        for (const key of ['id', 'user_id', 'userId']) {
          await change(callerSession, { ...valid, [key]: other.id }).expect(
            400,
          );
        }
        await http()
          .put(`/api/v1/auth/me/password?id=${other.id}`)
          .set('Cookie', accessOnly(callerSession))
          .send(valid)
          .expect(204);

        expect(await storedHash(other.id)).toBe(otherBefore);
        expect(
          await bcrypt.compare(NEW_PASSWORD, await storedHash(caller.id)),
        ).toBe(true);
        expect(await audits(AuditAction.PASSWORD_CHANGED, other.id)).toEqual(
          [],
        );
      });
    });
  });

  describe('concurrent changes (real locks)', () => {
    let branch: Branch;

    beforeEach(async () => {
      await truncateAllTables(app);
      branch = await seedBranch();
    });

    it('waits for a concurrent password change, then checks the current password against its new hash', async () => {
      const user = await seedUser(UserRole.CASHIER, branch.id);
      const winnerHash = await bcrypt.hash('changed-elsewhere', 4);

      // Another transaction (as changeOwnPassword does) locks the row and
      // changes the password, but has not committed yet.
      const other = dataSource.createQueryRunner();
      await other.connect();
      await other.startTransaction();
      let outcome: unknown;
      try {
        await other.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [
          user.id,
        ]);
        await other.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [
          user.id,
          winnerHash,
        ]);

        // Meanwhile a change with the old password: it must wait.
        const pending = app
          .get(UsersService)
          .changeOwnPassword(user, {
            current_password: PASSWORD,
            new_password: NEW_PASSWORD,
          })
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
          code: 'WRONG_PASSWORD',
        }) as object,
      });
      expect(await storedHash(user.id)).toBe(winnerHash);
    });

    it('of two changes with the same current password, exactly one wins', async () => {
      const user = await seedUser(UserRole.MANAGER, branch.id);
      const service = app.get(UsersService);

      const outcomes = await Promise.all(
        ['first-new-pass', 'second-new-pass'].map((new_password) =>
          service
            .changeOwnPassword(user, {
              current_password: PASSWORD,
              new_password,
            })
            .then(
              () => new_password,
              (error: unknown) => error,
            ),
        ),
      );

      const winners = outcomes.filter((o) => typeof o === 'string');
      expect(winners).toHaveLength(1);
      expect(outcomes.find((o) => typeof o !== 'string')).toMatchObject({
        response: expect.objectContaining({
          code: 'WRONG_PASSWORD',
        }) as object,
      });
      expect(await bcrypt.compare(winners[0], await storedHash(user.id))).toBe(
        true,
      );
      expect(await audits(AuditAction.PASSWORD_CHANGED, user.id)).toHaveLength(
        1,
      );
    });
  });
});
