import { Prisma } from '@prisma/client';

const MAX_BACKOFF_DELAY_MS: number = 10_000; // Cap backoff at 10 seconds to avoid excessively long waits

export type DBRetryOptions = {
  /** Maximum number of retry attempts (default: 3). */
  maxRetries?: number;
  /** Base delay in milliseconds before the first retry (default: 100). */
  baseDelayMs?: number;
};

/**
 * Prisma error codes that indicate a transient condition the caller can safely
 * retry without changing the query:
 *
 *  P2034 — Deadlock or write-conflict (Postgres 40001/40P01). Caused by
 *          concurrent transactions acquiring locks in different orders.
 *
 *  P2024 — Connection pool timeout. The pool was exhausted; a brief pause
 *          and retry often succeeds once an in-flight query finishes.
 */
const RETRIABLE_CODES = new Set(['P2034', 'P2024']);

function isRetriable(err: unknown): err is Prisma.PrismaClientKnownRequestError {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    RETRIABLE_CODES.has(err.code)
  );
}

/**
 * Wraps an async function and retries it automatically on transient Prisma
 * errors (see RETRIABLE_CODES above).
 *
 * Backoff: `baseDelayMs * 2^attempt * uniform(0.75, 1.25)` — exponential with
 * ±25% jitter so concurrent workers don't all retry at the same instant.
 *
 * All other errors propagate immediately without retry.
 */
export async function retryOnDBError<T>(
  fn: () => Promise<T>,
  opts: DBRetryOptions = {},
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 100 } = opts;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetriable(err) || attempt >= maxRetries) {
        throw err;
      }

      const delay = Math.min(
        baseDelayMs * 2 ** attempt * (0.75 + Math.random() * 0.5),
        MAX_BACKOFF_DELAY_MS
      );
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }
}
