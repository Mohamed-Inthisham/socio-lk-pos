import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { createTestApp, truncateAllTables } from './setup';
import { giveApprovalPin } from './approval-pin.helper';
import { User } from '../src/users/entities/user.entity';
import { UserRole } from '../src/users/enums/user-role.enum';
import { Branch } from '../src/branches/entities/branch.entity';
import { RefreshToken } from '../src/auth/entities/refresh-token.entity';
import { AuditLog } from '../src/audit-log/entities/audit-log.entity';
import { AuditAction } from '../src/audit-log/enums/audit-action.enum';
import { UsersService } from '../src/users/users.service';

const PASSWORD = 'testpass123';
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hash = (token: string) =>
  createHash('sha256').update(token).digest('hex');

// Fields no user response may carry.
const SECRET_KEYS = [
  'password_hash',
  'approval_pin_hash',
  'approval_pin_failed_attempts',
  'approval_pin_locked_until',
  'refresh_tokens',
  'token_hash',
];

/**
 * The admin user-management routes (Task 2.1): GET /users, POST /users,
 * POST /users/:id/deactivate and /reactivate, plus the PATCH branch_id
 * null fix. One database is seeded for most tests (logins are per-IP
 * throttled); each test makes its own target users. The last-admin tests
 * at the end start from an empty database.
 */
