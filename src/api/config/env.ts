import { commonEnvSchema, parseEnv } from '@/common/config/env.js';
import { z } from 'zod';

const apiEnvSchema = commonEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3000),
  // How old the most-recent scan can be before /health reports the scanner as stale.
  // Default: 1 800 000 ms = 30 min = 2x the default 15-min scan interval.
  SCANNER_STALENESS_THRESHOLD_MS: z.coerce.number().int().positive().default(1_800_000),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;
export const env: ApiEnv = parseEnv(apiEnvSchema, process.env);
