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

const trustProxy = (value?: string) =>
  validateEnv(
    value === undefined ? baseEnv : { ...baseEnv, TRUST_PROXY: value },
  ).TRUST_PROXY;

describe('validateEnv: TRUST_PROXY', () => {
  it('trusts no proxy when unset', () => {
    expect(trustProxy()).toBe(false);
  });

  it('trusts no proxy for "false"', () => {
    expect(trustProxy('false')).toBe(false);
  });

  it.each([
    ['1', 1],
    ['2', 2],
    ['5', 5],
  ])('accepts the hop count %s', (value, hops) => {
    expect(trustProxy(value)).toBe(hops);
  });

  it.each([
    ['127.0.0.1', ['127.0.0.1']],
    ['::1', ['::1']],
    ['10.0.0.0/8', ['10.0.0.0/8']],
    ['2001:db8::/32', ['2001:db8::/32']],
    ['loopback', ['loopback']],
    ['10.0.0.0/16, 10.1.0.0/16', ['10.0.0.0/16', '10.1.0.0/16']],
    [
      'loopback,linklocal,uniquelocal',
      ['loopback', 'linklocal', 'uniquelocal'],
    ],
  ])('accepts the allowlist %j', (value, list) => {
    expect(trustProxy(value)).toEqual(list);
  });

  it('rejects "true", which would trust a client-sent X-Forwarded-For', () => {
    expect(() => trustProxy('true')).toThrow(
      /TRUST_PROXY: "true" would trust a client-sent X-Forwarded-For/,
    );
  });

  it.each(['0', '00', '01', '6', '100', '-1', '1.5'])(
    'rejects the hop count %j',
    (value) => {
      expect(() => trustProxy(value)).toThrow(/TRUST_PROXY: /);
    },
  );

  it.each(['0', '01', '6'])('explains the hop range for %j', (value) => {
    expect(() => trustProxy(value)).toThrow(/a hop count must be from 1 to 5/);
  });

  it.each([
    'TRUE',
    'yes',
    '',
    ' ',
    'nope',
    '10.0.0',
    '256.0.0.1',
    '10.0.0.0/33',
    '10.0.0.0/0',
    '0.0.0.0/0',
    '::/0',
    '10.0.0.0/08',
    '10.0.0.0/255.0.0.0',
    '10.0.0.0/8/8',
    'LOOPBACK',
    '10.0.0.1,',
    ',10.0.0.1',
    '10.0.0.1,,10.0.0.2',
    '10.0.0.1, nope',
  ])('rejects %j', (value) => {
    expect(() => trustProxy(value)).toThrow(/TRUST_PROXY: /);
  });

  it('rejects a /0 range, which would trust every address', () => {
    expect(() => trustProxy('0.0.0.0/0')).toThrow(
      /could add up to trusting every address/,
    );
  });

  describe('minimum CIDR prefix (/8 IPv4, /32 IPv6)', () => {
    it.each([
      '10.0.0.0/7',
      '0.0.0.0/1',
      '128.0.0.0/1',
      '0.0.0.0/1,128.0.0.0/1',
      '::/1',
      '::/1,8000::/1',
      '2001:db8::/31',
      '10.0.0.0/16, 0.0.0.0/4',
    ])('rejects the broad range %j', (value) => {
      expect(() => trustProxy(value)).toThrow(
        /needs a prefix length from (8 to 32|32 to 128); broader ranges could add up to trusting every address/,
      );
    });

    it.each([
      ['10.0.0.0/8', ['10.0.0.0/8']],
      ['172.31.0.0/16', ['172.31.0.0/16']],
      ['10.0.1.0/24, 10.0.2.0/24', ['10.0.1.0/24', '10.0.2.0/24']],
      ['10.0.0.5/32', ['10.0.0.5/32']],
      ['2600:1f18::/32', ['2600:1f18::/32']],
      ['2600:1f18:1234::/56', ['2600:1f18:1234::/56']],
      ['2001:db8::1/128', ['2001:db8::1/128']],
    ])('accepts the VPC-sized range %j', (value, list) => {
      expect(trustProxy(value)).toEqual(list);
    });

    it('still accepts the named ranges, which are exempt', () => {
      expect(trustProxy('uniquelocal')).toEqual(['uniquelocal']);
    });
  });

  describe('in production', () => {
    const production = {
      ...baseEnv,
      NODE_ENV: 'production',
      COOKIE_SECURE: 'true',
    };

    it('rejects TRUST_PROXY missing', () => {
      expect(() => validateEnv(production)).toThrow(
        /TRUST_PROXY: must be set when NODE_ENV=production/,
      );
    });

    it('accepts an explicit "false" (clients reach the backend directly)', () => {
      expect(
        validateEnv({ ...production, TRUST_PROXY: 'false' }).TRUST_PROXY,
      ).toBe(false);
    });

    it.each([
      ['1', 1],
      ['10.0.0.0/16', ['10.0.0.0/16']],
    ])('accepts the explicit setting %j', (value, setting) => {
      expect(
        validateEnv({ ...production, TRUST_PROXY: value }).TRUST_PROXY,
      ).toEqual(setting);
    });

    it('still rejects an invalid explicit value', () => {
      expect(() => validateEnv({ ...production, TRUST_PROXY: 'true' })).toThrow(
        /TRUST_PROXY: "true" would trust/,
      );
    });

    it('reports a missing TRUST_PROXY and COOKIE_SECURE together', () => {
      const { COOKIE_SECURE: _, ...withoutCookie } = production;
      expect(() => validateEnv(withoutCookie)).toThrow(
        /COOKIE_SECURE: must be "true"[\s\S]*TRUST_PROXY: must be set/,
      );
    });
  });

  it.each(['development', 'test'])(
    'defaults to no proxy when unset in %s',
    (nodeEnv) => {
      expect(validateEnv({ ...baseEnv, NODE_ENV: nodeEnv }).TRUST_PROXY).toBe(
        false,
      );
    },
  );
});
