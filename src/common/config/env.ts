import 'dotenv/config';
import { z } from 'zod';

export const commonEnvSchema = z.object({
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_DIR: z.string().default('./logs/local'),
  SERVICE_NAME: z.string().min(1, 'SERVICE_NAME is required'),
});

export type CommonEnv = z.infer<typeof commonEnvSchema>;

export function parseEnv<T extends z.ZodTypeAny>(schema: T, rawEnv: NodeJS.ProcessEnv): z.infer<T> {
  const result = schema.safeParse(rawEnv);
  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    throw new Error(`Invalid environment variables:\n${JSON.stringify(errors, null, 2)}`);
  }
  // result.data is typed as `any` by zod when T is a generic ZodTypeAny;
  // safe to assert because safeParse(success=true) guarantees the schema matched.
  return result.data as z.infer<T>;
}
