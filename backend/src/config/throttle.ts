import { ExecutionContext, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerModuleOptions, throttlerMessage } from '@nestjs/throttler';

export const LOGIN_THROTTLE_MESSAGE =
  'Too many login attempts. Please wait a few minutes and try again.';

const LOGIN_THROTTLE = 'login-throttle';
const reflector = new Reflector();

/** Marks the one handler the `login` throttler applies to. */
export const LoginThrottle = () => SetMetadata(LOGIN_THROTTLE, true);

const isLoginRoute = (context: ExecutionContext): boolean =>
  reflector.get<boolean | undefined>(LOGIN_THROTTLE, context.getHandler()) ===
  true;

export interface LoginThrottleSettings {
  /** Login requests allowed per client IP per window. */
  limit: number;
  /** Window length; a blocked IP also waits this long. */
  ttlSeconds: number;
}

/**
 * The global throttler setup (ThrottlerModule in app.module.ts, and the
 * tests that need the same behaviour).
 *
 * `short` and `long` apply to every route. `login` applies only to the
 * handler marked @LoginThrottle(), on top of them. The default tracker and
 * key are kept: counts are per route handler and per trusted `req.ip`
 * (TRUST_PROXY), stored in memory in each process.
 */
export function buildThrottlerOptions(
  login: LoginThrottleSettings,
): ThrottlerModuleOptions {
  return {
    throttlers: [
      {
        name: 'short',
        ttl: 1000, // 1 second
        limit: 10, // max 10 requests per second
      },
      {
        name: 'long',
        ttl: 60_000, // 1 minute
        limit: 100, // max 100 requests per minute
      },
      {
        name: 'login',
        ttl: login.ttlSeconds * 1000,
        limit: login.limit,
        skipIf: (context) => !isLoginRoute(context),
      },
    ],
    errorMessage: (context) =>
      isLoginRoute(context) ? LOGIN_THROTTLE_MESSAGE : throttlerMessage,
  };
}
