import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { createTestApp, truncateAllTables } from './setup';
import { User } from '../src/users/entities/user.entity';
import { UserRole } from '../src/users/enums/user-role.enum';
import { Branch } from '../src/branches/entities/branch.entity';
import { Customer } from '../src/customers/entities/customer.entity';

describe('Customers (e2e)', () => {
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

  // ---- helpers ----

  async function getOrCreateMainShop(): Promise<Branch> {
    const repo = dataSource.getRepository(Branch);
    const existing = await repo.findOne({ where: { name: 'Main Shop' } });
    if (existing) return existing;
    return repo.save(repo.create({ name: 'Main Shop', is_active: true }));
  }

  async function seedUser(role: UserRole, email: string) {
    const password = 'testpass123';
    const password_hash = await bcrypt.hash(password, 4);

    let resolvedBranchId: string | null = null;
    if (role !== UserRole.ADMIN) {
      resolvedBranchId = (await getOrCreateMainShop()).id;
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

  async function seedCustomer(overrides: Partial<Customer> = {}) {
    const repo = dataSource.getRepository(Customer);
    return repo.save(
      repo.create({
        name: 'Kamal Perera',
        phone: '0771234567',
        nic: null,
        notes: null,
        ...overrides,
      }),
    );
  }

  async function loginAndGetCookies(
    email: string,
    password: string,
  ): Promise<string[]> {
    // Small delay to avoid tripping the 10/sec throttler in AppModule.
    await new Promise((r) => setTimeout(r, 110));

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return response.headers['set-cookie'] as unknown as string[];
  }

  // ---- GET /customers ----

  describe('GET /api/v1/customers', () => {
    it('returns paginated list to admin', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      await seedCustomer({ name: 'Anon 1', phone: '0771111111' });
      await seedCustomer({ name: 'Anon 2', phone: '0772222222' });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .get('/api/v1/customers')
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.meta.total).toBe(2);
      expect(response.body.meta.page).toBe(1);
      expect(response.body.meta.limit).toBe(50);
    });

    it('returns list to manager and cashier', async () => {
      const manager = await seedUser(UserRole.MANAGER, 'm@t.com');
      let cookies = await loginAndGetCookies(
        manager.user.email,
        manager.password,
      );
      await request(app.getHttpServer())
        .get('/api/v1/customers')
        .set('Cookie', cookies)
        .expect(200);

      const cashier = await seedUser(UserRole.CASHIER, 'c@t.com');
      cookies = await loginAndGetCookies(cashier.user.email, cashier.password);
      await request(app.getHttpServer())
        .get('/api/v1/customers')
        .set('Cookie', cookies)
        .expect(200);
    });

    it('filters by search across name/phone/nic', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      await seedCustomer({ name: 'Kamal Perera', phone: '0771111111' });
      await seedCustomer({ name: 'Nimal Silva', phone: '0772222222' });
      await seedCustomer({
        name: 'Sunil',
        phone: '0773333333',
        nic: '199012345678',
      });
      const cookies = await loginAndGetCookies(user.email, password);

      const byName = await request(app.getHttpServer())
        .get('/api/v1/customers?search=kamal')
        .set('Cookie', cookies)
        .expect(200);
      expect(byName.body.data).toHaveLength(1);
      expect(byName.body.data[0].name).toBe('Kamal Perera');

      const byPhone = await request(app.getHttpServer())
        .get('/api/v1/customers?search=0772222')
        .set('Cookie', cookies)
        .expect(200);
      expect(byPhone.body.data).toHaveLength(1);
      expect(byPhone.body.data[0].name).toBe('Nimal Silva');

      const byNic = await request(app.getHttpServer())
        .get('/api/v1/customers?search=1990123')
        .set('Cookie', cookies)
        .expect(200);
      expect(byNic.body.data).toHaveLength(1);
      expect(byNic.body.data[0].name).toBe('Sunil');
    });

    it('also finds a customer by email, case-insensitively', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      await seedCustomer({ name: 'Kamal Perera', email: 'kamal.p@gmail.com' });
      await seedCustomer({ name: 'Nimal Silva', phone: '0772222222' });
      const cookies = await loginAndGetCookies(user.email, password);

      const byEmail = await request(app.getHttpServer())
        .get('/api/v1/customers?search=Kamal.P@')
        .set('Cookie', cookies)
        .expect(200);
      expect(byEmail.body.data).toHaveLength(1);
      expect(byEmail.body.data[0]).toMatchObject({
        name: 'Kamal Perera',
        email: 'kamal.p@gmail.com',
      });
    });

    it('excludes soft-deleted rows by default', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const active = await seedCustomer({
        name: 'Active',
        phone: '0771111111',
      });
      const deleted = await seedCustomer({
        name: 'Deleted',
        phone: '0772222222',
      });
      await dataSource.getRepository(Customer).softRemove(deleted);
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .get('/api/v1/customers')
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].id).toBe(active.id);
    });

    it('includes soft-deleted rows when include_deleted=true', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      await seedCustomer({ name: 'Active', phone: '0771111111' });
      const deleted = await seedCustomer({
        name: 'Deleted',
        phone: '0772222222',
      });
      await dataSource.getRepository(Customer).softRemove(deleted);
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .get('/api/v1/customers?include_deleted=true')
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.data).toHaveLength(2);
    });

    it('paginates correctly', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      for (let i = 0; i < 25; i++) {
        await seedCustomer({
          name: `Customer ${i}`,
          phone: `07711${String(i).padStart(5, '0')}`,
        });
      }
      const cookies = await loginAndGetCookies(user.email, password);

      const page1 = await request(app.getHttpServer())
        .get('/api/v1/customers?page=1&limit=10')
        .set('Cookie', cookies)
        .expect(200);
      expect(page1.body.data).toHaveLength(10);
      expect(page1.body.meta.total).toBe(25);
      expect(page1.body.meta.totalPages).toBe(3);
      expect(page1.body.meta.hasNext).toBe(true);
      expect(page1.body.meta.hasPrev).toBe(false);

      const page3 = await request(app.getHttpServer())
        .get('/api/v1/customers?page=3&limit=10')
        .set('Cookie', cookies)
        .expect(200);
      expect(page3.body.data).toHaveLength(5);
      expect(page3.body.meta.hasNext).toBe(false);
      expect(page3.body.meta.hasPrev).toBe(true);
    });

    it('returns 401 when unauthenticated', async () => {
      await request(app.getHttpServer()).get('/api/v1/customers').expect(401);
    });
  });

  // ---- GET /customers/:id ----

  describe('GET /api/v1/customers/:id', () => {
    it('returns a customer', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const customer = await seedCustomer();
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/customers/${customer.id}`)
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.id).toBe(customer.id);
      expect(response.body.name).toBe(customer.name);
    });

    it('returns a soft-deleted customer (for restore flow)', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const customer = await seedCustomer();
      await dataSource.getRepository(Customer).softRemove(customer);
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/customers/${customer.id}`)
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.id).toBe(customer.id);
      expect(response.body.deleted_at).not.toBeNull();
    });

    it('returns 404 when customer missing', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .get('/api/v1/customers/00000000-0000-0000-0000-000000000000')
        .set('Cookie', cookies)
        .expect(404);
    });

    it('returns 400 for malformed UUID', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .get('/api/v1/customers/not-a-uuid')
        .set('Cookie', cookies)
        .expect(400);
    });
  });

  // ---- POST /customers ----

  describe('POST /api/v1/customers', () => {
    it('cashier can create a walk-in customer without NIC', async () => {
      const { user, password } = await seedUser(UserRole.CASHIER, 'c@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Cookie', cookies)
        .send({ name: 'Walk-in', phone: '0771234567' })
        .expect(201);

      expect(response.body.name).toBe('Walk-in');
      expect(response.body.phone).toBe('0771234567');
      expect(response.body.nic).toBeNull();
      expect(response.body.email).toBeNull();
      expect(response.body.notes).toBeNull();
    });

    it('trims and lowercases the email; an empty email is none', async () => {
      const { user, password } = await seedUser(UserRole.CASHIER, 'c@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      const withEmail = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Cookie', cookies)
        .send({
          name: 'Kamal',
          phone: '0771234567',
          email: '  Kamal.Perera@Example.COM ',
        })
        .expect(201);
      expect(withEmail.body.email).toBe('kamal.perera@example.com');

      const blank = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Cookie', cookies)
        .send({ name: 'Nimal', phone: '0772222222', email: '   ' })
        .expect(201);
      expect(blank.body.email).toBeNull();
    });

    it('lets two customers share an email (family members)', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      for (const [name, phone] of [
        ['Kamal Perera', '0771234567'],
        ['Nadeesha Perera', '0779876543'],
      ]) {
        await request(app.getHttpServer())
          .post('/api/v1/customers')
          .set('Cookie', cookies)
          .send({ name, phone, email: 'perera.family@gmail.com' })
          .expect(201);
      }
    });

    it.each([
      ['an invalid email', 'kamal@', 'email must be a valid email address'],
      [
        'an email over 254 characters',
        `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.com`,
        'email must be shorter than or equal to 254 characters',
      ],
    ])('rejects %s with 400', async (_, email, message) => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Cookie', cookies)
        .send({ name: 'Kamal', phone: '0771234567', email })
        .expect(400);
      expect(JSON.stringify(response.body.message)).toContain(message);
    });

    it('normalizes international phone to local format', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Cookie', cookies)
        .send({ name: 'Kamal', phone: '+94771234567' })
        .expect(201);

      expect(response.body.phone).toBe('0771234567');
    });

    it('trims name and uppercases nic', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Cookie', cookies)
        .send({
          name: '  Kamal Perera  ',
          phone: '0771234567',
          nic: 'v1234567',
        })
        .expect(201);

      expect(response.body.name).toBe('Kamal Perera');
      expect(response.body.nic).toBe('V1234567');
    });

    it('rejects invalid SL phone with 400', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Cookie', cookies)
        .send({ name: 'X', phone: '12345' })
        .expect(400);
    });

    it('rejects missing name with 400', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Cookie', cookies)
        .send({ phone: '0771234567' })
        .expect(400);
    });

    it('rejects unknown fields (whitelist)', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Cookie', cookies)
        .send({
          name: 'X',
          phone: '0771234567',
          malicious_field: 'hack',
        })
        .expect(400);
    });

    it('returns 409 with existing_customer_id on NIC clash', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const existing = await seedCustomer({
        name: 'Original',
        phone: '0771111111',
        nic: '199012345678',
      });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .post('/api/v1/customers')
        .set('Cookie', cookies)
        .send({
          name: 'Duplicate',
          phone: '0772222222',
          nic: '199012345678',
        })
        .expect(409);

      expect(response.body.existing_customer_id).toBe(existing.id);
    });

    it('returns 401 when unauthenticated', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/customers')
        .send({ name: 'X', phone: '0771234567' })
        .expect(401);
    });
  });

  // ---- PATCH /customers/:id ----

  describe('PATCH /api/v1/customers/:id', () => {
    it('cashier can update name and notes', async () => {
      const { user, password } = await seedUser(UserRole.CASHIER, 'c@t.com');
      const customer = await seedCustomer();
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/customers/${customer.id}`)
        .set('Cookie', cookies)
        .send({ name: 'Updated Name', notes: 'VIP' })
        .expect(200);

      expect(response.body.name).toBe('Updated Name');
      expect(response.body.notes).toBe('VIP');
      expect(response.body.phone).toBe(customer.phone); // unchanged
    });

    it('clears nic when set to null', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const customer = await seedCustomer({ nic: '199012345678' });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/customers/${customer.id}`)
        .set('Cookie', cookies)
        .send({ nic: null })
        .expect(200);

      expect(response.body.nic).toBeNull();

      // Verify DB directly (per codebase convention for stock-touching-ish ops)
      const fromDb = await dataSource
        .getRepository(Customer)
        .findOne({ where: { id: customer.id } });
      expect(fromDb?.nic).toBeNull();
    });

    it('sets the email (lowercased), then clears it with null', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const customer = await seedCustomer();
      const cookies = await loginAndGetCookies(user.email, password);

      const set = await request(app.getHttpServer())
        .patch(`/api/v1/customers/${customer.id}`)
        .set('Cookie', cookies)
        .send({ email: 'Kamal@Example.com' })
        .expect(200);
      expect(set.body.email).toBe('kamal@example.com');

      const cleared = await request(app.getHttpServer())
        .patch(`/api/v1/customers/${customer.id}`)
        .set('Cookie', cookies)
        .send({ email: null })
        .expect(200);
      expect(cleared.body.email).toBeNull();
    });

    it('returns 409 on NIC clash with another customer', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const other = await seedCustomer({
        name: 'Other',
        phone: '0772222222',
        nic: '200012345678',
      });
      const target = await seedCustomer({
        name: 'Target',
        phone: '0773333333',
        nic: '199912345678',
      });
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/customers/${target.id}`)
        .set('Cookie', cookies)
        .send({ nic: '200012345678' })
        .expect(409);

      expect(response.body.existing_customer_id).toBe(other.id);
    });

    it('returns 409 when updating a soft-deleted customer', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const customer = await seedCustomer();
      await dataSource.getRepository(Customer).softRemove(customer);
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .patch(`/api/v1/customers/${customer.id}`)
        .set('Cookie', cookies)
        .send({ name: 'X' })
        .expect(409);
    });

    it('returns 404 when customer missing', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .patch('/api/v1/customers/00000000-0000-0000-0000-000000000000')
        .set('Cookie', cookies)
        .send({ name: 'X' })
        .expect(404);
    });
  });

  // ---- DELETE /customers/:id ----

  describe('DELETE /api/v1/customers/:id', () => {
    it('admin can soft-delete', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const customer = await seedCustomer();
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .delete(`/api/v1/customers/${customer.id}`)
        .set('Cookie', cookies)
        .expect(204);

      // Verify DB: row still present, deleted_at set
      const fromDb = await dataSource
        .getRepository(Customer)
        .findOne({ where: { id: customer.id }, withDeleted: true });
      expect(fromDb).not.toBeNull();
      expect(fromDb?.deleted_at).not.toBeNull();
    });

    it('manager can soft-delete', async () => {
      const { user, password } = await seedUser(UserRole.MANAGER, 'm@t.com');
      const customer = await seedCustomer();
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .delete(`/api/v1/customers/${customer.id}`)
        .set('Cookie', cookies)
        .expect(204);
    });

    it('cashier is forbidden from deleting', async () => {
      const { user, password } = await seedUser(UserRole.CASHIER, 'c@t.com');
      const customer = await seedCustomer();
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .delete(`/api/v1/customers/${customer.id}`)
        .set('Cookie', cookies)
        .expect(403);
    });

    it('returns 409 when already deleted', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const customer = await seedCustomer();
      await dataSource.getRepository(Customer).softRemove(customer);
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .delete(`/api/v1/customers/${customer.id}`)
        .set('Cookie', cookies)
        .expect(409);
    });

    it('returns 404 when missing', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .delete('/api/v1/customers/00000000-0000-0000-0000-000000000000')
        .set('Cookie', cookies)
        .expect(404);
    });
  });

  // ---- POST /customers/:id/reactivate ----

  describe('POST /api/v1/customers/:id/reactivate', () => {
    it('admin can restore a soft-deleted customer', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const customer = await seedCustomer();
      await dataSource.getRepository(Customer).softRemove(customer);
      const cookies = await loginAndGetCookies(user.email, password);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/customers/${customer.id}/reactivate`)
        .set('Cookie', cookies)
        .expect(200);

      expect(response.body.id).toBe(customer.id);
      expect(response.body.deleted_at).toBeNull();

      // Verify DB
      const fromDb = await dataSource
        .getRepository(Customer)
        .findOne({ where: { id: customer.id } });
      expect(fromDb).not.toBeNull();
      expect(fromDb?.deleted_at).toBeNull();
    });

    it('cashier is forbidden from reactivating', async () => {
      const { user, password } = await seedUser(UserRole.CASHIER, 'c@t.com');
      const customer = await seedCustomer();
      await dataSource.getRepository(Customer).softRemove(customer);
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post(`/api/v1/customers/${customer.id}/reactivate`)
        .set('Cookie', cookies)
        .expect(403);
    });

    it('returns 409 when customer is not deleted', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const customer = await seedCustomer();
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post(`/api/v1/customers/${customer.id}/reactivate`)
        .set('Cookie', cookies)
        .expect(409);
    });

    it('returns 404 when missing', async () => {
      const { user, password } = await seedUser(UserRole.ADMIN, 'admin@t.com');
      const cookies = await loginAndGetCookies(user.email, password);

      await request(app.getHttpServer())
        .post(
          '/api/v1/customers/00000000-0000-0000-0000-000000000000/reactivate',
        )
        .set('Cookie', cookies)
        .expect(404);
    });
  });
});
