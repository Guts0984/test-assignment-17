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
  const worker = new Worker(queue, handler, { connection: deps.connection, concurrency: deps.env.WORKER_CONCURRENCY });
  worker.on('failed', (job, error) => log.warn(`job ${job?.id ?? '?'} failed (attempt ${job?.attemptsMade ?? 0}): ${error.message}`));
  worker.on('error', (error) => log.error(error.message));
  return worker;
};
