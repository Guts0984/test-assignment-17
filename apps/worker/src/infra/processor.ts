import { Logger } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import type { WorkerDeps } from './deps';

/** Starts a BullMQ worker. The Nest classes using it only forward to plain handler functions. */
export const startProcessor = (
  queue: string,
  deps: WorkerDeps,
  handler: (job: Job, token?: string) => Promise<void>,
): Worker => {
  const log = new Logger(`worker:${queue}`);
  // A job of a killed worker is taken over once its lock has run out and the stalled check has run:
  // with the BullMQ defaults (30 s + 30 s) that took about a minute, here it is about 10 s + 5 s.
  const worker = new Worker(queue, handler, {
    connection: deps.connection,
    concurrency: deps.env.WORKER_CONCURRENCY,
    lockDuration: deps.env.WORKER_LOCK_MS,
    stalledInterval: Math.max(1000, Math.floor(deps.env.WORKER_LOCK_MS / 2)),
  });
  worker.on('failed', (job, error) => log.warn(`job ${job?.id ?? '?'} failed (attempt ${job?.attemptsMade ?? 0}): ${error.message}`));
  worker.on('error', (error) => log.error(error.message));
  return worker;
};
