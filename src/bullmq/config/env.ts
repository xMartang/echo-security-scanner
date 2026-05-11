import { commonEnvSchema, parseEnv } from '@/common/config/env.js';
import { z } from 'zod';

const scannerEnvSchema = commonEnvSchema.extend({
  REDIS_URL: z.string().url('REDIS_URL must be a valid URL'),
  TRIVY_SERVER_URL: z.string().url('TRIVY_SERVER_URL must be a valid URL'),
  SCAN_INTERVAL_MS: z.coerce.number().int().positive().default(900_000),
  // ImageVulnerability rows not confirmed by any scan in this many days are deleted
  // by the weekly hygiene job. Purely operational -- does not affect API responses.
  VULNERABILITY_RETENTION_DAYS: z.coerce.number().int().min(7).positive().default(30),
});

export type ScannerEnv = z.infer<typeof scannerEnvSchema>;
export const env: ScannerEnv = parseEnv(scannerEnvSchema, process.env);
