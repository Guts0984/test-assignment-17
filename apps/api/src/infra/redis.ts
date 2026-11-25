import { Redis } from 'ioredis';

/** Fails fast when Redis is down, so limiters can fall back instead of hanging. */
export const createLimiterRedis = (url: string): Redis => {
  const client = new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false, retryStrategy: (n) => Math.min(n * 200, 2000), lazyConnect: false });
  client.on('error', () => undefined);
  return client;
};

/** BullMQ needs blocking-friendly settings. */
export const createQueueRedis = (url: string): Redis => {
  const client = new Redis(url, { maxRetriesPerRequest: null });
  client.on('error', () => undefined);
  return client;
};
