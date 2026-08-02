import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { createTestApp, truncateAllTables } from './setup';
import { User } from '../src/users/entities/user.entity';
import { UserRole } from '../src/users/enums/user-role.enum';
import { Brand } from '../src/brands/entities/brand.entity';
import { Branch } from '../src/branches/entities/branch.entity';

describe('Brands (e2e)', () => {
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

  async function getOrCreateMainShop(): Promise<Branch> {
    const repo = dataSource.getRepository(Branch);
    const existing = await repo.findOne({ where: { name: 'Main Shop' } });
    if (existing) return existing;
    return repo.save(repo.create({ name: 'Main Shop', is_active: true }));
  }

  async function seedUser(role: UserRole, email: string, branchId?: string) {
    const password = 'testpass123';
    const password_hash = await bcrypt.hash(password, 4);

    let resolvedBranchId: string | null = null;
    if (role !== UserRole.ADMIN) {
      resolvedBranchId = branchId ?? (await getOrCreateMainShop()).id;
    }

    const userRepo = dataSource.getRepository(User);
    const user = await userRepo.save(
      userRepo.create({
        email,
        password_hash,
        full_name: `Test ${role}`,
        role,
        is_active: true,
        branch_id: resolvedBranchId,
      }),
    );
    return { user, password };
  }

  async function seedBrand(overrides: Partial<Brand> = {}) {
    const brandRepo = dataSource.getRepository(Brand);
    return brandRepo.save(
      brandRepo.create({ name: 'Apple', is_active: true, ...overrides }),
    );
  }

  async function loginAndGetCookies(
    email: string,
    password: string,
  ): Promise<string[]> {
    // Small delay to avoid tripping the 10/sec throttler in AppModule.
    // See test/setup.ts followup note.
    await new Promise((r) => setTimeout(r, 110));

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return response.headers['set-cookie'] as unknown as string[];
  }

  describe('GET /api/v1/brands', () => {
    it('returns list to admin, sorted alphabetically', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      await seedBrand({ name: 'Samsung' });
      await seedBrand({ name: 'Apple' });
      await seedBrand({ name: 'Xiaomi' });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .get('/api/v1/brands')
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body).toHaveLength(3);
      expect(response.body.map((b: Brand) => b.name)).toEqual([
        'Apple',
        'Samsung',
        'Xiaomi',
      ]);
    });

    it('returns list to manager', async () => {
      const { user, password } = await seedUser(UserRole.MANAGER, 'm@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .get('/api/v1/brands')
        .set('Cookie', cookies)
        .expect(200);
    });

    it('returns list to cashier', async () => {
      const { user, password } = await seedUser(UserRole.CASHIER, 'c@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .get('/api/v1/brands')
        .set('Cookie', cookies)
        .expect(200);
    });

    it('excludes inactive brands by default', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      await seedBrand({ name: 'Apple', is_active: true });
      await seedBrand({ name: 'Nokia', is_active: false });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .get('/api/v1/brands')
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].name).toBe('Apple');
    });

    it('includes inactive brands when includeInactive=true', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      await seedBrand({ name: 'Apple', is_active: true });
      await seedBrand({ name: 'Nokia', is_active: false });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .get('/api/v1/brands?includeInactive=true')
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body).toHaveLength(2);
    });

    it('returns 401 when unauthenticated', async () => {
      await request(app.getHttpServer()).get('/api/v1/brands').expect(401);
    });
  });

  describe('POST /api/v1/brands', () => {
    it('admin can create a brand', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .post('/api/v1/brands')
        .set('Cookie', cookies)
        .send({ name: 'Apple' })
        .expect(201);

      expect(response.body.name).toBe('Apple');
      expect(response.body.is_active).toBe(true);
      expect(response.body.id).toBeDefined();
    });

    it('trims whitespace from name', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .post('/api/v1/brands')
        .set('Cookie', cookies)
        .send({ name: '  Apple  ' })
        .expect(201);

      expect(response.body.name).toBe('Apple');
    });

    it('rejects duplicate name (case-insensitive) with 409', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      await seedBrand({ name: 'Apple' });
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post('/api/v1/brands')
        .set('Cookie', cookies)
        .send({ name: 'apple' })
        .expect(409);
    });

    it('manager is forbidden from creating', async () => {
      const { user, password } = await seedUser(UserRole.MANAGER, 'm@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post('/api/v1/brands')
        .set('Cookie', cookies)
        .send({ name: 'Apple' })
        .expect(403);
    });

    it('cashier is forbidden from creating', async () => {
      const { user, password } = await seedUser(UserRole.CASHIER, 'c@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post('/api/v1/brands')
        .set('Cookie', cookies)
        .send({ name: 'Apple' })
        .expect(403);
    });

    it('rejects missing name', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post('/api/v1/brands')
        .set('Cookie', cookies)
        .send({})
        .expect(400);
    });
  });

  describe('PATCH /api/v1/brands/:id', () => {
    it('admin can rename a brand', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const brand = await seedBrand();
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/brands/${brand.id}`)
        .set('Cookie', cookies)
        .send({ name: 'Apple Inc' })
        .expect(200);

      expect(response.body.name).toBe('Apple Inc');
    });

    it('rejects rename to existing name (case-insensitive) with 409', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const apple = await seedBrand({ name: 'Apple' });
      await seedBrand({ name: 'Samsung' });
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .patch(`/api/v1/brands/${apple.id}`)
        .set('Cookie', cookies)
        .send({ name: 'samsung' })
        .expect(409);
    });

    it('allows renaming to the same name (different case)', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const brand = await seedBrand({ name: 'Apple' });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/brands/${brand.id}`)
        .set('Cookie', cookies)
        .send({ name: 'APPLE' })
        .expect(200);

      expect(response.body.name).toBe('APPLE');
    });

    it('cashier is forbidden from updating', async () => {
      const { user, password } = await seedUser(UserRole.CASHIER, 'c@t.com');
      const brand = await seedBrand();
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .patch(`/api/v1/brands/${brand.id}`)
        .set('Cookie', cookies)
        .send({ name: 'Hacked' })
        .expect(403);
    });
  });

  describe('DELETE /api/v1/brands/:id', () => {
    it('deactivates a brand', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const brand = await seedBrand();
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .delete(`/api/v1/brands/${brand.id}`)
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.is_active).toBe(false);
    });

    it('returns 404 for a non-existent brand', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const fakeId = '00000000-0000-0000-0000-000000000000';

      await request(app.getHttpServer())
        .delete(`/api/v1/brands/${fakeId}`)
        .set('Cookie', cookies)
        .expect(404);
    });

    it('cashier is forbidden from deactivating', async () => {
      const { user, password } = await seedUser(UserRole.CASHIER, 'c@t.com');
      const brand = await seedBrand();
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .delete(`/api/v1/brands/${brand.id}`)
        .set('Cookie', cookies)
        .expect(403);
    });
  });

  describe('POST /api/v1/brands/:id/reactivate', () => {
    it('reactivates a deactivated brand', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const brand = await seedBrand({ is_active: false });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/brands/${brand.id}/reactivate`)
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.is_active).toBe(true);
    });

    it('cashier is forbidden from reactivating', async () => {
      const { user, password } = await seedUser(UserRole.CASHIER, 'c@t.com');
      const brand = await seedBrand({ is_active: false });
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post(`/api/v1/brands/${brand.id}/reactivate`)
        .set('Cookie', cookies)
        .expect(403);
    });
  });
});
