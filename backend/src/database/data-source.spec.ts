import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';

// DataSource and dotenv are stand-ins: nothing connects, and no env file is
// read. This is what the migration CLI imports, so the guard has to refuse
// while the file loads, before a DataSource exists to initialize.
jest.mock('typeorm', () => ({ DataSource: jest.fn() }));
jest.mock('dotenv', () => ({ config: jest.fn() }));

const mockConfig = dotenv.config as unknown as jest.Mock<
  object,
  [{ path: string }]
>;
const mockDataSource = DataSource as unknown as jest.Mock<void, [object]>;

const VALID_ENV = {
  DB_HOST: 'localhost',
  DB_USERNAME: 'fake-user',
  DB_PASSWORD: 'fake-password',
  DB_NAME: 'socio_lk_pos_test',
  JWT_ACCESS_SECRET: 'fake-secret-of-sixteen',
  JWT_REFRESH_SECRET: 'fake-secret-of-sixteen',
};

describe('data-source', () => {
  const realEnv = process.env;

  const load = (env: Record<string, string | undefined>): void => {
    process.env = env;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./data-source');
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.mockReturnValue({ parsed: {} });
  });

  afterEach(() => {
    process.env = realEnv;
  });

  describe('NODE_ENV=test (migration:run:test)', () => {
    const test = { ...VALID_ENV, NODE_ENV: 'test' };

    it('creates the data source for the test database', () => {
      load(test);

      expect(mockDataSource).toHaveBeenCalledTimes(1);
      expect(mockDataSource.mock.calls[0][0]).toMatchObject({
        database: 'socio_lk_pos_test',
      });
    });

    it('loads only .env.test, by its full path', () => {
      load(test);

      expect(mockConfig).toHaveBeenCalledTimes(1);
      expect(mockConfig.mock.calls[0][0].path).toMatch(
        /backend[\\/]\.env\.test$/,
      );
    });

    it('refuses a missing .env.test before a data source exists', () => {
      mockConfig.mockReturnValue({ parsed: {}, error: new Error('ENOENT') });

      expect(() => load(test)).toThrow(/could not be read/);
      expect(mockDataSource).not.toHaveBeenCalled();
    });

    it('refuses a shell DB_NAME before a data source exists', () => {
      expect(() => load({ ...test, DB_NAME: 'socio_lk_pos_dev' })).toThrow(
        /require DB_NAME=socio_lk_pos_test/,
      );
      expect(mockDataSource).not.toHaveBeenCalled();
    });

    it('refuses a remote DB_HOST before a data source exists', () => {
      expect(() => load({ ...test, DB_HOST: 'db.example.com' })).toThrow(
        /require DB_HOST/,
      );
      expect(mockDataSource).not.toHaveBeenCalled();
    });
  });

  // Unchanged: these commands never reach the guard.
  it.each(['development', 'production', undefined])(
    'with NODE_ENV=%s, loads .env and applies no test rule',
    (NODE_ENV) => {
      load({
        ...VALID_ENV,
        NODE_ENV,
        DB_NAME: 'socio_lk_pos_dev',
        DB_HOST: 'db.example.com',
      });

      expect(mockConfig).toHaveBeenCalledTimes(1);
      expect(mockConfig).toHaveBeenCalledWith({ path: '.env' });
      expect(mockDataSource.mock.calls[0][0]).toMatchObject({
        database: 'socio_lk_pos_dev',
        host: 'db.example.com',
      });
    },
  );
});
