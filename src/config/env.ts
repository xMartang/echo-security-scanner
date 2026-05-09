import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),
  REDIS_URL: z.string().url('REDIS_URL must be a valid URL'),
  TRIVY_SERVER_URL: z.string().url('TRIVY_SERVER_URL must be a valid URL'),
  SCAN_INTERVAL_MS: z.coerce.number().int().positive().default(900_000),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  LOG_DIR: z.string().default('./logs/local'),
  SERVICE_NAME: z.string().min(1, 'SERVICE_NAME is required'),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(rawEnv: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(rawEnv);
  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    throw new Error(
      `Invalid environment variables:\n${JSON.stringify(errors, null, 2)}`,
    );
  }
  return result.data;
}

// Singleton — parsed once at startup; fails fast if any required vars are missing.
export const env: Env = parseEnv(process.env);
