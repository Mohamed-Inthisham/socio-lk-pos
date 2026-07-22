import * as dotenv from 'dotenv';
import * as path from 'path';

// Force NODE_ENV=test and load .env.test regardless of what shell set.
process.env.NODE_ENV = 'test';
dotenv.config({ path: path.resolve(__dirname, '../.env.test') });
