import { envSchema } from './env.validation';

export function validateEnv(config: Record<string, unknown>) {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `\n❌ Invalid environment variables:\n${errors}\n\nCheck your .env file.`,
    );
  }

  return result.data;
}
