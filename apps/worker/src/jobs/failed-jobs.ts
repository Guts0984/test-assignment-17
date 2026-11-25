import type { Queue } from 'bullmq';

export interface FailedJob {
  readonly queue: string;
  readonly id: string;
  readonly name: string;
  readonly data: unknown;
  readonly failedReason: string;
  readonly attemptsMade: number;
  readonly failedAt: string | null;
}

/** Jobs that used up their attempts (removeOnFail is false, so they stay until retried). */
export const listFailed = async (queues: readonly Queue[], limit = 100): Promise<FailedJob[]> => {
  const out: FailedJob[] = [];
  for (const q of queues) {
    for (const j of await q.getFailed(0, limit - 1)) {
      out.push({
        queue: q.name,
        id: j.id ?? '',
        name: j.name,
        data: j.data,
        failedReason: j.failedReason,
        attemptsMade: j.attemptsMade,
        failedAt: j.finishedOn ? new Date(j.finishedOn).toISOString() : null,
      });
    }
  }
  return out;
};

/** Manual retry of one failed job. Returns false when the job is gone or not failed. */
export const retryFailed = async (queues: readonly Queue[], queueName: string, jobId: string): Promise<boolean> => {
  const q = queues.find((x) => x.name === queueName);
  const job = q ? await q.getJob(jobId) : undefined;
  if (!job || !(await job.isFailed())) return false;
  await job.retry('failed');
  return true;
};
