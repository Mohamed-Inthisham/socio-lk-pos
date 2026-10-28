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
  // use for cookie settings.
  if (result.data.NODE_ENV === 'production' && !result.data.COOKIE_SECURE) {
    throw invalid(
      '  - COOKIE_SECURE: must be "true" when NODE_ENV=production, so the ' +
        'auth cookies are only sent over HTTPS',
    );
  }

  return result.data;
}
