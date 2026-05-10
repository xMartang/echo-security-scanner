import pino from 'pino';
import { fileURLToPath } from 'node:url';

const transportPath = fileURLToPath(
  new URL('./log-transport.mjs', import.meta.url),
);

export type LoggerOptions = {
  serviceName: string;
  dir: string;
  level?: string;
};

/**
 * Creates a pino logger with two transport targets:
 *  1. stdout  -- for `docker logs` / dev console output
 *  2. file    -- routed by level into ${serviceName}.{debug,info,error}.log
 *               via log-transport.mjs (pino-roll, daily + 50 MB rotation)
 */
export function createLogger(opts: LoggerOptions): pino.Logger {
  return pino({
    level: opts.level ?? 'info',
    // Emit time as ISO-8601 string ("2026-05-10T12:00:00.000Z") instead of
    // epoch milliseconds so log files are human-readable without a converter.
    timestamp: pino.stdTimeFunctions.isoTime,
    base: { service: opts.serviceName },
    redact: ['req.headers.authorization', 'DATABASE_URL', 'REDIS_URL'],
    transport: {
      targets: [
        // stdout -- always present so `docker logs` works
        { target: 'pino/file', options: { destination: 1 }, level: opts.level ?? 'info' },
        // per-level rotating files
        {
          target: transportPath,
          options: { dir: opts.dir, serviceName: opts.serviceName },
          level: opts.level ?? 'info',
        },
      ],
    },
  });
}
