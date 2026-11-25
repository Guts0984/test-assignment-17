import { DynamicModule, Global, Module } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Db } from '@hotel/db';
import type { Redis } from 'ioredis';
import type { Env } from '../config/env';
import type { CounterStore } from '../common/rate-limit/store';
import { CLOCK, DB, ENV, HOLD_QUEUE, INBOUND_QUEUE, LIMITER_STORE, QUEUE, REDIS, type Clock } from './tokens';

export interface InfraValues {
  readonly env: Env;
  readonly db: Db;
  readonly redis: Redis;
  readonly clock: Clock;
  readonly store: CounterStore;
  readonly pushQueue: Queue;
  readonly inboundQueue: Queue;
  readonly holdQueue: Queue;
}

@Global()
@Module({})
export class InfraModule {
  static forRoot(v: InfraValues): DynamicModule {
    const providers = [
      { provide: ENV, useValue: v.env },
      { provide: DB, useValue: v.db },
      { provide: REDIS, useValue: v.redis },
      { provide: CLOCK, useValue: v.clock },
      { provide: LIMITER_STORE, useValue: v.store },
      { provide: QUEUE, useValue: v.pushQueue },
      { provide: INBOUND_QUEUE, useValue: v.inboundQueue },
      { provide: HOLD_QUEUE, useValue: v.holdQueue },
    ];
    return { module: InfraModule, providers, exports: providers.map((p) => p.provide) };
  }
}
