import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { DataSource, QueryRunner, Repository } from 'typeorm';
import { createTestApp, truncateAllTables } from './setup';
import { User } from '../src/users/entities/user.entity';
import { UserRole } from '../src/users/enums/user-role.enum';
import { RefreshToken } from '../src/auth/entities/refresh-token.entity';

const refreshPath = '/api/v1/auth/refresh';
const logoutPath = `${refreshPath}/logout`;

const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Refresh-token rotation against real Postgres: what only the database can
 * show. Each race is made deterministic by holding the token's row FOR
 * UPDATE on a separate connection, waiting until the requests under test
 * are queued on that lock (in a known order), then releasing it.
 */
describe('Auth refresh concurrency (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let tokens: Repository<RefreshToken>;

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
    tokens = dataSource.getRepository(RefreshToken);
  });

  beforeEach(async () => {
    await truncateAllTables(app);
    // Keeps each test's handful of requests clear of the global throttler
    // (10 a second from one address).
    await pause(1_100);
  });

  afterAll(async () => {
    await app.close();
  });

  async function seedAdmin(email: string): Promise<User> {
    const repo = dataSource.getRepository(User);
    return repo.save(
      repo.create({
        email,
        password_hash: await bcrypt.hash('testpass123', 4),
        full_name: 'Test Admin',
        role: UserRole.ADMIN,
        is_active: true,
        branch_id: null,
      }),
    );
  }

  /** Log in and return the raw refresh token from the Set-Cookie header. */
  async function login(email: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'testpass123' })
      .expect(200);
    const cookies = response.headers['set-cookie'] as unknown as string[];
    const cookie = cookies.find((c) => c.startsWith('refresh_token='))!;
    return cookie.slice('refresh_token='.length, cookie.indexOf(';'));
  }

  const refresh = (token: string) =>
    request(app.getHttpServer())
      .post(refreshPath)
      .set('Cookie', `refresh_token=${token}`)
      .then((r) => r);
  const logout = (token: string) =>
    request(app.getHttpServer())
      .post(logoutPath)
      .set('Cookie', `refresh_token=${token}`)
      .then((r) => r);

  const sessionsOf = (user: User) =>
    tokens.find({ where: { user_id: user.id }, order: { created_at: 'ASC' } });
  const rowFor = (token: string) =>
    tokens.findOneByOrFail({ token_hash: hash(token) });

  /** Hold the token's row FOR UPDATE on a separate connection. */
  async function holdToken(token: string): Promise<QueryRunner> {
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    await runner.query(
      `SELECT id FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
      [hash(token)],
    );
    return runner;
  }

  async function release(runner: QueryRunner): Promise<void> {
    if (runner.isTransactionActive) await runner.commitTransaction();
    if (!runner.isReleased) await runner.release();
  }

  /** Wait until `n` other sessions are blocked on a lock. */
  async function waitForLockWaiters(n: number): Promise<void> {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const rows: { count: number }[] = await dataSource.query(
        `SELECT count(*)::int AS count
           FROM pg_stat_activity
          WHERE datname = current_database()
            AND wait_event_type = 'Lock'
            AND pid <> pg_backend_pid()`,
      );
      if (rows[0].count >= n) return;
      if (Date.now() > deadline) {
        throw new Error(
          `Timed out waiting for ${n} lock waiter(s); saw ${rows[0].count}`,
        );
      }
      await pause(25);
    }
  }

  it('two refreshes with the same token: exactly one claims it, the other is reuse', async () => {
    const x = await seedAdmin('x@test.com');
    const y = await seedAdmin('y@test.com');
    const token = await login(x.email);
    const yToken = await login(y.email);

    const gate = await holdToken(token);
    let first: Promise<request.Response>;
    let second: Promise<request.Response>;
    try {
      first = refresh(token);
      await waitForLockWaiters(1);
      second = refresh(token);
      await waitForLockWaiters(2);
    } finally {
      await release(gate);
    }
    const [a, b] = await Promise.all([first!, second!]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(401);
    expect((b.body as { message: string }).message).toContain('reuse detected');
    // One replacement minted, not two; strict reuse detection then revoked
    // it with the rest of X's sessions.
    const xSessions = await sessionsOf(x);
    expect(xSessions).toHaveLength(2);
    expect(xSessions.every((s) => s.revoked_at !== null)).toBe(true);
    // Another user's session is untouched.
    expect((await rowFor(yToken)).revoked_at).toBeNull();
  }, 30_000);

  it('logout queued ahead of a refresh: logout wins, nothing is minted', async () => {
    const x = await seedAdmin('x@test.com');
    const token = await login(x.email);
    const otherDevice = await login(x.email);

    const gate = await holdToken(token);
    let out: Promise<request.Response>;
    let refreshed: Promise<request.Response>;
    try {
      out = logout(token);
      await waitForLockWaiters(1);
      refreshed = refresh(token);
      await waitForLockWaiters(2);
    } finally {
      await release(gate);
    }
    const [o, r] = await Promise.all([out!, refreshed!]);

    expect(o.status).toBe(200);
    expect(r.status).toBe(401);
    // A refresh with a logged-out token is replay under the strict policy.
    expect((r.body as { message: string }).message).toContain('reuse detected');
    expect(r.headers['set-cookie']).toBeUndefined();
    const xSessions = await sessionsOf(x);
    expect(xSessions).toHaveLength(2); // the two logins; no replacement
    expect(xSessions.every((s) => s.revoked_at !== null)).toBe(true);
    expect((await rowFor(otherDevice)).revoked_at).not.toBeNull();
  }, 30_000);

  it('refresh queued ahead of a logout with the same token: one winner; the replacement outlives the stale logout', async () => {
    const x = await seedAdmin('x@test.com');
    const token = await login(x.email);

    const gate = await holdToken(token);
    let refreshed: Promise<request.Response>;
    let out: Promise<request.Response>;
    try {
      refreshed = refresh(token);
      await waitForLockWaiters(1);
      out = logout(token);
      await waitForLockWaiters(2);
    } finally {
      await release(gate);
    }
    const [r, o] = await Promise.all([refreshed!, out!]);

    expect(r.status).toBe(200);
    expect(o.status).toBe(200);
    // The old token was revoked once, by the refresh; the logout's
    // conditional update found nothing left to revoke.
    const xSessions = await sessionsOf(x);
    expect(xSessions).toHaveLength(2);
    expect(xSessions[0].revoked_at).not.toBeNull();
    // Known limit without a token-chain column: a logout carrying the
    // already-rotated token can't reach its replacement. The browser's
    // auth lock makes logout send the newest token instead.
    expect(xSessions[1].revoked_at).toBeNull();
  }, 30_000);

  it('a replayed rotated token revokes every session of that user only', async () => {
    const x = await seedAdmin('x@test.com');
    const y = await seedAdmin('y@test.com');
    const token = await login(x.email);
    const otherDevice = await login(x.email);
    const yToken = await login(y.email);

    const rotated = await refresh(token);
    expect(rotated.status).toBe(200);
    const replay = await refresh(token);

    expect(replay.status).toBe(401);
    expect((replay.body as { message: string }).message).toContain(
      'reuse detected',
    );
    const xSessions = await sessionsOf(x);
    expect(xSessions).toHaveLength(3); // two logins + one replacement
    expect(xSessions.every((s) => s.revoked_at !== null)).toBe(true);
    expect((await rowFor(otherDevice)).revoked_at).not.toBeNull();
    expect((await rowFor(yToken)).revoked_at).toBeNull();
  }, 30_000);

  it('a failure storing the replacement rolls the claim back; the token still works', async () => {
    const x = await seedAdmin('x@test.com');
    const token = await login(x.email);

    // Fail the replacement's INSERT inside the real transaction: it's the
    // only repository save a refresh makes.
    const save = jest
      .spyOn(Repository.prototype, 'save')
      .mockRejectedValueOnce(new Error('Simulated insert failure'));
    let failed: request.Response;
    try {
      failed = await refresh(token);
    } finally {
      save.mockRestore();
    }

    expect(failed.status).toBe(500);
    expect(failed.headers['set-cookie']).toBeUndefined();
    const row = await rowFor(token);
    expect(row.revoked_at).toBeNull();
    expect(await sessionsOf(x)).toHaveLength(1);

    // No false reuse alarm on the retry.
    const retried = await refresh(token);
    expect(retried.status).toBe(200);
    const xSessions = await sessionsOf(x);
    expect(xSessions).toHaveLength(2);
    expect(xSessions[1].revoked_at).toBeNull();
  }, 30_000);

  it('an expired token is refused without a reuse alarm, by the database clock', async () => {
    const x = await seedAdmin('x@test.com');
    const token = await login(x.email);
    const otherDevice = await login(x.email);
    await dataSource.query(
      `UPDATE refresh_tokens SET expires_at = now() - interval '1 second'
        WHERE token_hash = $1`,
      [hash(token)],
    );

    const response = await refresh(token);

    expect(response.status).toBe(401);
    expect((response.body as { message: string }).message).toBe(
      'Refresh token expired',
    );
    expect((await rowFor(token)).revoked_at).toBeNull();
    expect((await rowFor(otherDevice)).revoked_at).toBeNull();
  }, 30_000);
});
