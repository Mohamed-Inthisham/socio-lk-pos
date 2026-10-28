import { validateEnv } from './validate-env';

/** The smallest environment the schema accepts, before the case's own values. */
const baseEnv = {
  DB_HOST: 'localhost',
  DB_USERNAME: 'postgres',
  DB_PASSWORD: 'postgres',
  DB_NAME: 'socio_lk_pos_test',
  JWT_ACCESS_SECRET: 'test-only-access-secret',
  JWT_REFRESH_SECRET: 'test-only-refresh-secret',
};

const env = (overrides: Record<string, string>) => ({
  ...baseEnv,
  ...overrides,
});

describe('validateEnv: COOKIE_SECURE', () => {
  describe('in production', () => {
    // TRUST_PROXY is required in production too; set it so only
    // COOKIE_SECURE decides these cases.
    const production = { NODE_ENV: 'production', TRUST_PROXY: 'false' };

    it('rejects COOKIE_SECURE=false', () => {
      expect(() =>
        validateEnv(env({ ...production, COOKIE_SECURE: 'false' })),
      ).toThrow(/COOKIE_SECURE: must be "true" when NODE_ENV=production/);
    });

    it('rejects COOKIE_SECURE unset', () => {
      expect(() => validateEnv(env(production))).toThrow(
        /COOKIE_SECURE: must be "true" when NODE_ENV=production/,
      );
    });

    it('accepts COOKIE_SECURE=true', () => {
      const result = validateEnv(env({ ...production, COOKIE_SECURE: 'true' }));
      expect(result.NODE_ENV).toBe('production');
      expect(result.COOKIE_SECURE).toBe(true);
    });
  });

  describe.each(['development', 'test'])('in %s', (nodeEnv) => {
    it('accepts COOKIE_SECURE=false', () => {
      expect(
        validateEnv(env({ NODE_ENV: nodeEnv, COOKIE_SECURE: 'false' }))
          .COOKIE_SECURE,
      ).toBe(false);
    });

    it('defaults COOKIE_SECURE to false when unset', () => {
      expect(validateEnv(env({ NODE_ENV: nodeEnv })).COOKIE_SECURE).toBe(false);
    });

    it('accepts COOKIE_SECURE=true', () => {
      expect(
        validateEnv(env({ NODE_ENV: nodeEnv, COOKIE_SECURE: 'true' }))
          .COOKIE_SECURE,
      ).toBe(true);
    });
  });

  it('keeps NODE_ENV defaulting to development, where false is accepted', () => {
    const result = validateEnv(env({ COOKIE_SECURE: 'false' }));
    expect(result.NODE_ENV).toBe('development');
    expect(result.COOKIE_SECURE).toBe(false);
  });

  describe.each(['production', 'development', 'test'])(
    'rejects an invalid value in %s',
    (nodeEnv) => {
      it.each(['TRUE', 'False', '1', '0', 'yes', ' true', 'true ', ''])(
        'COOKIE_SECURE=%j',
        (value) => {
          expect(() =>
            validateEnv(env({ NODE_ENV: nodeEnv, COOKIE_SECURE: value })),
          ).toThrow(/COOKIE_SECURE: must be "true" or "false"/);
        },
      );
    },
  );
});
