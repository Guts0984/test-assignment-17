import 'reflect-metadata';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createDb } from '@hotel/db';
import type { Env } from './config/env';
import { createConnection, createQueues, type WorkerDeps } from './infra/deps';
import { WorkerModule } from './worker.module';

export interface WorkerApp {
  readonly context: INestApplicationContext;
  readonly deps: WorkerDeps;
  readonly close: () => Promise<void>;
}

/** Standalone Nest context (no HTTP). Tests pass their own clock and may switch the reconciler off. */
export const createWorkerApp = async (opts: { env: Env; now?: () => Date; reconciler?: boolean; logger?: false }): Promise<WorkerApp> => {
  const connection = createConnection(opts.env.REDIS_URL);
  const deps: WorkerDeps = {
    env: opts.env,
    db: createDb(opts.env.databaseUrl),
    now: opts.now ?? (() => new Date()),
    connection,
    queues: createQueues(connection),
  };
  const context = await NestFactory.createApplicationContext(WorkerModule.forRoot(deps, { reconciler: opts.reconciler }), {
    logger: opts.logger === false ? false : ['error', 'warn', 'log'],
  });
  return {
    context,
    deps,
    close: async () => {
      await context.close();
      await Promise.all(Object.values(deps.queues).map((q) => q.close()));
      await deps.db.$disconnect();
      connection.disconnect();
    },
  };
};
