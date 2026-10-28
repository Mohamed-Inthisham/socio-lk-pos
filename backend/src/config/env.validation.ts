import { z } from 'zod';
import { parseTrustProxy } from './trust-proxy';

export const envSchema = z.object({
  // Application
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().default(3000),

  // Database
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().default(5432),
  DB_USERNAME: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_NAME: z.string().min(1),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),

  // Cookies
  COOKIE_DOMAIN: z.string().min(1).default('localhost'),
  // Exactly "true" or "false": a typo must fail, not silently mean false.
  // Must be "true" in production (enforced in validateEnv).
  COOKIE_SECURE: z
    .enum(['true', 'false'], { message: 'must be "true" or "false"' })
    .default('false')
    .transform((v) => v === 'true'),

  // Proxies whose X-Forwarded-For Express may believe (see trust-proxy.ts).
  // Unset: none, so req.ip is the connected peer.
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((raw, ctx) => {
      const parsed = parseTrustProxy(raw);
      if ('error' in parsed) {
        ctx.addIssue({ code: 'custom', message: parsed.error });
        return z.NEVER;
      }
      return parsed.value;
    }),
});

export type Env = z.infer<typeof envSchema>;
