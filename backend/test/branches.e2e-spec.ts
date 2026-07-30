import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { createTestApp, truncateAllTables } from './setup';
import { User } from '../src/users/entities/user.entity';
import { UserRole } from '../src/users/enums/user-role.enum';
import { Branch } from '../src/branches/entities/branch.entity';

describe('Branches (e2e)', () => {
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

  // Helper: seed a user with a specific role
  async function seedUser(role: UserRole, email: string) {
    const password = 'testpass123';
    const password_hash = await bcrypt.hash(password, 4);
    const userRepo = dataSource.getRepository(User);
    const user = await userRepo.save(
      userRepo.create({
        email,
        password_hash,
        full_name: `Test ${role}`,
        role,
        is_active: true,
      }),
    );
    return { user, password };
  }

  // Helper: seed a branch directly
  async function seedBranch(overrides: Partial<Branch> = {}) {
    const branchRepo = dataSource.getRepository(Branch);
    return branchRepo.save(
      branchRepo.create({
        name: 'Main Shop',
        is_active: true,
        ...overrides,
      }),
    );
  }

  // Helper: log in and return cookies
  async function loginAndGetCookies(
    email: string,
    password: string,
  ): Promise<string[]> {
    // Small delay to avoid tripping the 10/sec throttler in AppModule.
    // The throttler is a production feature; in-process tests hit its limit.
    // A proper fix (env-driven limits) is tracked as Phase 6.1 tech debt.
    await new Promise((r) => setTimeout(r, 110));

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return response.headers['set-cookie'] as unknown as string[];
  }

  describe('GET /api/v1/branches', () => {
    it('returns list to admin', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      await seedBranch();
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .get('/api/v1/branches')
        .set('Cookie', cookies)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].name).toBe('Main Shop');
    });

    it('returns list to manager', async () => {
      const { user, password } = await seedUser(
        UserRole.MANAGER,
        'manager@t.com',
      );
      await seedBranch();
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .get('/api/v1/branches')
        .set('Cookie', cookies)
        .expect(200);
    });

    it('returns list to cashier', async () => {
      const { user, password } = await seedUser(
        UserRole.CASHIER,
        'cashier@t.com',
      );
      await seedBranch();
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .get('/api/v1/branches')
        .set('Cookie', cookies)
        .expect(200);
    });

    it('excludes inactive branches by default', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      await seedBranch({ name: 'Active Shop', is_active: true });
      await seedBranch({ name: 'Old Shop', is_active: false });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .get('/api/v1/branches')
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].name).toBe('Active Shop');
    });

    it('includes inactive branches when includeInactive=true', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      await seedBranch({ name: 'Active Shop', is_active: true });
      await seedBranch({ name: 'Old Shop', is_active: false });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .get('/api/v1/branches?includeInactive=true')
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body).toHaveLength(2);
    });

    it('returns 401 when unauthenticated', async () => {
      await request(app.getHttpServer()).get('/api/v1/branches').expect(401);
    });
  });

  describe('POST /api/v1/branches', () => {
    it('admin can create a branch', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .post('/api/v1/branches')
        .set('Cookie', cookies)
        .send({
          name: 'Kandy Shop',
          address: '123 Peradeniya Rd',
          phone: '0812223344',
        })
        .expect(201);

      expect(response.body.name).toBe('Kandy Shop');
      expect(response.body.is_active).toBe(true);
      expect(response.body.id).toBeDefined();
    });

    it('manager is forbidden from creating a branch', async () => {
      const { user, password } = await seedUser(
        UserRole.MANAGER,
        'manager@t.com',
      );
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post('/api/v1/branches')
        .set('Cookie', cookies)
        .send({ name: 'Kandy Shop' })
        .expect(403);
    });

    it('cashier is forbidden from creating a branch', async () => {
      const { user, password } = await seedUser(
        UserRole.CASHIER,
        'cashier@t.com',
      );
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post('/api/v1/branches')
        .set('Cookie', cookies)
        .send({ name: 'Kandy Shop' })
        .expect(403);
    });

    it('rejects invalid phone format (non-Sri Lankan)', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post('/api/v1/branches')
        .set('Cookie', cookies)
        .send({ name: 'Kandy Shop', phone: '+94771234567' })
        .expect(400);
    });

    it('rejects phone with letters', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post('/api/v1/branches')
        .set('Cookie', cookies)
        .send({ name: 'Kandy Shop', phone: 'abc1234567' })
        .expect(400);
    });

    it('rejects missing name', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post('/api/v1/branches')
        .set('Cookie', cookies)
        .send({ address: '123 Rd' })
        .expect(400);
    });
  });

  describe('PATCH /api/v1/branches/:id', () => {
    it('admin can update branch name', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const branch = await seedBranch();
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/branches/${branch.id}`)
        .set('Cookie', cookies)
        .send({ name: 'Renamed Shop' })
        .expect(200);

      expect(response.body.name).toBe('Renamed Shop');
    });

    it('cashier is forbidden from updating', async () => {
      const { user, password } = await seedUser(
        UserRole.CASHIER,
        'cashier@t.com',
      );
      const branch = await seedBranch();
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .patch(`/api/v1/branches/${branch.id}`)
        .set('Cookie', cookies)
        .send({ name: 'Hacked' })
        .expect(403);
    });
  });

  describe('DELETE /api/v1/branches/:id — deactivation guard', () => {
    it('deactivates a branch when another active branch exists', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const branch1 = await seedBranch({ name: 'Shop 1' });
      await seedBranch({ name: 'Shop 2' });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .delete(`/api/v1/branches/${branch1.id}`)
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.is_active).toBe(false);
    });

    it('rejects with 400 when trying to deactivate the last active branch', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const onlyBranch = await seedBranch();
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .delete(`/api/v1/branches/${onlyBranch.id}`)
        .set('Cookie', cookies)
        .expect(400);

      expect(response.body.message).toContain('last active branch');
    });

    it('returns 404 for a non-existent branch', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const fakeId = '00000000-0000-0000-0000-000000000000';

      await request(app.getHttpServer())
        .delete(`/api/v1/branches/${fakeId}`)
        .set('Cookie', cookies)
        .expect(404);
    });
  });

  describe('POST /api/v1/branches/:id/reactivate', () => {
    it('reactivates a deactivated branch', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const branch = await seedBranch({ name: 'Old Shop', is_active: false });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/branches/${branch.id}/reactivate`)
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.is_active).toBe(true);
    });

    it('cashier is forbidden from reactivating', async () => {
      const { user, password } = await seedUser(
        UserRole.CASHIER,
        'cashier@t.com',
      );
      const branch = await seedBranch({ is_active: false });
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post(`/api/v1/branches/${branch.id}/reactivate`)
        .set('Cookie', cookies)
        .expect(403);
    });
  });
});
