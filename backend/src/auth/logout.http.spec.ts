import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import cookieParser from 'cookie-parser';
import { Cookie, CookieAccessInfo, CookieJar } from 'cookiejar';
import { createHash } from 'crypto';
import type { Server } from 'http';
import request from 'supertest';
import { IsNull } from 'typeorm';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { TypedConfigService } from '../config/typed-config.service';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/enums/user-role.enum';

const host = 'api.socio.test';
const refreshPath = '/api/v1/auth/refresh';
const logoutPath = `${refreshPath}/logout`;
const legacyLogoutPath = '/api/v1/auth/logout';
const refreshSecret = 'test-only-refresh-secret';
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
type Session = Pick<
  RefreshToken,
  'user_id' | 'token_hash' | 'expires_at' | 'revoked_at'
>;

/** Real controller, auth service, JWTs and cookie routing; persistence stays in memory. */
describe('Logout HTTP (no database)', () => {
  let app: INestApplication<Server>;
  let jwt: JwtService;
  let secureCookies = false;
  const sessions = new Map<string, Session>();
  const user = {
    id: 'user-1',
    email: 'staff@example.test',
    full_name: 'Staff',
    role: UserRole.CASHIER,
    branch_id: 'branch-1',
    branch: null,
    is_active: true,
    approval_pin_set_at: null,
    password_hash: '',
  };
  const repository = {
    create: jest.fn((input: Omit<Session, 'revoked_at'>) => ({
      ...input,
      revoked_at: null,
    })),
    save: jest.fn((session: Session) => {
      sessions.set(session.token_hash, { ...session });
      return Promise.resolve(session);
    }),
    findOne: jest.fn(({ where }: { where: { token_hash: string } }) => {
      const session = sessions.get(where.token_hash);
      return Promise.resolve(session ? { ...session } : null);
    }),
    update: jest.fn(
      (
        criteria: {
          token_hash?: string;
          user_id?: string;
          revoked_at: unknown;
        },
        values: { revoked_at: Date },
      ) => {
        expect(criteria.revoked_at).toEqual(IsNull());
        let affected = 0;
        for (const session of sessions.values()) {
          if (session.revoked_at !== null) continue;
          if (criteria.token_hash && criteria.token_hash !== session.token_hash)
            continue;
          if (criteria.user_id && criteria.user_id !== session.user_id)
            continue;
          session.revoked_at = values.revoked_at;
          affected++;
        }
        return Promise.resolve({ affected });
      },
    ),
  };
  // refresh()'s conditional claim, applied to the in-memory sessions.
  const claimBuilder = () => {
    let tokenHash = '';
    const builder = {
      update: () => builder,
      set: () => builder,
      andWhere: () => builder,
      returning: () => builder,
      where: (_: string, params: { tokenHash: string }) => {
        tokenHash = params.tokenHash;
        return builder;
      },
      execute: () => {
        const session = sessions.get(tokenHash);
        if (
          !session ||
          session.revoked_at !== null ||
          session.expires_at <= new Date()
        )
          return Promise.resolve({ raw: [] });
        session.revoked_at = new Date();
        return Promise.resolve({ raw: [{ user_id: session.user_id }] });
      },
    };
    return builder;
  };
  const manager = {
    createQueryBuilder: claimBuilder,
    findOne: (_: unknown, options: { where: { token_hash: string } }) =>
      repository.findOne(options),
    getRepository: () => repository,
  };
  // Transactions run one at a time, standing in for the row lock the real
  // claim waits on; a throw puts the sessions back as they were.
  let transactions = Promise.resolve();
  const dataSource = {
    transaction: jest.fn(
      <T>(work: (m: typeof manager) => Promise<T>): Promise<T> => {
        const run = transactions.then(async () => {
          const before = [...sessions].map(
            ([key, session]) => [key, { ...session }] as const,
          );
          try {
            return await work(manager);
          } catch (error) {
            sessions.clear();
            before.forEach(([key, session]) => sessions.set(key, session));
            throw error;
          }
        });
        transactions = run.then(
          () => undefined,
          () => undefined,
        );
        return run;
      },
    ),
  };

  beforeAll(async () => {
    user.password_hash = await bcrypt.hash('test-password', 4);
    const values: Record<string, string> = {
      JWT_ACCESS_SECRET: 'test-only-access-secret',
      JWT_REFRESH_SECRET: refreshSecret,
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
      COOKIE_DOMAIN: host,
    };
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        JwtService,
        { provide: getRepositoryToken(RefreshToken), useValue: repository },
        { provide: getDataSourceToken(), useValue: dataSource },
        {
          provide: UsersService,
          useValue: {
            findByEmail: jest.fn().mockResolvedValue(user),
            findById: jest.fn().mockResolvedValue(user),
            findByIdForAuth: jest.fn().mockResolvedValue(user),
          },
        },
        {
          provide: TypedConfigService,
          useValue: {
            get: (key: string) =>
              key === 'COOKIE_SECURE' ? secureCookies : values[key],
          },
        },
      ],
    }).compile();
    jwt = module.get(JwtService);
    app = module.createNestApplication();
    app.useLogger(false);
    app.use(cookieParser());
    app.useGlobalGuards(new JwtAuthGuard(new Reflector()));
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    sessions.clear();
    secureCookies = false;
    jest.clearAllMocks();
  });

  const cookiesFor = (jar: CookieJar, path: string, secure = secureCookies) =>
    jar.getCookies(new CookieAccessInfo(host, path, secure)).toValueString();
  const receive = (jar: CookieJar, response: request.Response) => {
    jar.setCookies(response.headers['set-cookie'] ?? [], host);
  };
  const post = (path: string, jar: CookieJar) =>
    request(app.getHttpServer())
      .post(path)
      .set('Cookie', cookiesFor(jar, path));
  const login = async () => {
    const jar = new CookieJar();
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'test-password' })
      .expect(200);
    receive(jar, response);
    const token = jar.getCookie(
      'refresh_token',
      new CookieAccessInfo(host, refreshPath, secureCookies),
    )!.value;
    return { jar, token, response };
  };
  const seedToken = (
    token: string,
    expiresAt = new Date(Date.now() + 60_000),
  ) => {
    sessions.set(hash(token), {
      user_id: user.id,
      token_hash: hash(token),
      expires_at: expiresAt,
      revoked_at: null,
    });
  };

  it('sends the narrow refresh cookie to browser logout and revokes only its session', async () => {
    const { jar, token } = await login();
    const other = await login();
    expect(cookiesFor(jar, legacyLogoutPath)).not.toContain('refresh_token=');
    expect(cookiesFor(jar, logoutPath)).toContain(`refresh_token=${token}`);

    const response = await post(logoutPath, jar).expect(200);
    expect(response.body).toEqual({ success: true });
    expect(sessions.get(hash(token))!.revoked_at).toBeInstanceOf(Date);
    expect(sessions.get(hash(other.token))!.revoked_at).toBeNull();
    expect(repository.update).toHaveBeenCalledWith(
      { token_hash: hash(token), revoked_at: IsNull() },
      { revoked_at: expect.any(Date) as Date },
    );
    receive(jar, response);
    expect(cookiesFor(jar, refreshPath)).toBe('');
    // No replay of the logged-out token here: that invokes the existing
    // global reuse-detection policy, not the ordinary logout behavior.
    await post(refreshPath, other.jar).expect(200);
  });

  it('accepts a pre-change narrow-path cookie without another login', async () => {
    const token = await jwt.signAsync(
      { sub: user.id },
      { secret: refreshSecret, expiresIn: '7d' },
    );
    seedToken(token);
    const jar = new CookieJar();
    jar.setCookie(
      `refresh_token=${token}; Domain=${host}; Path=${refreshPath}; HttpOnly; SameSite=Strict`,
      host,
    );
    await post(logoutPath, jar).expect(200);
    expect(sessions.get(hash(token))!.revoked_at).toBeInstanceOf(Date);
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'clears cookies at their original paths and attributes (Secure=%s)',
    async (secure) => {
      secureCookies = secure;
      const { jar, response: issued } = await login();
      const cleared = await post(logoutPath, jar).expect(200);
      const originals = (
        issued.headers['set-cookie'] as unknown as string[]
      ).map((value) => new Cookie(value));
      // The issued cookies carry the configured Secure flag themselves, so
      // the comparison below can't pass with both sides wrong.
      expect(originals).toHaveLength(2);
      for (const original of originals) expect(original.secure).toBe(secure);
      const removals = cleared.headers['set-cookie'] as unknown as string[];
      expect(removals).toHaveLength(2);
      for (const header of removals) {
        const cookie = new Cookie(header);
        const original = originals.find(
          (candidate) => candidate.name === cookie.name,
        )!;
        expect(cookie.value).toBe('');
        expect(cookie.path).toBe(
          cookie.name === 'access_token' ? '/' : refreshPath,
        );
        expect(cookie.domain).toBe(original.domain);
        expect(cookie.path).toBe(original.path);
        expect(cookie.secure).toBe(original.secure);
        expect(cookie.noscript).toBe(true);
        expect(cookie.expiration_date).toBeLessThan(Date.now());
        expect(header).toMatch(/SameSite=Strict/i);
      }
      receive(jar, cleared);
      expect(cookiesFor(jar, refreshPath)).toBe('');
    },
  );

  it.each([false, true])(
    'issues login and refresh cookies with the configured security options (Secure=%s)',
    async (secure) => {
      secureCookies = secure;
      const { jar, response: issued } = await login();
      const refreshed = await post(refreshPath, jar).expect(200);
      for (const response of [issued, refreshed]) {
        const headers = response.headers['set-cookie'] as unknown as string[];
        expect(headers).toHaveLength(2);
        for (const header of headers) {
          const cookie = new Cookie(header);
          expect(cookie.value).not.toBe('');
          expect(cookie.secure).toBe(secure);
          expect(cookie.noscript).toBe(true);
          expect(cookie.domain).toBe(host);
          expect(cookie.path).toBe(
            cookie.name === 'access_token' ? '/' : refreshPath,
          );
          expect(header).toMatch(/SameSite=Strict/i);
        }
      }
    },
  );

  it('rejects replay after logout, preserving existing global reuse detection', async () => {
    const { jar } = await login();
    const other = await login();
    await post(logoutPath, jar).expect(200);
    // Intentionally keep the old cookie to simulate explicit token replay.
    const response = await post(refreshPath, jar).expect(401);
    expect((response.body as { message: string }).message).toContain(
      'reuse detected',
    );
    expect(sessions.get(hash(other.token))!.revoked_at).toBeInstanceOf(Date);
  });

  it('rotates a valid refresh token and rejects the old token as before', async () => {
    const { jar, token } = await login();
    const response = await post(refreshPath, jar).expect(200);
    expect(sessions.get(hash(token))!.revoked_at).toBeInstanceOf(Date);
    receive(jar, response);
    const replacement = jar.getCookie(
      'refresh_token',
      new CookieAccessInfo(host, refreshPath),
    )!.value;
    expect(replacement).not.toBe(token);
    expect(sessions.get(hash(replacement))!.revoked_at).toBeNull();
    await request(app.getHttpServer())
      .post(refreshPath)
      .set('Cookie', `refresh_token=${token}`)
      .expect(401);
    expect(sessions.get(hash(replacement))!.revoked_at).toBeInstanceOf(Date);
  });

  it('allows repeated logout with a stale cookie or no cookies without minting sessions', async () => {
    const { jar, token } = await login();
    jest.clearAllMocks();
    const first = await post(logoutPath, jar).expect(200);
    const revokedAt = sessions.get(hash(token))!.revoked_at;
    await post(logoutPath, jar).expect(200);
    expect(sessions.get(hash(token))!.revoked_at).toBe(revokedAt);
    receive(jar, first);
    await post(logoutPath, jar).expect(200);
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
    expect(sessions.size).toBe(1);
  });

  it.each(['missing', 'malformed', 'unknown', 'expired'])(
    'safely handles a %s refresh token, even with an invalid access cookie',
    async (kind) => {
      const jar = new CookieJar();
      jar.setCookie(
        `access_token=expired-or-invalid; Domain=${host}; Path=/; HttpOnly`,
        host,
      );
      let token: string | undefined;
      if (kind === 'malformed') token = 'not-a-jwt';
      if (kind === 'unknown')
        token = await jwt.signAsync(
          { sub: user.id },
          { secret: refreshSecret, expiresIn: '7d' },
        );
      if (kind === 'expired') {
        token = await jwt.signAsync(
          { sub: user.id },
          { secret: refreshSecret, expiresIn: -60 },
        );
        seedToken(token, new Date(Date.now() - 60_000));
      }
      if (token)
        jar.setCookie(
          `refresh_token=${token}; Domain=${host}; Path=${refreshPath}; HttpOnly`,
          host,
        );
      const response = await post(logoutPath, jar).expect(200);
      receive(jar, response);
      expect(cookiesFor(jar, refreshPath)).toBe('');
      if (kind === 'expired')
        expect(sessions.get(hash(token!))!.revoked_at).toBeInstanceOf(Date);
      else expect(sessions.size).toBe(0);
      expect(repository.create).not.toHaveBeenCalled();
      expect(repository.save).not.toHaveBeenCalled();
    },
  );

  it('keeps the legacy endpoint public and functional for an explicitly supplied token', async () => {
    const { token } = await login();
    await request(app.getHttpServer())
      .post(legacyLogoutPath)
      .set('Cookie', `refresh_token=${token}`)
      .expect(200);
    expect(sessions.get(hash(token))!.revoked_at).toBeInstanceOf(Date);
    await request(app.getHttpServer()).post(legacyLogoutPath).expect(200);
  });

  it('documents the legacy alias limitation with a path-aware browser jar', async () => {
    const { jar, token } = await login();
    const response = await post(legacyLogoutPath, jar).expect(200);
    expect(repository.update).not.toHaveBeenCalled();
    expect(sessions.get(hash(token))!.revoked_at).toBeNull();
    receive(jar, response);
    expect(cookiesFor(jar, refreshPath)).toBe('');
  });

  it('lets one of two refreshes with the same cookie rotate; the other is reuse', async () => {
    const { jar, token } = await login();
    const other = await login();
    const [a, b] = await Promise.all([
      post(refreshPath, jar),
      post(refreshPath, jar),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 401]);
    const loser = a.status === 401 ? a : b;
    expect((loser.body as { message: string }).message).toContain(
      'reuse detected',
    );
    // One replacement minted, and strict reuse detection revoked it along
    // with every other session of the user.
    expect(sessions.size).toBe(3);
    expect(sessions.get(hash(token))!.revoked_at).toBeInstanceOf(Date);
    expect(sessions.get(hash(other.token))!.revoked_at).toBeInstanceOf(Date);
    expect([...sessions.values()].every((s) => s.revoked_at !== null)).toBe(
      true,
    );
  });

  it('rolls the claim back when the replacement cannot be stored', async () => {
    const { jar, token } = await login();
    repository.save.mockRejectedValueOnce(new Error('Persistence unavailable'));
    const failed = await post(refreshPath, jar).expect(500);
    expect(failed.headers['set-cookie']).toBeUndefined();
    expect(sessions.get(hash(token))!.revoked_at).toBeNull();
    expect(sessions.size).toBe(1);
    // The same cookie still works: no false reuse alarm on retry.
    await post(refreshPath, jar).expect(200);
    expect(sessions.size).toBe(2);
  });

  it('keeps an inactive user’s token revoked after refusing the refresh', async () => {
    const { jar, token } = await login();
    user.is_active = false;
    try {
      const response = await post(refreshPath, jar).expect(401);
      expect((response.body as { message: string }).message).toBe(
        'User no longer active',
      );
    } finally {
      user.is_active = true;
    }
    expect(sessions.get(hash(token))!.revoked_at).toBeInstanceOf(Date);
    expect(sessions.size).toBe(1);
  });

  it('awaits successful revocation before sending cookie-clearing headers', async () => {
    const { jar } = await login();
    repository.update.mockRejectedValueOnce(
      new Error('Persistence unavailable'),
    );
    const response = await post(logoutPath, jar).expect(500);
    expect(response.headers['set-cookie']).toBeUndefined();
  });
});
