import 'dotenv/config';
import { DataSource } from 'typeorm';
import { envSchema } from '../config/env.validation';

// Validate env vars at CLI time (so migrations fail fast on bad config)
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
