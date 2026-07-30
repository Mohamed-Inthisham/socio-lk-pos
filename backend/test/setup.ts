import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';

/**
 * Boots the full NestJS app for e2e tests, mirroring the essential middleware
 * from main.ts. Skips helmet, CORS, and Swagger — noise for in-process tests.
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();

  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.setGlobalPrefix('api/v1');

  await app.init();
  return app;
}

/**
 * Truncates all data tables between tests. Dynamically discovers tables from
 * TypeORM metadata so new entities are handled automatically — no need to
 * update this file every time we add a table.
 *
 * The `migrations` table is deliberately excluded so migration state is
 * preserved between tests. Fast: single Postgres command with CASCADE.
 */
export async function truncateAllTables(app: INestApplication): Promise<void> {
  const dataSource = app.get(DataSource);

  // Allow any fire-and-forget writes (audit log interceptor) to flush
  // before truncating. Prevents lock races between the async audit INSERT
  // (RowShareLock on audit_logs) and TRUNCATE (AccessExclusiveLock).
  await new Promise((r) => setTimeout(r, 50));

  const tableNames = dataSource.entityMetadatas
    .map((entity) => `"${entity.tableName}"`)
    .join(', ');

  if (!tableNames) return;

  await dataSource.query(
    `TRUNCATE TABLE ${tableNames} RESTART IDENTITY CASCADE`,
  );
}
