/**
 * Constants shared across both services (api and bullmq).
 *
 * Add here only when a value is genuinely used by both microservices. Most
 * constants belong in a service-local or module-local consts.ts instead.
 */

/**
 * Pause inserted before exit() so pino's async log transport finishes flushing
 * the last few records to disk. Both services use this in their shutdown path.
 */
export const FLUSH_WAIT_MS = 200;
