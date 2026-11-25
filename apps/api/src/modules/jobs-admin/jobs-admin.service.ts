import { HttpException, Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { domainError, ERROR_STATUS, QUEUE_NAMES } from '@hotel/shared';
import type { StaffIdentity } from '../../common/auth/access';
import { createQueueRedis } from '../../infra/redis';
import { ENV, type EnvValue } from '../../infra/tokens';
import { requireChainAdmin } from '../admin/admin.service';

const reject = (code: 'NOT_FOUND' | 'INVALID_STATUS', message: string): HttpException => new HttpException(domainError(code, message), ERROR_STATUS[code]);

@Injectable()
export class JobsAdminService implements OnModuleDestroy {
  private readonly queues: ReadonlyMap<string, Queue>;

  constructor(@Inject(ENV) env: EnvValue) {
    const connection = createQueueRedis(env.REDIS_URL);
    this.queues = new Map(QUEUE_NAMES.map((name) => [name, new Queue(name, { connection })]));
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }

  async failed(staff: StaffIdentity) {
    requireChainAdmin(staff);
    const lists = await Promise.all([...this.queues].map(async ([queue, q]) => (await q.getFailed(0, 99)).map((j) => ({ queue, job: j }))));
    return {
      jobs: lists.flat().map(({ queue, job }) => ({
        queue, id: String(job.id), name: job.name, failedReason: job.failedReason ?? '', attemptsMade: job.attemptsMade, data: job.data as unknown,
        failedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
      })),
    };
  }

  async retry(staff: StaffIdentity, queue: string, jobId: string) {
    requireChainAdmin(staff);
    const q = this.queues.get(queue);
    if (!q) throw reject('NOT_FOUND', 'Unknown queue');
    const job = await q.getJob(jobId);
    if (!job) throw reject('NOT_FOUND', 'Job not found');
    if (!(await job.isFailed())) throw reject('INVALID_STATUS', 'Only a failed job can be retried');
    await job.retry();
    return { ok: true as const };
  }
}
