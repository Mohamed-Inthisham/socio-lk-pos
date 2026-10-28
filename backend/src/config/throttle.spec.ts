import { buildThrottlerOptions } from './throttle';
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

describe('validateEnv: LOGIN_THROTTLE_*', () => {
  it('defaults to 20 requests per 900 seconds when unset', () => {
    const env = validateEnv(baseEnv);
    expect(env.LOGIN_THROTTLE_LIMIT).toBe(20);
    expect(env.LOGIN_THROTTLE_TTL_SECONDS).toBe(900);
  });

  it('keeps the defaults in production', () => {
    const env = validateEnv({
      ...baseEnv,
      NODE_ENV: 'production',
      COOKIE_SECURE: 'true',
      TRUST_PROXY: 'false',
    });
    expect(env.LOGIN_THROTTLE_LIMIT).toBe(20);
    expect(env.LOGIN_THROTTLE_TTL_SECONDS).toBe(900);
  });

  it.each([
    ['1', 1],
    ['5', 5],
    ['1000', 1000],
  ])('accepts LOGIN_THROTTLE_LIMIT=%s', (value, limit) => {
    expect(
      validateEnv({ ...baseEnv, LOGIN_THROTTLE_LIMIT: value })
        .LOGIN_THROTTLE_LIMIT,
    ).toBe(limit);
  });

  it.each([
    ['1', 1],
    ['60', 60],
    ['86400', 86_400],
  ])('accepts LOGIN_THROTTLE_TTL_SECONDS=%s', (value, seconds) => {
    expect(
      validateEnv({ ...baseEnv, LOGIN_THROTTLE_TTL_SECONDS: value })
        .LOGIN_THROTTLE_TTL_SECONDS,
    ).toBe(seconds);
  });

  it.each([
    '0',
    '00',
    '01',
    '-1',
    '1.5',
    '1e2',
    '',
    ' 20',
    '20 ',
    'abc',
    '1001',
  ])('rejects LOGIN_THROTTLE_LIMIT=%j', (value) => {
    expect(() =>
      validateEnv({ ...baseEnv, LOGIN_THROTTLE_LIMIT: value }),
    ).toThrow(/LOGIN_THROTTLE_LIMIT: must be a whole number from 1 to 1000/);
  });

  it.each(['0', '-60', '1.5', '', ' 900', 'abc', '86401'])(
    'rejects LOGIN_THROTTLE_TTL_SECONDS=%j',
    (value) => {
      expect(() =>
        validateEnv({ ...baseEnv, LOGIN_THROTTLE_TTL_SECONDS: value }),
      ).toThrow(
        /LOGIN_THROTTLE_TTL_SECONDS: must be a whole number from 1 to 86400/,
      );
    },
  );
});

describe('buildThrottlerOptions', () => {
  const options = buildThrottlerOptions({ limit: 20, ttlSeconds: 900 });
  const throttlers = Array.isArray(options) ? options : options.throttlers;
  const named = (name: string) => throttlers.find((t) => t.name === name);

  it('keeps the global short and long limits unchanged', () => {
    expect(named('short')).toEqual({ name: 'short', ttl: 1000, limit: 10 });
    expect(named('long')).toEqual({ name: 'long', ttl: 60_000, limit: 100 });
  });

  it('adds the login throttler, with the window in milliseconds', () => {
    expect(named('login')).toMatchObject({
      name: 'login',
      ttl: 900_000,
      limit: 20,
    });
    expect(throttlers).toHaveLength(3);
  });
});
