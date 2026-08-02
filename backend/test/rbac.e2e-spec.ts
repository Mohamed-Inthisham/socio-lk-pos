import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { createTestApp, truncateAllTables } from './setup';
import { User } from '../src/users/entities/user.entity';
import { UserRole } from '../src/users/enums/user-role.enum';
import { Branch } from '../src/branches/entities/branch.entity';
import { AuditLog } from '../src/audit-log/entities/audit-log.entity';

describe('RBAC (e2e)', () => {
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

  // Helper: get-or-create the default Main Shop branch.
  // Non-admin users need a branch per CHK_users_branch_role.
  async function getOrCreateMainShop(): Promise<Branch> {
    const repo = dataSource.getRepository(Branch);
    const existing = await repo.findOne({ where: { name: 'Main Shop' } });
    if (existing) return existing;
    return repo.save(repo.create({ name: 'Main Shop', is_active: true }));
  }

  async function seedUser(overrides: Partial<User> = {}) {
    const password = 'testpass123';
    const password_hash = await bcrypt.hash(password, 4);

    const role = overrides.role ?? UserRole.ADMIN;
    let branch_id: string | null = overrides.branch_id ?? null;
    if (role !== UserRole.ADMIN && branch_id === null) {
      branch_id = (await getOrCreateMainShop()).id;
    }

    const userRepo = dataSource.getRepository(User);
    const user = userRepo.create({
      email: 'user@test.com',
      password_hash,
      full_name: 'Test User',
      role: UserRole.ADMIN,
      is_active: true,
      ...overrides,
      branch_id, // last so overrides can't leave it undefined
    });
    const saved = await userRepo.save(user);
    return { user: saved, password };
  }

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

  describe('Public routes (no @Roles, marked @Public)', () => {
    it('root / responds without any auth', async () => {
      // AppController.getHello is @Public()
      await request(app.getHttpServer()).get('/api/v1').expect(200);
    });
  });

  describe('Admin-only routes: GET /users/:id', () => {
    it('returns 401 for unauthenticated requests', async () => {
      const { user } = await seedUser();

      await request(app.getHttpServer())
        .get(`/api/v1/users/${user.id}`)
        .expect(401);
    });

    it('returns 403 for a valid cashier (auth OK, authorization denied)', async () => {
      const { user: admin } = await seedUser({
        email: 'admin@test.com',
        role: UserRole.ADMIN,
      });
      const { password: cashierPass } = await seedUser({
        email: 'cashier@test.com',
        role: UserRole.CASHIER,
      });
      const cashierCookies = await loginAndGetCookies(
        'cashier@test.com',
        cashierPass,
      );

      await request(app.getHttpServer())
        .get(`/api/v1/users/${admin.id}`)
        .set('Cookie', cashierCookies)
        .expect(403);
    });

    it('returns 200 for an admin', async () => {
      const { user: admin, password } = await seedUser({
        email: 'admin@test.com',
        role: UserRole.ADMIN,
      });
      const cookies = await loginAndGetCookies('admin@test.com', password);

      await request(app.getHttpServer())
        .get(`/api/v1/users/${admin.id}`)
        .set('Cookie', cookies)
        .expect(200);
    });
  });

  describe('Admin-only + @Auditable route: PATCH /users/:id', () => {
    it('writes an audit_logs row when an admin updates a user', async () => {
      const { user: admin, password } = await seedUser({
        email: 'admin@test.com',
        role: UserRole.ADMIN,
      });
      const cookies = await loginAndGetCookies('admin@test.com', password);

      await request(app.getHttpServer())
        .patch(`/api/v1/users/${admin.id}`)
        .set('Cookie', cookies)
        .send({ full_name: 'Updated Name' })
        .expect(200);

      // Audit write is fire-and-forget inside tap() — give it a moment to flush
      await new Promise((r) => setTimeout(r, 100));

      const auditLogs = await dataSource.getRepository(AuditLog).find();
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0]).toMatchObject({
        user_id: admin.id,
        user_name: admin.full_name,
        user_role: UserRole.ADMIN,
        action: 'UPDATE',
        entity_type: 'User',
        entity_id: admin.id,
      });
      expect(auditLogs[0].changes).toMatchObject({
        full_name: { old: 'Test User', new: 'Updated Name' },
      });
    });

    it('does not write an audit_logs row when auth fails', async () => {
      const { user } = await seedUser();

      await request(app.getHttpServer())
        .patch(`/api/v1/users/${user.id}`)
        .send({ full_name: 'Hacked' })
        .expect(401);

      // Wait to ensure any spurious async writes would have landed
      await new Promise((r) => setTimeout(r, 100));

      const auditLogs = await dataSource.getRepository(AuditLog).find();
      expect(auditLogs).toHaveLength(0);
    });
  });
});
