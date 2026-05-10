import { Redis } from 'ioredis';
import { env } from '@/bullmq/config/env.js';

// Single shared ioredis connection for BullMQ.
// maxRetriesPerRequest: null is required by BullMQ -- without it BullMQ throws on reconnect.
// lazyConnect: true prevents ioredis from connecting at module-load time, so importing this
// module in tests (where env.REDIS_URL may not point to a running Redis) doesn't fail.
export const connection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
});
