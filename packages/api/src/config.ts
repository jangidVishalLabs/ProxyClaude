import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Typed, validated environment config (plan §0.3 / §11).
 * Fail fast at boot if any required secret is missing or weak.
 */

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be >= 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be >= 32 chars'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  VPS_SSH_PORT: z.coerce.number().int().positive().default(22),
  // Empty string in .env is treated as "not set".
  VPS_HOST: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional()),
  VPS_PROVISIONER_USER: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(1).optional(),
  ),
  VPS_PROVISIONER_KEY_PATH: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(1).optional(),
  ),
});

export type AppConfig = z.infer<typeof envSchema>;

/**
 * Parse a plain env record into validated config.
 * Exported separately so tests can pass a record without touching process.env.
 */
export function parseConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

let cached: AppConfig | undefined;

/** Load .env (once) and return validated config, memoised. */
export function getConfig(): AppConfig {
  if (!cached) {
    loadDotenv();
    cached = parseConfig(process.env);
  }
  return cached;
}
