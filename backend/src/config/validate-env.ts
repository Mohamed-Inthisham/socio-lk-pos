import { envSchema } from './env.validation';

const invalid = (errors: string) =>
  new Error(
    `\n❌ Invalid environment variables:\n${errors}\n\nCheck your .env file.`,
  );

export function validateEnv(config: Record<string, unknown>) {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    throw invalid(errors);
  }

  // Production-only rules live here, not in envSchema, because the
  // migration CLI (database/data-source.ts) parses envSchema too and has no
  // use for cookie or proxy settings.
  if (result.data.NODE_ENV === 'production') {
    const errors: string[] = [];
    if (!result.data.COOKIE_SECURE) {
      errors.push(
        '  - COOKIE_SECURE: must be "true" when NODE_ENV=production, so the ' +
          'auth cookies are only sent over HTTPS',
      );
    }
    // The parsed value can't tell unset from "false"; production must
    // choose, so read the raw variable.
    if (config.TRUST_PROXY === undefined) {
      errors.push(
        '  - TRUST_PROXY: must be set when NODE_ENV=production: "false" if ' +
          "clients reach the backend directly, otherwise the proxies' " +
          'addresses or hop count',
      );
    }
    if (errors.length > 0) throw invalid(errors.join('\n'));
  }

  return result.data;
}
