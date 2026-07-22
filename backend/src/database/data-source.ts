import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { envSchema } from '../config/env.validation';

// Load the right env file based on NODE_ENV.
// - NODE_ENV=test           → .env.test
// - anything else / unset   → .env
const envFile = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
dotenv.config({ path: envFile });

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
