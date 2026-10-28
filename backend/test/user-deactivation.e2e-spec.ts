import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { createTestApp, truncateAllTables } from './setup';
import { User } from '../src/users/entities/user.entity';
import { UserRole } from '../src/users/enums/user-role.enum';
import { UsersService } from '../src/users/users.service';
import { RefreshToken } from '../src/auth/entities/refresh-token.entity';

const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PASSWORD = 'testpass123';
const EARLIER = new Date('2026-01-01T00:00:00.000Z');

/**
 * UsersService.deactivate / softDelete revoke the user's refresh tokens in
 * the same transaction (no route calls them yet, so the service is called
 * directly), against real Postgres.
 */
describe('User deactivation revokes refresh tokens (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let tokens: Repository<RefreshToken>;
  let users: UsersService;

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
    tokens = dataSource.getRepository(RefreshToken);
    users = app.get(UsersService);
  });

  beforeEach(async () => {
    await truncateAllTables(app);
    // Keeps each test's logins clear of the global throttler (10 a second).
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
        password_hash: await bcrypt.hash(PASSWORD, 4),
        full_name: 'Test Admin',
        role: UserRole.ADMIN,
        is_active: true,
        branch_id: null,
      }),
    );
  }

  const login = (email: string) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD });

  /** Log in and return the raw refresh token from Set-Cookie. */
  async function session(email: string): Promise<string> {
    const response = await login(email).expect(200);
    const cookies = response.headers['set-cookie'] as unknown as string[];
    const cookie = cookies.find((c) => c.startsWith('refresh_token='))!;
    return cookie.slice('refresh_token='.length, cookie.indexOf(';'));
  }

  const refresh = (token: string) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refresh_token=${token}`);

  /** A token row already revoked at EARLIER, to check it isn't touched. */
  async function seedRevokedToken(user: User): Promise<RefreshToken> {
    return tokens.save(
      tokens.create({
        user_id: user.id,
        token_hash: hash(randomUUID()),
        expires_at: new Date(Date.now() + 86_400_000),
        revoked_at: EARLIER,
        ip_address: null,
        user_agent: null,
      }),
    );
  }

  const rowFor = (token: string) =>
    tokens.findOneByOrFail({ token_hash: hash(token) });
  const userRow = (id: string) =>
    dataSource
      .getRepository(User)
      .findOneOrFail({ where: { id }, withDeleted: true });

  interface Fixture {
    x: User;
    xSessions: string[];
    xRevoked: RefreshToken;
    yToken: string;
  }

  async function fixture(): Promise<Fixture> {
    const x = await seedAdmin('x@test.com');
    const y = await seedAdmin('y@test.com');
    const xSessions = [await session(x.email), await session(x.email)];
    const xRevoked = await seedRevokedToken(x);
    const yToken = await session(y.email);
    return { x, xSessions, xRevoked, yToken };
  }

  /** X's active sessions are revoked, the old revocation and Y are untouched. */
  async function expectRevoked(f: Fixture): Promise<void> {
    for (const token of f.xSessions) {
      expect((await rowFor(token)).revoked_at).toBeInstanceOf(Date);
    }
    const old = await tokens.findOneByOrFail({ id: f.xRevoked.id });
    expect(old.revoked_at?.toISOString()).toBe(EARLIER.toISOString());
    expect((await rowFor(f.yToken)).revoked_at).toBeNull();
  }

  /** Fail the token revocation inside the real transaction only. */
  function failTokenRevocation(): jest.SpyInstance {
    const realUpdate = Reflect.get(EntityManager.prototype, 'update') as (
      this: EntityManager,
      ...args: Parameters<EntityManager['update']>
    ) => ReturnType<EntityManager['update']>;
    return jest
      .spyOn(EntityManager.prototype, 'update')
      .mockImplementation(function (
        this: EntityManager,
        ...args: Parameters<EntityManager['update']>
      ) {
        if (args[0] === RefreshToken) {
          return Promise.reject(new Error('Simulated revocation failure'));
        }
        return realUpdate.apply(this, args);
      });
  }

  describe('deactivate', () => {
    it('revokes every active session, keeps an earlier revocation, and leaves other users alone', async () => {
      const f = await fixture();

      await users.deactivate(f.x.id);

      expect((await userRow(f.x.id)).is_active).toBe(false);
      await expectRevoked(f);
    });

    it('refuses refresh with an old session and a new login afterwards', async () => {
      const f = await fixture();
      await users.deactivate(f.x.id);

      await refresh(f.xSessions[0]).expect(401);
      await login(f.x.email).expect(401);
      // The other user still refreshes.
      await refresh(f.yToken).expect(200);
    });

    it('can be repeated: no error, and revocation times stay as first set', async () => {
      const f = await fixture();
      await users.deactivate(f.x.id);
      const first = (await rowFor(f.xSessions[0])).revoked_at?.toISOString();

      await expect(users.deactivate(f.x.id)).resolves.toBeUndefined();

      expect((await rowFor(f.xSessions[0])).revoked_at?.toISOString()).toBe(
        first,
      );
      await expectRevoked(f);
    });

    it('rolls the deactivation back when revoking the tokens fails', async () => {
      const f = await fixture();
      const spy = failTokenRevocation();
      try {
        await expect(users.deactivate(f.x.id)).rejects.toThrow(
          'Simulated revocation failure',
        );
      } finally {
        spy.mockRestore();
      }

      const x = await userRow(f.x.id);
      expect(x.is_active).toBe(true);
      for (const token of f.xSessions) {
        expect((await rowFor(token)).revoked_at).toBeNull();
      }
      await refresh(f.xSessions[0]).expect(200);
    });
  });

  describe('softDelete', () => {
    it('revokes every active session, keeps an earlier revocation, and leaves other users alone', async () => {
      const f = await fixture();

      await users.softDelete(f.x.id);

      expect((await userRow(f.x.id)).deleted_at).toBeInstanceOf(Date);
      await expectRevoked(f);
      await refresh(f.xSessions[1]).expect(401);
    });

    it('rolls the soft delete back when revoking the tokens fails', async () => {
      const f = await fixture();
      const spy = failTokenRevocation();
      try {
        await expect(users.softDelete(f.x.id)).rejects.toThrow(
          'Simulated revocation failure',
        );
      } finally {
        spy.mockRestore();
      }

      expect((await userRow(f.x.id)).deleted_at).toBeNull();
      for (const token of f.xSessions) {
        expect((await rowFor(token)).revoked_at).toBeNull();
      }
    });

    it('can be repeated: no error, and revocation times stay as first set', async () => {
      // TypeORM's softDelete doesn't skip an already deleted row, so the
      // repeat succeeds (and, as before this change, resets deleted_at).
      const f = await fixture();
      await users.softDelete(f.x.id);
      const first = (await rowFor(f.xSessions[0])).revoked_at?.toISOString();

      await expect(users.softDelete(f.x.id)).resolves.toBeUndefined();

      expect((await rowFor(f.xSessions[0])).revoked_at?.toISOString()).toBe(
        first,
      );
      await expectRevoked(f);
    });
  });
});
