import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { createTestApp, truncateAllTables } from './setup';
import { User } from '../src/users/entities/user.entity';
import { UserRole } from '../src/users/enums/user-role.enum';
import { Category } from '../src/categories/entities/category.entity';
import { Branch } from '../src/branches/entities/branch.entity';

describe('Categories (e2e)', () => {
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

  async function seedCategory(overrides: Partial<Category> = {}) {
    const repo = dataSource.getRepository(Category);
    return repo.save(
      repo.create({
        name: 'Accessories',
        parent_id: null,
        sort_order: 0,
        is_active: true,
        ...overrides,
      }),
    );
  }

  async function loginAndGetCookies(
    email: string,
    password: string,
  ): Promise<string[]> {
    await new Promise((r) => setTimeout(r, 110));

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return response.headers['set-cookie'] as unknown as string[];
  }

  describe('GET /api/v1/categories', () => {
    it('returns list sorted by sort_order then name', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      await seedCategory({ name: 'Watches', sort_order: 2 });
      await seedCategory({ name: 'Phones', sort_order: 1 });
      await seedCategory({ name: 'Accessories', sort_order: 1 });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .get('/api/v1/categories')
        .set('Cookie', cookies)
        .expect(200);

      const names = (response.body as Category[]).map((c) => c.name);
      // sort_order 1 group first, alphabetically; then sort_order 2
      expect(names).toEqual(['Accessories', 'Phones', 'Watches']);
    });

    it('excludes inactive by default', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      await seedCategory({ name: 'Active', is_active: true });
      await seedCategory({ name: 'Old', is_active: false });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .get('/api/v1/categories')
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body).toHaveLength(1);
    });

    it('returns 401 unauthenticated', async () => {
      await request(app.getHttpServer()).get('/api/v1/categories').expect(401);
    });

    it('cashier can list categories', async () => {
      const { user, password } = await seedUser(UserRole.CASHIER, 'c@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .get('/api/v1/categories')
        .set('Cookie', cookies)
        .expect(200);
    });
  });

  describe('GET /api/v1/categories/top-level', () => {
    it('returns only top-level categories', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const accessories = await seedCategory({ name: 'Accessories' });
      await seedCategory({ name: 'Cables', parent_id: accessories.id });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .get('/api/v1/categories/top-level')
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect((response.body as Category[])[0].name).toBe('Accessories');
    });
  });

  describe('POST /api/v1/categories', () => {
    it('admin can create a top-level category', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Cookie', cookies)
        .send({ name: 'Accessories' })
        .expect(201);

      expect(response.body.name).toBe('Accessories');
      expect(response.body.parent_id).toBeNull();
    });

    it('admin can create a child category under a top-level parent', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const parent = await seedCategory({ name: 'Accessories' });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Cookie', cookies)
        .send({ name: 'Cables', parent_id: parent.id })
        .expect(201);

      expect(response.body.parent_id).toBe(parent.id);
    });

    it('rejects creating a grandchild (three-level attempt) with 400', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const parent = await seedCategory({ name: 'Accessories' });
      const child = await seedCategory({
        name: 'Cables',
        parent_id: parent.id,
      });
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Cookie', cookies)
        .send({ name: 'USB-C', parent_id: child.id })
        .expect(400);
    });

    it('rejects duplicate sibling name (case-insensitive) with 409', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      await seedCategory({ name: 'Accessories' });
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Cookie', cookies)
        .send({ name: 'accessories' })
        .expect(409);
    });

    it('allows same name under different parents', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const accessories = await seedCategory({ name: 'Accessories' });
      const phones = await seedCategory({ name: 'Phones' });
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Cookie', cookies)
        .send({ name: 'Cables', parent_id: accessories.id })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Cookie', cookies)
        .send({ name: 'Cables', parent_id: phones.id })
        .expect(201);
    });

    it('cashier is forbidden from creating', async () => {
      const { user, password } = await seedUser(UserRole.CASHIER, 'c@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post('/api/v1/categories')
        .set('Cookie', cookies)
        .send({ name: 'Accessories' })
        .expect(403);
    });
  });

  describe('PATCH /api/v1/categories/:id', () => {
    it('renames a category', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cat = await seedCategory({ name: 'Cables' });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/categories/${cat.id}`)
        .set('Cookie', cookies)
        .send({ name: 'Cables & Adapters' })
        .expect(200);

      expect(response.body.name).toBe('Cables & Adapters');
    });

    it('rejects setting parent_id to self with 400', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cat = await seedCategory();
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .patch(`/api/v1/categories/${cat.id}`)
        .set('Cookie', cookies)
        .send({ parent_id: cat.id })
        .expect(400);
    });

    it('rejects demoting a parent that has children with 400', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const accessories = await seedCategory({ name: 'Accessories' });
      await seedCategory({ name: 'Cables', parent_id: accessories.id });
      const otherTop = await seedCategory({ name: 'Electronics' });
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .patch(`/api/v1/categories/${accessories.id}`)
        .set('Cookie', cookies)
        .send({ parent_id: otherTop.id })
        .expect(400);
    });

    it('can promote a child to top-level by setting parent_id to null', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const accessories = await seedCategory({ name: 'Accessories' });
      const cables = await seedCategory({
        name: 'Cables',
        parent_id: accessories.id,
      });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/categories/${cables.id}`)
        .set('Cookie', cookies)
        .send({ parent_id: null })
        .expect(200);

      expect(response.body.parent_id).toBeNull();
    });
  });

  describe('DELETE /api/v1/categories/:id', () => {
    it('deactivates', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cat = await seedCategory();
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .delete(`/api/v1/categories/${cat.id}`)
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.is_active).toBe(false);
    });

    it('does not affect children when parent is deactivated', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const parent = await seedCategory({ name: 'Accessories' });
      const child = await seedCategory({
        name: 'Cables',
        parent_id: parent.id,
      });
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .delete(`/api/v1/categories/${parent.id}`)
        .set('Cookie', cookies)
        .expect(200);

      // Child should still be active
      const childResponse = await request(app.getHttpServer())
        .get(`/api/v1/categories/${child.id}`)
        .set('Cookie', cookies)
        .expect(200);

      expect(childResponse.body.is_active).toBe(true);
    });
  });

  describe('POST /api/v1/categories/:id/reactivate', () => {
    it('reactivates', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cat = await seedCategory({ is_active: false });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/categories/${cat.id}/reactivate`)
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.is_active).toBe(true);
    });
  });
});
