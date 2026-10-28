import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { User } from '../src/users/entities/user.entity';
import { UserRole } from '../src/users/enums/user-role.enum';
import { LOGIN_THROTTLE_MESSAGE } from '../src/config/throttle';

const LIMIT = 3;

/**
 * The login throttler wired through the real AppModule: LOGIN_THROTTLE_LIMIT
 * read by validateEnv, ThrottlerModule.forRootAsync and the global guard.
 * load-test-env.ts raises the limit for every other e2e spec; this one sets
 * a low limit and restores the value afterwards. ConfigModule.forRoot reads
 * the environment when app.module.ts is first imported, so ./setup (which
 * imports it) is loaded only after the limit is set.
 */
describe('Login throttle (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let previousLimit: string | undefined;
  const password = 'testpass123';

  beforeAll(async () => {
    previousLimit = process.env.LOGIN_THROTTLE_LIMIT;
    process.env.LOGIN_THROTTLE_LIMIT = String(LIMIT);
    const { createTestApp, truncateAllTables } =
      jest.requireActual<typeof import('./setup')>('./setup');
    app = await createTestApp();
    dataSource = app.get(DataSource);
    await truncateAllTables(app);
    const users = dataSource.getRepository(User);
    await users.save(
      users.create({
        email: 'admin@test.com',
        password_hash: await bcrypt.hash(password, 4),
        full_name: 'Test Admin',
        role: UserRole.ADMIN,
        is_active: true,
        branch_id: null,
      }),
    );
  });

  afterAll(async () => {
    await app.close();
    if (previousLimit === undefined) delete process.env.LOGIN_THROTTLE_LIMIT;
    else process.env.LOGIN_THROTTLE_LIMIT = previousLimit;
  });

  const login = (body: object) =>
    request(app.getHttpServer()).post('/api/v1/auth/login').send(body);

  it('refuses the request after the limit with 429 and the login message', async () => {
    await login({ email: 'admin@test.com', password: 'wrong' }).expect(401);
    await login({ email: 'not-an-email', password: 'x' }).expect(400);
    await login({ email: 'admin@test.com', password }).expect(200);

    const refused = await login({ email: 'admin@test.com', password }).expect(
      429,
    );
    expect((refused.body as { message: string }).message).toBe(
      LOGIN_THROTTLE_MESSAGE,
    );
    expect(refused.headers['set-cookie']).toBeUndefined();

    // Other auth routes from the same address are unaffected.
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh/logout')
      .expect(200);
  });
});
