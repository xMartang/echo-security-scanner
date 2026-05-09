import { Prisma } from '@prisma/client';

export type DeadlockRetryOptions = {
  /** Maximum number of retry attempts (default: 3). */
  maxRetries?: number;
  /** Base delay in milliseconds before the first retry (default: 100). */
  baseDelayMs?: number;
};

/**
 * Wraps an async function and retries it automatically when Postgres reports a
 * deadlock or serialisation failure (Prisma error code P2034).
 *
 * Backoff: `baseDelayMs * 2^attempt * uniform(0.75, 1.25)` — exponential with
 * ±25% jitter so concurrent workers don't all retry at the same instant.
 *
 * All other errors propagate immediately without retry.
 */
export async function withDeadlockRetry<T>(
  fn: () => Promise<T>,
  opts: DeadlockRetryOptions = {},
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 100 } = opts;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isDeadlock =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034';

      if (!isDeadlock || attempt >= maxRetries) {
        throw err;
      }

      const delay = baseDelayMs * 2 ** attempt * (0.75 + Math.random() * 0.5);
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }
}
