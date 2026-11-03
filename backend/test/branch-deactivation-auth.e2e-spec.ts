import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { createTestApp, truncateAllTables } from './setup';
import { AuthService } from '../src/auth/auth.service';
import { User } from '../src/users/entities/user.entity';
import { UserRole } from '../src/users/enums/user-role.enum';
import { Branch } from '../src/branches/entities/branch.entity';

type Response = request.Response;

/**
 * Staff of a deactivated branch (Phase 2 P2-5), through the real
 * endpoints: once an admin deactivates their branch, its managers and
 * cashiers can't log in (the generic 401), their existing access tokens
 * stop working on every route, and their refresh tokens can't mint new
 * ones. Admins and the other branch's staff are unaffected. When the
 * branch is reactivated, a still-valid access token and an unconsumed
 * refresh token work again; a refresh token consumed while the branch was
 * inactive does not, so that user logs in again.
 *
 * One app, seeded once; the `it` blocks run in order and share state (the
 * story is deactivate, then reactivate). Sessions come from
 * AuthService.login; only the login checks use HTTP logins (4).
 */
describe('Deactivated-branch staff (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const PASSWORD = 'testpass123';

  let branchA: Branch;
  let branchB: Branch;
  let admin: User;
  let managerA: User;
  let cashierA: User;
  let cashierB: User;

  interface Session {
    access: string;
    refresh: string;
  }
  let adminSession: Session;
  let managerASession: Session;
  let cashierASession: Session;
  let cashierBSession: Session;

  // ---- Requests ----

  /** The API allows 10 requests a second per route (config/throttle.ts). */
  const REQUEST_GAP_MS = 120;

  const send = async (test: request.Test): Promise<Response> => {
    await new Promise((r) => setTimeout(r, REQUEST_GAP_MS));
    return new Promise((resolve, reject) => {
      void test.end((err: unknown, res?: Response) => {
        if (res) resolve(res);
        else reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  };

  const withAccess = (session: Session) => [`access_token=${session.access}`];

  const getAs = (path: string, session: Session) =>
    send(
      request(app.getHttpServer())
        .get(`/api/v1${path}`)
        .set('Cookie', withAccess(session)),
    );

  const refreshWith = (refreshToken: string) =>
    send(
      request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', [`refresh_token=${refreshToken}`]),
    );

  /** The cookie value a response set, e.g. the rotated refresh token. */
  const cookieFrom = (res: Response, name: string): string => {
    const cookies = res.headers['set-cookie'] as unknown as string[];
    const cookie = cookies.find((c) => c.startsWith(`${name}=`));
    if (!cookie) throw new Error(`no ${name} cookie set`);
    return cookie.split(';')[0].slice(name.length + 1);
  };

  const httpLogin = (email: string) =>
    send(
      request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD }),
    );

  const branchAction = (path: string, method: 'delete' | 'post') =>
    send(
      request(app.getHttpServer())
        [method](`/api/v1${path}`)
        .set('Cookie', withAccess(adminSession)),
    );

  function expectStatus(res: Response, status: number) {
    if (res.status !== status) {
      throw new Error(
        `Expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`,
      );
    }
  }

  // ---- Seeding ----

  async function seedUser(
    email: string,
    role: UserRole,
    branch: Branch | null,
  ): Promise<User> {
    const users = dataSource.getRepository(User);
    const saved = await users.save(
      users.create({
        email,
        password_hash: await bcrypt.hash(PASSWORD, 4),
        full_name: email.split('@')[0],
        role,
        is_active: true,
        branch_id: branch?.id ?? null,
      }),
    );
    return users.findOneByOrFail({ id: saved.id });
  }

  async function sessionFor(user: User): Promise<Session> {
    const tokens = await app.get(AuthService).login(user, null, null);
    return { access: tokens.access_token, refresh: tokens.refresh_token };
  }

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
    await truncateAllTables(app);

    const branches = dataSource.getRepository(Branch);
    branchA = await branches.save({
      name: 'Branch A',
      is_active: true,
    } as Branch);
    branchB = await branches.save({
      name: 'Branch B',
      is_active: true,
    } as Branch);
    admin = await seedUser('admin@deactivate.test', UserRole.ADMIN, null);
    managerA = await seedUser(
      'manager.a@deactivate.test',
      UserRole.MANAGER,
      branchA,
    );
    cashierA = await seedUser(
      'cashier.a@deactivate.test',
      UserRole.CASHIER,
      branchA,
    );
    cashierB = await seedUser(
      'cashier.b@deactivate.test',
      UserRole.CASHIER,
      branchB,
    );
    adminSession = await sessionFor(admin);
    managerASession = await sessionFor(managerA);
    cashierASession = await sessionFor(cashierA);
    cashierBSession = await sessionFor(cashierB);
  });

  afterAll(async () => {
    await app.close();
  });

  // ---- While branch A is active ----

  it('staff of an active branch and the admin use their sessions', async () => {
    for (const [session, user] of [
      [managerASession, managerA],
      [cashierASession, cashierA],
      [adminSession, admin],
    ] as const) {
      const res = await getAs('/auth/me', session);
      expectStatus(res, 200);
      expect(res.body).toMatchObject({ user: { id: user.id } });
    }
  });

  // ---- Branch A deactivated ----

  it('the admin deactivates branch A', async () => {
    const res = await branchAction(`/branches/${branchA.id}`, 'delete');

    expectStatus(res, 200);
    expect(res.body).toMatchObject({ id: branchA.id, is_active: false });
  });

  it('branch A staff’s existing access tokens get 401, on /auth/me and on business routes', async () => {
    for (const session of [managerASession, cashierASession]) {
      expectStatus(await getAs('/auth/me', session), 401);
      expectStatus(await getAs('/sales', session), 401);
    }
  });

  it('a branch A cashier’s refresh gets 401 and mints nothing; presenting it again is a reuse, still 401', async () => {
    const res = await refreshWith(cashierASession.refresh);

    expectStatus(res, 401);
    const setCookies =
      (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
    expect(
      setCookies.filter(
        (c) => c.startsWith('access_token=') || c.startsWith('refresh_token='),
      ),
    ).toEqual([]);

    const again = await refreshWith(cashierASession.refresh);
    expectStatus(again, 401);
    expect(JSON.stringify(again.body)).toContain('reuse');
  });

  it('branch A staff logging in get the generic 401', async () => {
    for (const user of [managerA, cashierA]) {
      const res = await httpLogin(user.email);
      expectStatus(res, 401);
      expect(res.body).toMatchObject({
        message: 'Invalid email or password',
      });
    }
  });

  it('the admin is unaffected: requests, refresh and login still work', async () => {
    expectStatus(await getAs('/auth/me', adminSession), 200);

    const refreshed = await refreshWith(adminSession.refresh);
    expectStatus(refreshed, 200);
    adminSession = {
      access: cookieFrom(refreshed, 'access_token'),
      refresh: cookieFrom(refreshed, 'refresh_token'),
    };
    expectStatus(await getAs('/auth/me', adminSession), 200);

    expectStatus(await httpLogin(admin.email), 200);
  });

  it('branch B’s staff are unaffected', async () => {
    expectStatus(await getAs('/auth/me', cashierBSession), 200);
    expectStatus(await getAs('/sales', cashierBSession), 200);

    const refreshed = await refreshWith(cashierBSession.refresh);
    expectStatus(refreshed, 200);
  });

  // ---- Branch A reactivated ----

  it('the admin reactivates branch A', async () => {
    const res = await branchAction(
      `/branches/${branchA.id}/reactivate`,
      'post',
    );

    expectStatus(res, 200);
    expect(res.body).toMatchObject({ id: branchA.id, is_active: true });
  });

  it('a branch A manager’s still-valid access token and unconsumed refresh token work again', async () => {
    const me = await getAs('/auth/me', managerASession);
    expectStatus(me, 200);
    expect(me.body).toMatchObject({ user: { id: managerA.id } });

    const refreshed = await refreshWith(managerASession.refresh);
    expectStatus(refreshed, 200);
    const rotated = {
      access: cookieFrom(refreshed, 'access_token'),
      refresh: cookieFrom(refreshed, 'refresh_token'),
    };
    expectStatus(await getAs('/auth/me', rotated), 200);
  });

  it('the branch A cashier’s refresh token consumed while inactive stays dead; they log in again', async () => {
    expectStatus(await refreshWith(cashierASession.refresh), 401);

    const login = await httpLogin(cashierA.email);
    expectStatus(login, 200);
    expect(login.body).toMatchObject({
      user: { id: cashierA.id, branch_id: branchA.id },
    });
  });
});
