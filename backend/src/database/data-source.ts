import * as dotenv from 'dotenv';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { envSchema } from '../config/env.validation';
import { loadTestEnv } from '../config/test-database-guard';

// Load the right env file based on NODE_ENV.
// - NODE_ENV=test           → .env.test, refusing anything but the local test
//                             database (migration:run:test). The CLI imports
//                             this file before it connects, so a refusal here
//                             stops the command first.
// - anything else / unset   → .env
if (process.env.NODE_ENV === 'test') {
  loadTestEnv(path.resolve(__dirname, '../../.env.test'));
} else {
  dotenv.config({ path: '.env' });
}

const env = envSchema.parse(process.env);

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: env.DB_HOST,
  port: env.DB_PORT,
  username: env.DB_USERNAME,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,

  synchronize: false,
  logging: ['error', 'warn'],

  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
});
