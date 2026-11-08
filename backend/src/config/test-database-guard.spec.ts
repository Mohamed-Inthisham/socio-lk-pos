import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  assertTestDatabaseEnv,
  loadTestEnv,
  TEST_DATABASE,
} from './test-database-guard';

const LOCAL = { DB_NAME: TEST_DATABASE, DB_HOST: 'localhost' };

describe('assertTestDatabaseEnv', () => {
  it('expects exactly socio_lk_pos_test', () => {
    expect(TEST_DATABASE).toBe('socio_lk_pos_test');
  });

  it.each(['localhost', '127.0.0.1', '::1'])('accepts host %s', (DB_HOST) => {
    expect(() =>
      assertTestDatabaseEnv(undefined, { ...LOCAL, DB_HOST }),
    ).not.toThrow();
  });

  it('refuses a missing or unreadable .env.test, even with the right values', () => {
    expect(() => assertTestDatabaseEnv(new Error('ENOENT'), LOCAL)).toThrow(
      /\.env\.test, but it could not be read/,
    );
  });

  it.each([
    ['the development database', 'socio_lk_pos_dev'],
    ['no value', undefined],
    ['an empty value', ''],
    ['another case', 'SOCIO_LK_POS_TEST'],
    ['surrounding spaces', ' socio_lk_pos_test '],
    ['a longer name', 'socio_lk_pos_test_copy'],
  ])('refuses %s as the database', (_, DB_NAME) => {
    expect(() =>
      assertTestDatabaseEnv(undefined, { ...LOCAL, DB_NAME }),
    ).toThrow(/require DB_NAME=socio_lk_pos_test/);
  });

  it.each([
    ['no value', undefined],
    ['an empty value', ''],
    ['a remote name', 'db.example.com'],
    ['a remote address', '10.0.0.5'],
    ['a name starting with localhost', 'localhost.example.com'],
    ['another loopback spelling', '127.0.0.2'],
    ['another case', 'LOCALHOST'],
    ['surrounding spaces', ' localhost '],
    ['brackets', '[::1]'],
  ])('refuses %s as the host', (_, DB_HOST) => {
    expect(() =>
      assertTestDatabaseEnv(undefined, { ...LOCAL, DB_HOST }),
    ).toThrow(/require DB_HOST to be one of localhost, 127\.0\.0\.1, ::1/);
  });

  it('prints neither a value found nor the file error', () => {
    const message = (run: () => void): string => {
      try {
        run();
      } catch (err) {
        return (err as Error).message;
      }
      return '';
    };

    expect(
      message(() =>
        assertTestDatabaseEnv(undefined, { ...LOCAL, DB_NAME: 'private_db' }),
      ),
    ).not.toContain('private_db');
    expect(
      message(() =>
        assertTestDatabaseEnv(undefined, {
          ...LOCAL,
          DB_HOST: 'private.host',
        }),
      ),
    ).not.toContain('private.host');
    expect(
      message(() => assertTestDatabaseEnv(new Error('secret-path'), LOCAL)),
    ).not.toContain('secret-path');
  });
});

// Real dotenv, a throwaway file and a stand-in for process.env: the real
// environment and the real .env.test are never read or changed.
describe('loadTestEnv', () => {
  let dir: string;

  const envFile = (...lines: string[]): string => {
    const file = path.join(dir, '.env.test');
    fs.writeFileSync(file, lines.join('\n'));
    return file;
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-db-guard-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('loads the file into the given environment', () => {
    const env: NodeJS.ProcessEnv = {};

    loadTestEnv(envFile(`DB_NAME=${TEST_DATABASE}`, 'DB_HOST=127.0.0.1'), env);

    expect(env.DB_NAME).toBe(TEST_DATABASE);
    expect(env.DB_HOST).toBe('127.0.0.1');
  });

  it('refuses a missing file, even when the shell has the right values', () => {
    expect(() =>
      loadTestEnv(path.join(dir, 'missing.env'), { ...LOCAL }),
    ).toThrow(/could not be read/);
  });

  it('never falls back to a .env beside the file', () => {
    fs.writeFileSync(
      path.join(dir, '.env'),
      `DB_NAME=${TEST_DATABASE}\nDB_HOST=localhost\n`,
    );

    expect(() => loadTestEnv(path.join(dir, '.env.test'), {})).toThrow(
      /could not be read/,
    );
  });

  it('refuses a file with no DB_NAME or no DB_HOST', () => {
    expect(() => loadTestEnv(envFile('DB_HOST=localhost'), {})).toThrow(
      /DB_NAME/,
    );
    expect(() => loadTestEnv(envFile(`DB_NAME=${TEST_DATABASE}`), {})).toThrow(
      /DB_HOST/,
    );
  });

  it('refuses a shell DB_NAME over a correct file', () => {
    const file = envFile(`DB_NAME=${TEST_DATABASE}`, 'DB_HOST=localhost');

    expect(() => loadTestEnv(file, { DB_NAME: 'socio_lk_pos_dev' })).toThrow(
      /DB_NAME/,
    );
  });

  it('refuses a shell DB_HOST over a correct file', () => {
    const file = envFile(`DB_NAME=${TEST_DATABASE}`, 'DB_HOST=localhost');

    expect(() => loadTestEnv(file, { DB_HOST: 'db.example.com' })).toThrow(
      /DB_HOST/,
    );
  });

  it('refuses an empty shell DB_NAME, which dotenv does not replace', () => {
    const file = envFile(`DB_NAME=${TEST_DATABASE}`, 'DB_HOST=localhost');

    expect(() => loadTestEnv(file, { DB_NAME: '' })).toThrow(/DB_NAME/);
  });

  it('accepts a shell override that is itself valid', () => {
    const file = envFile('DB_NAME=something_else', 'DB_HOST=db.example.com');

    expect(() => loadTestEnv(file, { ...LOCAL })).not.toThrow();
  });
});
