import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { createTestApp, truncateAllTables } from './setup';
import { User } from '../src/users/entities/user.entity';
import { UserRole } from '../src/users/enums/user-role.enum';
import { Supplier } from '../src/suppliers/entities/supplier.entity';
import { Branch } from '../src/branches/entities/branch.entity';

describe('Suppliers (e2e)', () => {
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

  async function seedSupplier(overrides: Partial<Supplier> = {}) {
    const repo = dataSource.getRepository(Supplier);
    return repo.save(
      repo.create({
        name: 'Ranjith Mobile',
        contact_person: null,
        phone: null,
        email: null,
        address: null,
        notes: null,
        is_active: true,
        ...overrides,
      }),
    );
  }

  async function loginAndGetCookies(
    email: string,
    password: string,
  ): Promise<string[]> {
    // Small delay to avoid tripping the 10/sec throttler.
    await new Promise((r) => setTimeout(r, 110));

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return response.headers['set-cookie'] as unknown as string[];
  }

  describe('GET /api/v1/suppliers', () => {
    it('returns list to admin, sorted alphabetically', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      await seedSupplier({ name: 'Zulfi Shop' });
      await seedSupplier({ name: 'Ahmed Mobiles' });
      await seedSupplier({ name: 'Ranjith Mobile' });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .get('/api/v1/suppliers')
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body).toHaveLength(3);
      expect(response.body.map((s: Supplier) => s.name)).toEqual([
        'Ahmed Mobiles',
        'Ranjith Mobile',
        'Zulfi Shop',
      ]);
    });

    it('returns list to manager', async () => {
      const { user, password } = await seedUser(UserRole.MANAGER, 'm@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .get('/api/v1/suppliers')
        .set('Cookie', cookies)
        .expect(200);
    });

    it('returns list to cashier', async () => {
      const { user, password } = await seedUser(UserRole.CASHIER, 'c@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .get('/api/v1/suppliers')
        .set('Cookie', cookies)
        .expect(200);
    });

    it('excludes inactive suppliers by default', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      await seedSupplier({ name: 'Active Shop', is_active: true });
      await seedSupplier({ name: 'Closed Shop', is_active: false });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .get('/api/v1/suppliers')
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].name).toBe('Active Shop');
    });

    it('includes inactive suppliers when includeInactive=true', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      await seedSupplier({ name: 'Active Shop', is_active: true });
      await seedSupplier({ name: 'Closed Shop', is_active: false });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .get('/api/v1/suppliers?includeInactive=true')
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body).toHaveLength(2);
    });

    it('returns 401 when unauthenticated', async () => {
      await request(app.getHttpServer()).get('/api/v1/suppliers').expect(401);
    });
  });

  describe('GET /api/v1/suppliers/:id', () => {
    it('admin can fetch a single supplier with all fields', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const supplier = await seedSupplier({
        name: 'Ranjith Mobile',
        contact_person: 'Ranjith',
        phone: '0771234567',
        email: 'ranjith@shop.lk',
        address: 'No 45, Galle Road',
        notes: '30-day terms',
      });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${supplier.id}`)
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body).toMatchObject({
        id: supplier.id,
        name: 'Ranjith Mobile',
        contact_person: 'Ranjith',
        phone: '0771234567',
        email: 'ranjith@shop.lk',
        address: 'No 45, Galle Road',
        notes: '30-day terms',
        is_active: true,
      });
    });

    it('returns 404 for a non-existent supplier', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const fakeId = '00000000-0000-0000-0000-000000000000';

      await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${fakeId}`)
        .set('Cookie', cookies)
        .expect(404);
    });

    it('returns 400 for a malformed UUID', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .get('/api/v1/suppliers/not-a-uuid')
        .set('Cookie', cookies)
        .expect(400);
    });
  });

  describe('GET /api/v1/suppliers/:id/sales-count', () => {
    it('admin gets {count: 0} for a valid supplier (stub in A2)', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const supplier = await seedSupplier();
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${supplier.id}/sales-count`)
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body).toEqual({ count: 0 });
    });

    it('returns 404 for a non-existent supplier', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const fakeId = '00000000-0000-0000-0000-000000000000';

      await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${fakeId}/sales-count`)
        .set('Cookie', cookies)
        .expect(404);
    });

    it('cashier is forbidden from viewing sales-count', async () => {
      const { user, password } = await seedUser(UserRole.CASHIER, 'c@t.com');
      const supplier = await seedSupplier();
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${supplier.id}/sales-count`)
        .set('Cookie', cookies)
        .expect(403);
    });
  });

  describe('POST /api/v1/suppliers', () => {
    it('admin can create a supplier with only the required name', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Cookie', cookies)
        .send({ name: 'Ranjith Mobile' })
        .expect(201);

      expect(response.body).toMatchObject({
        name: 'Ranjith Mobile',
        contact_person: null,
        phone: null,
        email: null,
        address: null,
        notes: null,
        is_active: true,
      });
      expect(response.body.id).toBeDefined();
    });

    it('admin can create a supplier with all fields', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Cookie', cookies)
        .send({
          name: 'Ranjith Mobile',
          contact_person: 'Ranjith Perera',
          phone: '0771234567',
          email: 'ranjith@shop.lk',
          address: 'No 45, Galle Road, Colombo 03',
          notes: '30-day terms',
        })
        .expect(201);

      expect(response.body).toMatchObject({
        name: 'Ranjith Mobile',
        contact_person: 'Ranjith Perera',
        phone: '0771234567',
        email: 'ranjith@shop.lk',
        address: 'No 45, Galle Road, Colombo 03',
        notes: '30-day terms',
      });
    });

    it('trims whitespace from all fields', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Cookie', cookies)
        .send({
          name: '  Ranjith Mobile  ',
          contact_person: '  Ranjith  ',
          phone: '  0771234567  ',
          email: '  ranjith@shop.lk  ',
          address: '  No 45  ',
          notes: '  Notes  ',
        })
        .expect(201);

      expect(response.body.name).toBe('Ranjith Mobile');
      expect(response.body.contact_person).toBe('Ranjith');
      expect(response.body.phone).toBe('0771234567');
      expect(response.body.email).toBe('ranjith@shop.lk');
      expect(response.body.address).toBe('No 45');
      expect(response.body.notes).toBe('Notes');
    });

    it('rejects duplicate name (case-insensitive) with 409', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      await seedSupplier({ name: 'Ranjith Mobile' });
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Cookie', cookies)
        .send({ name: 'ranjith mobile' })
        .expect(409);
    });

    it('rejects invalid Sri Lankan phone format with 400', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Cookie', cookies)
        .send({ name: 'Shop', phone: '1234567890' })
        .expect(400);
    });

    it('rejects invalid email with 400', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Cookie', cookies)
        .send({ name: 'Shop', email: 'not-an-email' })
        .expect(400);
    });

    it('manager is forbidden from creating', async () => {
      const { user, password } = await seedUser(UserRole.MANAGER, 'm@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Cookie', cookies)
        .send({ name: 'Shop' })
        .expect(403);
    });

    it('cashier is forbidden from creating', async () => {
      const { user, password } = await seedUser(UserRole.CASHIER, 'c@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Cookie', cookies)
        .send({ name: 'Shop' })
        .expect(403);
    });

    it('rejects missing name', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Cookie', cookies)
        .send({})
        .expect(400);
    });
  });

  describe('PATCH /api/v1/suppliers/:id', () => {
    it('admin can rename a supplier', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const supplier = await seedSupplier();
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/suppliers/${supplier.id}`)
        .set('Cookie', cookies)
        .send({ name: 'Ranjith Mobile Pvt Ltd' })
        .expect(200);

      expect(response.body.name).toBe('Ranjith Mobile Pvt Ltd');
    });

    it('admin can update optional fields', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const supplier = await seedSupplier();
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/suppliers/${supplier.id}`)
        .set('Cookie', cookies)
        .send({
          contact_person: 'New Contact',
          phone: '0779999999',
          email: 'new@shop.lk',
        })
        .expect(200);

      expect(response.body.contact_person).toBe('New Contact');
      expect(response.body.phone).toBe('0779999999');
      expect(response.body.email).toBe('new@shop.lk');
      // Unchanged fields stay as they were
      expect(response.body.name).toBe('Ranjith Mobile');
    });

    it('empty strings on optional fields clear them to null', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const supplier = await seedSupplier({
        contact_person: 'Old Contact',
        phone: '0770000000',
      });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/suppliers/${supplier.id}`)
        .set('Cookie', cookies)
        .send({ contact_person: '', phone: '' })
        .expect(200);

      expect(response.body.contact_person).toBeNull();
      expect(response.body.phone).toBeNull();
    });

    it('rejects rename to existing name (case-insensitive) with 409', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const supplier = await seedSupplier({ name: 'Ranjith Mobile' });
      await seedSupplier({ name: 'Ahmed Mobiles' });
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .patch(`/api/v1/suppliers/${supplier.id}`)
        .set('Cookie', cookies)
        .send({ name: 'ahmed mobiles' })
        .expect(409);
    });

    it('allows renaming to the same name (different case)', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const supplier = await seedSupplier({ name: 'Ranjith Mobile' });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/suppliers/${supplier.id}`)
        .set('Cookie', cookies)
        .send({ name: 'RANJITH MOBILE' })
        .expect(200);

      expect(response.body.name).toBe('RANJITH MOBILE');
    });

    it('cashier is forbidden from updating', async () => {
      const { user, password } = await seedUser(UserRole.CASHIER, 'c@t.com');
      const supplier = await seedSupplier();
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .patch(`/api/v1/suppliers/${supplier.id}`)
        .set('Cookie', cookies)
        .send({ name: 'Hacked' })
        .expect(403);
    });
  });

  describe('DELETE /api/v1/suppliers/:id', () => {
    it('deactivates a supplier', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const supplier = await seedSupplier();
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .delete(`/api/v1/suppliers/${supplier.id}`)
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.is_active).toBe(false);
    });

    it('returns 404 for a non-existent supplier', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);
      const fakeId = '00000000-0000-0000-0000-000000000000';

      await request(app.getHttpServer())
        .delete(`/api/v1/suppliers/${fakeId}`)
        .set('Cookie', cookies)
        .expect(404);
    });

    it('cashier is forbidden from deactivating', async () => {
      const { user, password } = await seedUser(UserRole.CASHIER, 'c@t.com');
      const supplier = await seedSupplier();
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .delete(`/api/v1/suppliers/${supplier.id}`)
        .set('Cookie', cookies)
        .expect(403);
    });
  });

  describe('POST /api/v1/suppliers/:id/reactivate', () => {
    it('reactivates a deactivated supplier', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const supplier = await seedSupplier({ is_active: false });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/suppliers/${supplier.id}/reactivate`)
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.is_active).toBe(true);
    });

    it('cashier is forbidden from reactivating', async () => {
      const { user, password } = await seedUser(UserRole.CASHIER, 'c@t.com');
      const supplier = await seedSupplier({ is_active: false });
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post(`/api/v1/suppliers/${supplier.id}/reactivate`)
        .set('Cookie', cookies)
        .expect(403);
    });
  });
});
