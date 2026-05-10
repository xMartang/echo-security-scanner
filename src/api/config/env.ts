import { commonEnvSchema, parseEnv } from '@/common/config/env.js';
import { z } from 'zod';

const apiEnvSchema = commonEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3000),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;
export const env: ApiEnv = parseEnv(apiEnvSchema, process.env);
