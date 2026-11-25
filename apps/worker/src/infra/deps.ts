import { Queue, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { CHANNEL_INBOUND_QUEUE, CHANNEL_PUSH_QUEUE, EMAIL_QUEUE, HOLD_EXPIRY_QUEUE, NIGHT_AUDIT_QUEUE } from '@hotel/shared';
import type { Db } from '@hotel/db';
import type { Env } from '../config/env';

export const DEPS = Symbol('WORKER_DEPS');

export interface Queues {
  readonly holdExpiry: Queue;
  readonly nightAudit: Queue;
  readonly channelPush: Queue;
  readonly email: Queue;
  readonly channelInbound: Queue;
}

/** Everything a job needs. `now` is the injected clock. */
export interface WorkerDeps {
  readonly env: Env;
  readonly db: Db;
  readonly now: () => Date;
  readonly connection: Redis;
  readonly queues: Queues;
}

export const createConnection = (url: string): Redis => {
  const client = new Redis(url, { maxRetriesPerRequest: null });
  client.on('error', () => undefined);
  return client;
};

export const createQueues = (connection: Redis): Queues => ({
  holdExpiry: new Queue(HOLD_EXPIRY_QUEUE, { connection }),
  nightAudit: new Queue(NIGHT_AUDIT_QUEUE, { connection }),
  channelPush: new Queue(CHANNEL_PUSH_QUEUE, { connection }),
  email: new Queue(EMAIL_QUEUE, { connection }),
  channelInbound: new Queue(CHANNEL_INBOUND_QUEUE, { connection }),
});

/** Same options the api uses: retries with exponential backoff, failed jobs stay visible. */
export const jobOptions = (env: Pick<Env, 'JOB_ATTEMPTS'>, jobId: string, delay = 0): JobsOptions => ({
  jobId,
  delay,
  attempts: env.JOB_ATTEMPTS,
  backoff: { type: 'exponential', delay: 500 },
  removeOnComplete: true,
  removeOnFail: false,
});
