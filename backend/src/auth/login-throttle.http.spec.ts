import {
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  ThrottlerGuard,
  ThrottlerModule,
  throttlerMessage,
} from '@nestjs/throttler';
import type { Server } from 'http';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TypedConfigService } from '../config/typed-config.service';
import {
  buildThrottlerOptions,
  LOGIN_THROTTLE_MESSAGE,
} from '../config/throttle';
import { applyTrustProxy } from '../config/trust-proxy';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/enums/user-role.enum';

const LIMIT = 3;

/**
 * The login throttler over HTTP: the real controller, ValidationPipe,
 * ThrottlerGuard and throttler options (with a low limit), and mocked
 * services. One trusted proxy hop lets each request pick its client IP
 * with X-Forwarded-For. A fresh app per test starts with fresh counts, so
 * nothing waits for a window to expire.
 */
describe('Login throttle (HTTP, no database)', () => {
  let app: INestApplication<Server>;
  const user = {
    id: 'user-1',
    email: 'staff@example.test',
    full_name: 'Staff',
    role: UserRole.CASHIER,
    branch_id: 'branch-1',
    branch: null,
    approval_pin_set_at: null,
    is_active: true,
  };
  const authService = {
    validateUser: jest.fn((_email: string, password: string) =>
      Promise.resolve(password === 'right-password' ? user : null),
    ),
    login: jest.fn(() =>
      Promise.resolve({ access_token: 'access', refresh_token: 'refresh' }),
    ),
    refresh: jest.fn(() =>
      Promise.reject(new UnauthorizedException('Invalid refresh token')),
    ),
    logout: jest.fn(() => Promise.resolve()),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot(
          buildThrottlerOptions({ limit: LIMIT, ttlSeconds: 60 }),
        ),
      ],
      controllers: [AuthController],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: AuthService, useValue: authService },
        {
          provide: UsersService,
          useValue: { findById: jest.fn().mockResolvedValue(user) },
        },
        {
          provide: TypedConfigService,
          useValue: {
            get: (key: string) =>
              key === 'COOKIE_SECURE' ? false : 'localhost',
          },
        },
      ],
    }).compile();
    const nest = module.createNestApplication<NestExpressApplication>();
    applyTrustProxy(nest, 1);
    nest.useLogger(false);
    nest.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    nest.setGlobalPrefix('api/v1');
    await nest.init();
    app = nest;
  });

  afterEach(async () => {
    await app?.close();
  });

  const from = (ip: string) => ({
    login: (body: object) =>
      request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', ip)
        .send(body),
    post: (path: string) =>
      request(app.getHttpServer())
        .post(`/api/v1/auth/${path}`)
        .set('X-Forwarded-For', ip),
  });
  const right = { email: user.email, password: 'right-password' };
  const wrong = { email: user.email, password: 'wrong-password' };
  const malformed = { email: 'not-an-email', password: 'x' };

  it('counts successful, failed and malformed attempts, then refuses with 429', async () => {
    const a = from('203.0.113.10');
    await a.login(right).expect(200);
    await a.login(wrong).expect(401);
    await a.login(malformed).expect(400);

    const refused = await a.login(right).expect(429);
    expect(refused.body).toEqual({
      statusCode: 429,
      message: LOGIN_THROTTLE_MESSAGE,
    });
    expect(refused.headers['retry-after-login']).toBeDefined();
    // Refused before the handler: no password check on the 4th request.
    expect(authService.validateUser).toHaveBeenCalledTimes(2);
  });

  it('allows exactly the limit from one IP', async () => {
    const a = from('203.0.113.11');
    for (let i = 0; i < LIMIT; i++) await a.login(wrong).expect(401);
    await a.login(wrong).expect(429);
  });

  it('counts each client IP separately', async () => {
    const a = from('203.0.113.12');
    for (let i = 0; i < LIMIT; i++) await a.login(wrong).expect(401);
    await a.login(right).expect(429);

    await from('198.51.100.20').login(right).expect(200);
  });

  it('leaves refresh and logout alone for an IP whose logins are blocked', async () => {
    const a = from('203.0.113.13');
    for (let i = 0; i < LIMIT; i++) await a.login(wrong).expect(401);
    await a.login(right).expect(429);

    for (let i = 0; i < LIMIT + 2; i++) {
      await a.post('refresh').expect(401);
      await a.post('logout').expect(200);
    }
  });

  it('keeps the default 429 message on other routes', async () => {
    // 11 logouts at once exceed the global `short` limit (10 per second)
    // for that route; the login message must not appear there.
    const a = from('203.0.113.14');
    const responses = await Promise.all(
      Array.from({ length: 11 }, () => a.post('logout')),
    );
    const refused = responses.filter((r) => r.status === 429);
    expect(refused.length).toBeGreaterThan(0);
    for (const r of refused) {
      expect((r.body as { message: string }).message).toBe(throttlerMessage);
    }
  });
});
