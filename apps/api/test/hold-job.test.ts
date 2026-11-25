import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { HOLD_EXPIRY_QUEUE } from '@hotel/shared';
import { addDays } from '@hotel/shared';
import { bookStay, createFixture, startApp, TEST_TODAY, type TestApp } from './helpers';

let app: TestApp;
let redis: Redis;
let queue: Queue;

beforeAll(async () => {
  app = await startApp();
  redis = new Redis(app.env.REDIS_URL, { maxRetriesPerRequest: null });
  queue = new Queue(HOLD_EXPIRY_QUEUE, { connection: redis });
});
afterAll(async () => {
  await queue.close();
  redis.disconnect();
  await app.close();
});

describe('hold expiry job', () => {
  it('a new hold queues its own expiry job, due exactly when the hold ends', async () => {
    const f = await createFixture(app.db, { rooms: 1 });
    const r = await bookStay(app, f, addDays(TEST_TODAY, 3), addDays(TEST_TODAY, 4), { confirm: false });
    expect(r.booked).not.toBeNull();
    const job = await queue.getJob(`expire-${r.booked?.id}`);
    expect(job?.data).toEqual({ bookingId: r.booked?.id });
    expect(job?.opts.delay).toBeGreaterThan(9 * 60_000);
    expect(job?.opts.delay).toBeLessThanOrEqual(10 * 60_000);
    await job?.remove();
  });
});
