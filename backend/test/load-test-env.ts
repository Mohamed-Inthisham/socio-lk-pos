import * as path from 'path';
import { loadTestEnv } from '../src/config/test-database-guard';

// Force NODE_ENV=test and load .env.test regardless of what shell set.
process.env.NODE_ENV = 'test';

// Before any spec boots the app: the e2e reset truncates every table.
loadTestEnv(path.resolve(__dirname, '../.env.test'));

// e2e specs log in far more often than the production login limit allows
// (sales alone ~155 times; each spec gets a fresh in-memory count). Raise
// it for e2e runs only, unless the shell or .env.test already sets it.
// login-throttle.e2e-spec.ts sets its own low limit.
process.env.LOGIN_THROTTLE_LIMIT ??= '1000';