describe('Users API (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let seq = 0;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  async function seedBranch(active = true): Promise<Branch> {
    const repo = dataSource.getRepository(Branch);
    return repo.save(
      repo.create({ name: `Branch ${++seq}`, is_active: active }),
    );
  }

  async function seedUser(
    role: UserRole,
    branchId: string | null,
    opts: {
      active?: boolean;
      name?: string;
      nic?: string | null;
      phone?: string | null;
    } = {},
  ): Promise<User> {
    const repo = dataSource.getRepository(User);
    const n = ++seq;
    return repo.save(
      repo.create({
        email: `${role}${n}@users.test`,
        password_hash: await bcrypt.hash(PASSWORD, 4),
        full_name: opts.name ?? `Test ${role} ${n}`,
        role,
        is_active: opts.active ?? true,
        branch_id: role === UserRole.ADMIN ? null : branchId,
        nic: opts.nic ?? null,
        phone: opts.phone ?? null,
      }),
    );
  }

  const login = (email: string, password = PASSWORD) =>
    http().post('/api/v1/auth/login').send({ email, password });

  async function cookiesFor(user: User): Promise<string[]> {
    const res = await login(user.email).expect(200);
    return res.headers['set-cookie'] as unknown as string[];
  }

  const refreshTokenIn = (cookies: string[]): string => {
    const cookie = cookies.find((c) => c.startsWith('refresh_token='))!;
    return cookie.slice('refresh_token='.length, cookie.indexOf(';'));
  };

  const refresh = (token: string) =>
    http().post('/api/v1/auth/refresh').set('Cookie', `refresh_token=${token}`);

  /** A new-format NIC no other test uses. */
  const freshNic = () => String(199000000000 + ++seq);

  const userRow = (id: string) =>
    dataSource.getRepository(User).findOneByOrFail({ id });

  const auditRows = (action: AuditAction, entityId: string) =>
    dataSource
      .getRepository(AuditLog)
      .findBy({ action, entity_type: 'User', entity_id: entityId });

  /** No secret key anywhere in the body, and no bcrypt hash text. */
  function expectNoSecrets(body: unknown): void {
    const text = JSON.stringify(body);
    for (const key of SECRET_KEYS) {
      expect(text).not.toContain(`"${key}"`);
    }
    expect(text).not.toMatch(/\$2[aby]\$/);
  }

  describe('with a seeded shop', () => {
    let branch: Branch;
    let admin: User;
    let adminCookies: string[];
    let managerCookies: string[];
    let cashierCookies: string[];

    beforeAll(async () => {
      await truncateAllTables(app);
      branch = await seedBranch();
      admin = await seedUser(UserRole.ADMIN, null, { name: 'Head Admin' });
      await seedUser(UserRole.ADMIN, null); // so admins can be deactivated
      const manager = await seedUser(UserRole.MANAGER, branch.id);
      const cashier = await seedUser(UserRole.CASHIER, branch.id);
      adminCookies = await cookiesFor(admin);
      managerCookies = await cookiesFor(manager);
      cashierCookies = await cookiesFor(cashier);
    });

    beforeEach(async () => {
      // Keeps each test clear of the per-route throttle (10 a second).
      await pause(1_100);
    });

    describe('authorization', () => {
      const routes = (id: string) =>
        [
          ['get', '/api/v1/users', undefined],
          ['post', '/api/v1/users', {}],
          ['post', `/api/v1/users/${id}/deactivate`, undefined],
          ['post', `/api/v1/users/${id}/reactivate`, undefined],
        ] as const;

      const call = (
        method: 'get' | 'post',
        path: string,
        body: object | undefined,
        cookies?: string[],
      ) => {
        const req = http()[method](path);
        if (cookies) req.set('Cookie', cookies);
        return body ? req.send(body) : req;
      };

      it('401 without a session on every new route', async () => {
        const target = await seedUser(UserRole.CASHIER, branch.id);
        for (const [method, path, body] of routes(target.id)) {
          await call(method, path, body).expect(401);
        }
      });

      it.each([
        ['manager', () => managerCookies],
        ['cashier', () => cashierCookies],
      ])(
        '403 for a %s on every new route, changing nothing',
        async (_, cookies) => {
          const target = await seedUser(UserRole.CASHIER, branch.id);
          const before = await dataSource.getRepository(User).count();
          for (const [method, path] of routes(target.id)) {
            await call(
              method,
              path,
              method === 'post' && path === '/api/v1/users'
                ? {
                    email: `blocked${++seq}@users.test`,
                    password: PASSWORD,
                    full_name: 'Blocked',
                    role: UserRole.CASHIER,
                    branch_id: branch.id,
                  }
                : undefined,
              cookies(),
            ).expect(403);
          }
          expect(await dataSource.getRepository(User).count()).toBe(before);
          expect((await userRow(target.id)).is_active).toBe(true);
        },
      );
    });

    describe('GET /users', () => {
      it('lists users with their branch and the pagination meta, never a secret', async () => {
        const manager = await seedUser(UserRole.MANAGER, branch.id);
        await giveApprovalPin(dataSource, manager.id);

        const res = await http()
          .get('/api/v1/users')
          .set('Cookie', adminCookies)
          .expect(200);

        const body = res.body as {
          data: (User & { branch: Branch | null })[];
          meta: Record<string, unknown>;
        };
        expect(body.meta).toMatchObject({ page: 1, limit: 50, hasPrev: false });
        expect(body.meta.total).toBe(body.data.length);
        const listed = body.data.find((u) => u.id === manager.id)!;
        expect(listed).toMatchObject({
          email: manager.email,
          role: UserRole.MANAGER,
          branch_id: branch.id,
          branch: { id: branch.id, name: branch.name },
        });
        expect(listed.approval_pin_set_at).not.toBeNull();
        expectNoSecrets(res.body);
      });

      it('pages and filters by branch, role, active state and search', async () => {
        const shop = await seedBranch();
        const names = ['Amal', 'Bimal', 'Chamal'];
        const cashiers: User[] = [];
        for (const name of names) {
          cashiers.push(
            await seedUser(UserRole.CASHIER, shop.id, { name: `${name} X` }),
          );
        }
        const manager = await seedUser(UserRole.MANAGER, shop.id, {
          name: 'Dilan X',
        });
        const gone = await seedUser(UserRole.CASHIER, shop.id, {
          name: 'Eshan X',
          active: false,
        });

        const list = async (query: string) => {
          const res = await http()
            .get(`/api/v1/users?branchId=${shop.id}&${query}`)
            .set('Cookie', adminCookies)
            .expect(200);
          return res.body as {
            data: User[];
            meta: { total: number; totalPages: number; hasNext: boolean };
          };
        };

        const page2 = await list('page=2&limit=2');
        expect(page2.meta).toMatchObject({
          total: 5,
          totalPages: 3,
          hasNext: true,
        });
        // Ordered by name: Amal, Bimal | Chamal, Dilan | Eshan.
        expect(page2.data.map((u) => u.id)).toEqual([
          cashiers[2].id,
          manager.id,
        ]);

        const managers = await list(`role=${UserRole.MANAGER}`);
        expect(managers.data.map((u) => u.id)).toEqual([manager.id]);

        const inactive = await list('isActive=false');
        expect(inactive.data.map((u) => u.id)).toEqual([gone.id]);

        const active = await list('isActive=true');
        expect(active.meta.total).toBe(4);

        const search = await list('search=bIMal');
        expect(search.data.map((u) => u.id)).toEqual([cashiers[1].id]);

        const byEmail = await list(`search=${cashiers[0].email}`);
        expect(byEmail.data.map((u) => u.id)).toEqual([cashiers[0].id]);
      });

      it('leaves soft-deleted users out', async () => {
        const shop = await seedBranch();
        const kept = await seedUser(UserRole.CASHIER, shop.id);
        const deleted = await seedUser(UserRole.CASHIER, shop.id);
        await dataSource.getRepository(User).softDelete(deleted.id);

        const res = await http()
          .get(`/api/v1/users?branchId=${shop.id}`)
          .set('Cookie', adminCookies)
          .expect(200);
        expect((res.body as { data: User[] }).data.map((u) => u.id)).toEqual([
          kept.id,
        ]);
      });

      it.each([
        'isActive=yes',
        'role=owner',
        'branchId=not-a-uuid',
        'limit=500',
        'page=0',
      ])('400 for %s', async (query) => {
        await http()
          .get(`/api/v1/users?${query}`)
          .set('Cookie', adminCookies)
          .expect(400);
      });
    });

    describe('POST /users', () => {
      const body = (overrides: object = {}) => ({
        email: `New.User${++seq}@Users.Test`,
        password: 'Str0ngPass!',
        full_name: 'New Cashier',
        role: UserRole.CASHIER,
        branch_id: branch.id,
        phone: '0771234567',
        nic: freshNic(),
        address: '12 Temple Road, Kandy',
        ...overrides,
      });

      it('creates a user who can log in, audited in the same transaction, never a secret', async () => {
        const payload = body();
        const res = await http()
          .post('/api/v1/users')
          .set('Cookie', adminCookies)
          .send(payload)
          .expect(201);

        const created = res.body as User;
        expect(created).toMatchObject({
          email: payload.email.toLowerCase(),
          full_name: 'New Cashier',
          role: UserRole.CASHIER,
          branch_id: branch.id,
          is_active: true,
        });
        expectNoSecrets(res.body);

        // Written with the user, not after the response.
        const [audit] = await auditRows(AuditAction.CREATE, created.id);
        expect(audit).toMatchObject({
          user_id: admin.id,
          user_name: 'Head Admin',
          user_role: UserRole.ADMIN,
          changes: {
            email: { old: null, new: created.email },
            role: { old: null, new: UserRole.CASHIER },
            branch_id: { old: null, new: branch.id },
          },
        });
        expect(JSON.stringify(audit)).not.toContain(payload.password);
        expect(JSON.stringify(audit)).not.toMatch(/\$2[aby]\$/);

        await login(created.email, payload.password).expect(200);
      });

      it('creates an admin without a branch', async () => {
        const res = await http()
          .post('/api/v1/users')
          .set('Cookie', adminCookies)
          .send(body({ role: UserRole.ADMIN, branch_id: undefined }))
          .expect(201);
        expect(res.body).toMatchObject({
          role: UserRole.ADMIN,
          branch_id: null,
        });
      });

      it('409 for an email already registered (any case), with no audit row', async () => {
        const auditsBefore = await dataSource.getRepository(AuditLog).count();
        await http()
          .post('/api/v1/users')
          .set('Cookie', adminCookies)
          .send(body({ email: admin.email.toUpperCase() }))
          .expect(409);
        expect(await dataSource.getRepository(AuditLog).count()).toBe(
          auditsBefore,
        );
      });

      it.each([
        ['a cashier without a branch', { branch_id: undefined }],
        ['a null branch', { branch_id: null }],
        ['an admin with a branch', { role: UserRole.ADMIN }],
        ['an unknown branch', { branch_id: randomUUID() }],
        ['a 7-character password', { password: 'short12' }],
        ['a 73-byte password', { password: 'a'.repeat(73) }],
        ['an unknown role', { role: 'owner' }],
        ['an extra field', { is_active: false }],
        ['no contact number', { phone: undefined }],
        ['no NIC', { nic: undefined }],
        ['no address', { address: undefined }],
        ['a contact number that is not Sri Lankan', { phone: '12345' }],
        ['an NIC with 10 digits and a V', { nic: '9012345678V' }],
        ['an NIC with 11 digits', { nic: '19901234567' }],
        ['a blank address', { address: '   ' }],
      ])('400 for %s, creating nothing', async (_, overrides) => {
        const before = await dataSource.getRepository(User).count();
        await http()
          .post('/api/v1/users')
          .set('Cookie', adminCookies)
          .send(body(overrides))
          .expect(400);
        expect(await dataSource.getRepository(User).count()).toBe(before);
      });

      it('stores the contact details normalized, returns and audits them', async () => {
        const res = await http()
          .post('/api/v1/users')
          .set('Cookie', adminCookies)
          .send(
            body({
              phone: '+94 77 765-4321',
              nic: ' 851234567v ',
              address: '  4 Lake Road, Galle ',
            }),
          )
          .expect(201);

        const contact = {
          phone: '0777654321',
          nic: '851234567V',
          address: '4 Lake Road, Galle',
        };
        expect(res.body).toMatchObject(contact);
        expect(await userRow((res.body as User).id)).toMatchObject(contact);
        const [audit] = await auditRows(
          AuditAction.CREATE,
          (res.body as User).id,
        );
        expect(audit.changes).toMatchObject({
          phone: { old: null, new: contact.phone },
          nic: { old: null, new: contact.nic },
          address: { old: null, new: contact.address },
        });
      });

      it('409 NIC_ALREADY_REGISTERED for an NIC another user holds (any case), with no user or audit row', async () => {
        await seedUser(UserRole.CASHIER, branch.id, { nic: '781234567X' });
        const usersBefore = await dataSource.getRepository(User).count();
        const auditsBefore = await dataSource.getRepository(AuditLog).count();

        const res = await http()
          .post('/api/v1/users')
          .set('Cookie', adminCookies)
          .send(body({ nic: '781234567x' }))
          .expect(409);

        expect(res.body).toMatchObject({
          message: 'NIC is already registered to another user',
          code: 'NIC_ALREADY_REGISTERED',
        });
        expect(await dataSource.getRepository(User).count()).toBe(usersBefore);
        expect(await dataSource.getRepository(AuditLog).count()).toBe(
          auditsBefore,
        );
      });

      it("reuses a deleted user's NIC", async () => {
        const nic = freshNic();
        const gone = await seedUser(UserRole.CASHIER, branch.id, { nic });
        await dataSource.getRepository(User).softDelete(gone.id);

        const res = await http()
          .post('/api/v1/users')
          .set('Cookie', adminCookies)
          .send(body({ nic }))
          .expect(201);
        expect(res.body).toMatchObject({ nic });
      });

      it('400 for a staff user on an inactive branch', async () => {
        const closed = await seedBranch(false);
        await http()
          .post('/api/v1/users')
          .set('Cookie', adminCookies)
          .send(body({ branch_id: closed.id }))
          .expect(400);
      });
    });

    describe('PATCH /users/:id branch_id', () => {
      it.each([
        ['a cashier', UserRole.CASHIER],
        ['an admin', UserRole.ADMIN],
      ])(
        '400 for a null branch_id on %s, leaving it unchanged',
        async (_, role) => {
          const target = await seedUser(role, branch.id);
          const res = await http()
            .patch(`/api/v1/users/${target.id}`)
            .set('Cookie', adminCookies)
            .send({ branch_id: null })
            .expect(400);
          expect(JSON.stringify(res.body)).toContain(
            'branch_id must not be null',
          );
          expect((await userRow(target.id)).branch_id).toBe(target.branch_id);
        },
      );

      it('still moves a cashier to another active branch', async () => {
        const target = await seedUser(UserRole.CASHIER, branch.id);
        const other = await seedBranch();
        await http()
          .patch(`/api/v1/users/${target.id}`)
          .set('Cookie', adminCookies)
          .send({ branch_id: other.id })
          .expect(200);
        expect((await userRow(target.id)).branch_id).toBe(other.id);
      });
    });

    describe('PATCH /users/:id contact details', () => {
      const patch = (id: string, change: object) =>
        http()
          .patch(`/api/v1/users/${id}`)
          .set('Cookie', adminCookies)
          .send(change);

      it('lets a user created before them be renamed without adding them', async () => {
        const target = await seedUser(UserRole.CASHIER, branch.id);
        const res = await patch(target.id, { full_name: 'Renamed' }).expect(
          200,
        );
        expect(res.body).toMatchObject({
          full_name: 'Renamed',
          phone: null,
          nic: null,
          address: null,
        });
      });

      it('adds and changes them, normalized', async () => {
        const target = await seedUser(UserRole.CASHIER, branch.id);
        await patch(target.id, {
          phone: '94712345678',
          nic: '921234567v',
          address: ' 7 Hill Street, Kandy ',
        }).expect(200);
        expect(await userRow(target.id)).toMatchObject({
          phone: '0712345678',
          nic: '921234567V',
          address: '7 Hill Street, Kandy',
        });

        const nic = freshNic();
        await patch(target.id, { nic }).expect(200);
        expect((await userRow(target.id)).nic).toBe(nic);
      });

      it('keeps its own NIC on a save that sends it again', async () => {
        const nic = freshNic();
        const target = await seedUser(UserRole.CASHIER, branch.id, { nic });
        await patch(target.id, { nic, full_name: 'Same NIC' }).expect(200);
      });

      it('409 NIC_ALREADY_REGISTERED for an NIC another user holds, changing nothing', async () => {
        const nic = freshNic();
        await seedUser(UserRole.CASHIER, branch.id, { nic });
        const target = await seedUser(UserRole.CASHIER, branch.id, {
          nic: freshNic(),
        });
        const res = await patch(target.id, {
          nic,
          full_name: 'Should Not Stick',
        }).expect(409);
        expect(res.body).toMatchObject({ code: 'NIC_ALREADY_REGISTERED' });
        expect(await userRow(target.id)).toMatchObject({
          nic: target.nic,
          full_name: target.full_name,
        });
      });

      it.each([
        ['a null contact number', { phone: null }],
        ['an empty contact number', { phone: '' }],
        ['a null NIC', { nic: null }],
        ['an empty NIC', { nic: '' }],
        ['a null address', { address: null }],
        ['a blank address', { address: '  ' }],
        ['an invalid NIC', { nic: '12345' }],
      ])('400 for %s: never cleared', async (_, change) => {
        const target = await seedUser(UserRole.CASHIER, branch.id, {
          nic: freshNic(),
          phone: '0771234567',
        });
        await patch(target.id, change).expect(400);
        expect(await userRow(target.id)).toMatchObject({
          nic: target.nic,
          phone: '0771234567',
        });
      });
    });

    describe('GET /users search by contact details', () => {
      it('finds a user by NIC and by contact number typed with +94', async () => {
        const nic = freshNic();
        const target = await seedUser(UserRole.CASHIER, branch.id, {
          nic,
          phone: '0759876543',
        });
        const ids = async (search: string) => {
          const res = await http()
            .get('/api/v1/users')
            .query({ search, limit: 200 })
            .set('Cookie', adminCookies)
            .expect(200);
          return (res.body as { data: User[] }).data.map((u) => u.id);
        };

        expect(await ids(nic.toLowerCase())).toEqual([target.id]);
        expect(await ids('+94 75 987 6543')).toEqual([target.id]);
        expect(await ids('0759876543')).toEqual([target.id]);
      });
    });

    describe('POST /users/:id/deactivate', () => {
      it('deactivates, revokes every session, clears the PIN and audits', async () => {
        const target = await seedUser(UserRole.MANAGER, branch.id);
        await giveApprovalPin(dataSource, target.id);
        const sessions = [await cookiesFor(target), await cookiesFor(target)];

        const res = await http()
          .post(`/api/v1/users/${target.id}/deactivate`)
          .set('Cookie', adminCookies)
          .expect(200);
        expect(res.body).toMatchObject({
          id: target.id,
          is_active: false,
          approval_pin_set_at: null,
        });
        expectNoSecrets(res.body);

        for (const cookies of sessions) {
          const row = await dataSource
            .getRepository(RefreshToken)
            .findOneByOrFail({ token_hash: hash(refreshTokenIn(cookies)) });
          expect(row.revoked_at).toBeInstanceOf(Date);
          // The access token is refused at once too (every request re-reads the user).
          await http()
            .get('/api/v1/auth/me')
            .set('Cookie', cookies)
            .expect(401);
        }
        await refresh(refreshTokenIn(sessions[0])).expect(401);
        await login(target.email).expect(401);

        const stored = await dataSource
          .getRepository(User)
          .createQueryBuilder('u')
          .addSelect('u.approval_pin_hash')
          .where('u.id = :id', { id: target.id })
          .getOneOrFail();
        expect(stored.approval_pin_hash).toBeNull();

        const audits = await auditRows(AuditAction.DEACTIVATE, target.id);
        expect(audits).toHaveLength(1);
        expect(audits[0]).toMatchObject({
          user_id: admin.id,
          changes: { is_active: { old: true, new: false } },
        });
      });

      it('repeating it is a 200 with no second audit row', async () => {
        const target = await seedUser(UserRole.CASHIER, branch.id);
        for (let i = 0; i < 2; i++) {
          await http()
            .post(`/api/v1/users/${target.id}/deactivate`)
            .set('Cookie', adminCookies)
            .expect(200);
        }
        expect(await auditRows(AuditAction.DEACTIVATE, target.id)).toHaveLength(
          1,
        );
      });

      it('deactivates another admin while one remains', async () => {
        const other = await seedUser(UserRole.ADMIN, null);
        await http()
          .post(`/api/v1/users/${other.id}/deactivate`)
          .set('Cookie', adminCookies)
          .expect(200);
        expect((await userRow(other.id)).is_active).toBe(false);
      });

      it('400 CANNOT_DEACTIVATE_SELF for your own account', async () => {
        const res = await http()
          .post(`/api/v1/users/${admin.id}/deactivate`)
          .set('Cookie', adminCookies)
          .expect(400);
        expect(res.body).toMatchObject({ code: 'CANNOT_DEACTIVATE_SELF' });
        expect((await userRow(admin.id)).is_active).toBe(true);
        expect(await auditRows(AuditAction.DEACTIVATE, admin.id)).toHaveLength(
          0,
        );
      });

      it('404 for an unknown or soft-deleted user, 400 for a bad id', async () => {
        const deleted = await seedUser(UserRole.CASHIER, branch.id);
        await dataSource.getRepository(User).softDelete(deleted.id);
        await http()
          .post(`/api/v1/users/${randomUUID()}/deactivate`)
          .set('Cookie', adminCookies)
          .expect(404);
        await http()
          .post(`/api/v1/users/${deleted.id}/deactivate`)
          .set('Cookie', adminCookies)
          .expect(404);
        await http()
          .post('/api/v1/users/not-a-uuid/deactivate')
          .set('Cookie', adminCookies)
          .expect(400);
      });
    });

    describe('POST /users/:id/reactivate', () => {
      it('reactivates with the same role and branch; old sessions stay revoked; audited', async () => {
        const target = await seedUser(UserRole.MANAGER, branch.id);
        const before = await cookiesFor(target);
        await http()
          .post(`/api/v1/users/${target.id}/deactivate`)
          .set('Cookie', adminCookies)
          .expect(200);

        const res = await http()
          .post(`/api/v1/users/${target.id}/reactivate`)
          .set('Cookie', adminCookies)
          .expect(200);
        expect(res.body).toMatchObject({
          id: target.id,
          is_active: true,
          role: UserRole.MANAGER,
          branch_id: branch.id,
          approval_pin_set_at: null,
        });
        expectNoSecrets(res.body);

        await refresh(refreshTokenIn(before)).expect(401);
        await login(target.email).expect(200);

        const audits = await auditRows(AuditAction.REACTIVATE, target.id);
        expect(audits).toHaveLength(1);
        expect(audits[0]).toMatchObject({
          user_id: admin.id,
          changes: { is_active: { old: false, new: true } },
        });
      });

      it('revokes a token left unrevoked while the user was inactive', async () => {
        // What a refresh racing the deactivation could leave behind.
        const target = await seedUser(UserRole.CASHIER, branch.id, {
          active: false,
        });
        const tokens = dataSource.getRepository(RefreshToken);
        const stray = await tokens.save(
          tokens.create({
            user_id: target.id,
            token_hash: hash(randomUUID()),
            expires_at: new Date(Date.now() + 86_400_000),
            revoked_at: null,
            ip_address: null,
            user_agent: null,
          }),
        );

        await http()
          .post(`/api/v1/users/${target.id}/reactivate`)
          .set('Cookie', adminCookies)
          .expect(200);

        expect(
          (await tokens.findOneByOrFail({ id: stray.id })).revoked_at,
        ).toBeInstanceOf(Date);
      });

      it('an already active user is a 200 that changes nothing', async () => {
        const target = await seedUser(UserRole.CASHIER, branch.id);
        const session = await cookiesFor(target);
        await http()
          .post(`/api/v1/users/${target.id}/reactivate`)
          .set('Cookie', adminCookies)
          .expect(200);
        await refresh(refreshTokenIn(session)).expect(200);
        expect(await auditRows(AuditAction.REACTIVATE, target.id)).toHaveLength(
          0,
        );
      });

      it("400 when a staff user's branch is inactive, leaving them inactive", async () => {
        const closed = await seedBranch();
        const target = await seedUser(UserRole.CASHIER, closed.id, {
          active: false,
        });
        await dataSource
          .getRepository(Branch)
          .update(closed.id, { is_active: false });

        await http()
          .post(`/api/v1/users/${target.id}/reactivate`)
          .set('Cookie', adminCookies)
          .expect(400);
        expect((await userRow(target.id)).is_active).toBe(false);
        expect(await auditRows(AuditAction.REACTIVATE, target.id)).toHaveLength(
          0,
        );
      });

      it('404 for an unknown user', async () => {
        await http()
          .post(`/api/v1/users/${randomUUID()}/reactivate`)
          .set('Cookie', adminCookies)
          .expect(404);
      });
    });
  });

  describe('last active admin', () => {
    beforeEach(async () => {
      await truncateAllTables(app);
      await pause(1_100);
    });

    it('is refused when the only other admin is inactive (service, real locks)', async () => {
      const only = await seedUser(UserRole.ADMIN, null);
      // An actor that is no longer an active admin: the case the route can
      // reach only through a race, since the caller is always active.
      const formerAdmin = await seedUser(UserRole.ADMIN, null, {
        active: false,
      });

      await expect(
        app.get(UsersService).deactivate(only.id, formerAdmin),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'LAST_ACTIVE_ADMIN',
        }) as object,
      });
      expect((await userRow(only.id)).is_active).toBe(true);
    });

    it('waits for a concurrent admin deactivation, then refuses the last admin', async () => {
      const a = await seedUser(UserRole.ADMIN, null);
      const b = await seedUser(UserRole.ADMIN, null);

      // Another transaction (as deactivate does) locks the active admins
      // and deactivates A, but has not committed yet.
      const other = dataSource.createQueryRunner();
      await other.connect();
      await other.startTransaction();
      let outcome: unknown;
      try {
        await other.query(
          `SELECT id FROM users WHERE role = 'admin' AND is_active ORDER BY id FOR UPDATE`,
        );
        await other.query(`UPDATE users SET is_active = false WHERE id = $1`, [
          a.id,
        ]);

        // A, still signed in, deactivates B meanwhile: it must wait.
        const pending = app
          .get(UsersService)
          .deactivate(b.id, a)
          .then(
            () => 'deactivated',
            (error: unknown) => error,
          );
        await pause(500);
        await other.commitTransaction();
        outcome = await pending;
      } finally {
        if (other.isTransactionActive) await other.rollbackTransaction();
        await other.release();
      }

      expect(outcome).toMatchObject({
        response: expect.objectContaining({
          code: 'LAST_ACTIVE_ADMIN',
        }) as object,
      });
      expect((await userRow(b.id)).is_active).toBe(true);
    });
  });
});
