import { isIP } from 'net';
import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * Express's `trust proxy` setting: no proxy (`req.ip` is the connected
 * peer), a number of proxy hops, or an allowlist of proxy addresses.
 * `true` (trust every hop) is never produced: it would let a client pick
 * its own `req.ip` by sending `X-Forwarded-For`.
 */
export type TrustProxySetting = false | number | string[];

export const MAX_TRUSTED_HOPS = 5;

/**
 * Shortest CIDR prefix accepted per IP version. Broad ranges can add up to
 * every address (0.0.0.0/1 + 128.0.0.0/1 is all of IPv4); /8 and /32 still
 * fit any VPC or provider range.
 */
export const MIN_CIDR_PREFIX = { 4: 8, 6: 32 } as const;

/**
 * Express's named ranges (proxy-addr), exempt from MIN_CIDR_PREFIX:
 * loopback (127.0.0.0/8, ::1/128), linklocal (169.254.0.0/16, fe80::/10),
 * uniquelocal (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7).
 */
const NAMED_RANGES = new Set(['loopback', 'linklocal', 'uniquelocal']);

type Parsed = { value: TrustProxySetting } | { error: string };

/** Why `entry` isn't an IP, a CIDR range or a named range; null if it is. */
function invalidEntry(entry: string): string | null {
  if (NAMED_RANGES.has(entry)) return null;
  const [address, prefix, ...rest] = entry.split('/');
  const version = isIP(address);
  if (rest.length > 0 || version === 0) {
    return `"${entry}" is not an IP address, CIDR range or one of loopback, linklocal, uniquelocal`;
  }
  if (prefix === undefined) return null;
  const min = MIN_CIDR_PREFIX[version as 4 | 6];
  const max = version === 4 ? 32 : 128;
  const length = Number(prefix);
  if (!/^[1-9]\d*$/.test(prefix) || length < min || length > max) {
    return `"${entry}" needs a prefix length from ${min} to ${max}; broader ranges could add up to trusting every address`;
  }
  return null;
}

/**
 * Parse TRUST_PROXY. Unset or "false": no proxy. A hop count from 1 to
 * MAX_TRUSTED_HOPS. Otherwise a comma-separated allowlist of IPs, CIDR
 * ranges and named ranges. Production must set it explicitly (validateEnv).
 */
export function parseTrustProxy(raw: string | undefined): Parsed {
  if (raw === undefined || raw === 'false') return { value: false };
  if (raw === 'true') {
    return {
      error:
        '"true" would trust a client-sent X-Forwarded-For; use a hop count or a list of proxy addresses',
    };
  }
  if (/^\d+$/.test(raw)) {
    const hops = Number(raw);
    if (!/^[1-9]\d*$/.test(raw) || hops > MAX_TRUSTED_HOPS) {
      return {
        error: `a hop count must be from 1 to ${MAX_TRUSTED_HOPS} (use "false" for no proxy)`,
      };
    }
    return { value: hops };
  }
  const entries = raw.split(',').map((entry) => entry.trim());
  if (entries.some((entry) => entry === '')) {
    return {
      error:
        'must be "false", a hop count, or a comma-separated list of proxy addresses with no empty entries',
    };
  }
  for (const entry of entries) {
    const error = invalidEntry(entry);
    if (error) return { error };
  }
  return { value: entries };
}

/**
 * Apply TRUST_PROXY to the Express instance, so `req.ip` (used by the
 * throttler, the audit log and refresh-token sessions) only follows
 * X-Forwarded-For through trusted proxies. Called from main.ts and the e2e
 * test app alike.
 */
export function applyTrustProxy(
  app: NestExpressApplication,
  setting: TrustProxySetting,
): void {
  app.set('trust proxy', setting);
}
