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
 * Truncates all data tables between tests. Fast: uses TRUNCATE ... RESTART
 * IDENTITY CASCADE, which is a single Postgres command.
 * Keeps schema, drops rows.
 */
export async function truncateAllTables(app: INestApplication): Promise<void> {
  const dataSource = app.get(DataSource);
  await dataSource.query(
    'TRUNCATE TABLE "audit_logs", "refresh_tokens", "users" RESTART IDENTITY CASCADE',
  );
}
