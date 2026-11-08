import * as dotenv from 'dotenv';

/** The only database the e2e suite and `migration:run:test` may touch. */
export const TEST_DATABASE = 'socio_lk_pos_test';

/** The only values DB_HOST may have there, compared exactly. */
const LOCAL_DATABASE_HOSTS = ['localhost', '127.0.0.1', '::1'];

/**
 * The fail-closed rules for anything aimed at the test database: its e2e reset
 * truncates every table. dotenv reports a missing or unreadable file instead
 * of throwing, and it never overrides a variable the shell set, so `env` must
 * be the effective values, shell included.
 *
 * DB_PORT isn't checked. Any port can be a local Postgres or a tunnel, so a
 * fixed list would reject valid setups without proving the server is local.
 *
 * The messages name only what is required, never a value found.
 */
export function assertTestDatabaseEnv(
  envFileError: Error | undefined,
  env: { DB_NAME?: string; DB_HOST?: string },
): void {
  if (envFileError) {
    throw new Error(
      'Test database runs require backend/.env.test, but it could not be ' +
        'read. Refusing to start.',
    );
  }
  if (env.DB_NAME !== TEST_DATABASE) {
    throw new Error(
      `Test database runs require DB_NAME=${TEST_DATABASE}, but the ` +
        'effective DB_NAME is missing or different. Check .env.test and any ' +
        'DB_NAME set in the shell. Refusing to start.',
    );
  }
  if (!LOCAL_DATABASE_HOSTS.includes(env.DB_HOST ?? '')) {
    throw new Error(
      `Test database runs require DB_HOST to be one of ` +
        `${LOCAL_DATABASE_HOSTS.join(', ')}, but the effective DB_HOST is ` +
        'missing or different. Check .env.test and any DB_HOST set in the ' +
        'shell. Refusing to start.',
    );
  }
}

/**
 * Loads `envFilePath` into `env`, then applies the rules above. The one entry
 * point for test/load-test-env.ts and database/data-source.ts, each of which
 * calls it before anything can connect. It never reads .env.
 */
export function loadTestEnv(
  envFilePath: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const { error } = dotenv.config({
    path: envFilePath,
    processEnv: env,
    quiet: true,
  });
  assertTestDatabaseEnv(error, env);
}
