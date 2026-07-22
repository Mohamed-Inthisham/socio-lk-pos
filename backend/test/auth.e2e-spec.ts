import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { createTestApp, truncateAllTables } from './setup';
import { User } from '../src/users/entities/user.entity';
import { UserRole } from '../src/users/enums/user-role.enum';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

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

  // Helper: seed a user directly via the repository (bypasses UsersService
  // to keep tests independent of that service's behavior)
  async function seedUser(overrides: Partial<User> = {}) {
    const password = 'testpass123';
    const password_hash = await bcrypt.hash(password, 4);
    const userRepo = dataSource.getRepository(User);
    const user = userRepo.create({
      email: 'admin@test.com',
      password_hash,
      full_name: 'Test Admin',
      role: UserRole.ADMIN,
      is_active: true,
      ...overrides,
    });
    const saved = await userRepo.save(user);
    return { user: saved, password };
  }

  describe('POST /api/v1/auth/login', () => {
    it('logs in with valid credentials and sets both cookies', async () => {
      const { user, password } = await seedUser();

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: user.email, password })
        .expect(200);

      expect(response.body).toEqual({
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          role: user.role,
        },
      });

      const cookies = response.headers['set-cookie'] as unknown as string[];
      expect(cookies).toBeDefined();
      expect(cookies.some((c) => c.startsWith('access_token='))).toBe(true);
      expect(cookies.some((c) => c.startsWith('refresh_token='))).toBe(true);

      // Cookies must be httpOnly and SameSite=Strict
      const accessCookie = cookies.find((c) => c.startsWith('access_token='));
      expect(accessCookie).toMatch(/HttpOnly/i);
      expect(accessCookie).toMatch(/SameSite=Strict/i);
    });

    it('rejects invalid password with 401', async () => {
      await seedUser();

      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'admin@test.com', password: 'wrong' })
        .expect(401);
    });

    it('rejects unknown email with 401', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@test.com', password: 'whatever' })
        .expect(401);
    });

    it('rejects inactive users with 401', async () => {
      const { password } = await seedUser({ is_active: false });

      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'admin@test.com', password })
        .expect(401);
    });

    it('rejects malformed body with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'not-an-email' })
        .expect(400);
    });
  });

  // Helper: log in and return the access + refresh cookies (as a string ready
  // for supertest's `.set('Cookie', ...)`)
  async function loginAndGetCookies(
    email: string,
    password: string,
  ): Promise<string[]> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return response.headers['set-cookie'] as unknown as string[];
  }

  describe('GET /api/v1/auth/me', () => {
    it('returns the current user when authenticated', async () => {
      const { user, password } = await seedUser();
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body).toEqual({
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          role: user.role,
        },
      });
    });

    it('returns 401 when no cookies are sent', async () => {
      await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    });

    it('returns 401 when a garbage access_token is sent', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', 'access_token=not-a-real-jwt')
        .expect(401);
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('rotates tokens and sets new cookies', async () => {
      const { user, password } = await seedUser();
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookies)
        .expect(200);

      const newCookies = response.headers['set-cookie'] as unknown as string[];
      expect(newCookies).toBeDefined();
      expect(newCookies.some((c) => c.startsWith('access_token='))).toBe(true);
      expect(newCookies.some((c) => c.startsWith('refresh_token='))).toBe(true);
    });

    it('revokes all sessions when a revoked refresh token is presented (reuse detection)', async () => {
      const { user, password } = await seedUser();
      const firstLoginCookies = await loginAndGetCookies(user.email, password);

      // First refresh — succeeds, rotates the token
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', firstLoginCookies)
        .expect(200);

      // Second refresh with the OLD (now-revoked) refresh token → 401
      // AND all sessions for the user should be revoked
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', firstLoginCookies)
        .expect(401);
    });

    it('returns 401 when no refresh cookie is present', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .expect(401);
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('clears cookies and revokes the refresh token', async () => {
      const { user, password } = await seedUser();
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Cookie', cookies)
        .expect(200);

      // Response should tell the browser to clear both cookies
      const clearCookies = response.headers[
        'set-cookie'
      ] as unknown as string[];
      expect(clearCookies).toBeDefined();
      // Cleared cookies show up as `access_token=; ...` (empty value)
      expect(clearCookies.some((c) => /access_token=;/.test(c))).toBe(true);
      expect(clearCookies.some((c) => /refresh_token=;/.test(c))).toBe(true);

      // After logout, the refresh token should no longer work
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookies)
        .expect(401);
    });

    it('is idempotent even without cookies', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .expect(200);
    });
  });
});
