import { Inject, Injectable, Module, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { Worker } from 'bullmq';
import { CHANNEL_INBOUND_QUEUE, CHANNEL_PUSH_QUEUE, EMAIL_QUEUE, HOLD_EXPIRY_QUEUE, NIGHT_AUDIT_QUEUE } from '@hotel/shared';
import { DEPS, type WorkerDeps } from '../infra/deps';
import { startProcessor } from '../infra/processor';
import { runInbound, type InboundData } from './channel-inbound';
import { handlePush } from './channel-push';
import { runEmail, type EmailData } from './email';
import { runHoldExpiry, type HoldExpiryData } from './hold-expiry';
import { runNightAudit, type NightAuditData } from './night-audit';
import { startReconciler } from './reconciler';

/** Base for the thin Nest classes: start one BullMQ worker, close it (waiting for the running job) on shutdown. */
abstract class Processor implements OnModuleInit, OnApplicationShutdown {
  private worker: Worker | undefined;
  protected constructor(protected readonly deps: WorkerDeps) {}
  protected abstract start(): Worker;
  onModuleInit(): void {
    this.worker = this.start();
  }
  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }
}

@Injectable()
export class HoldExpiryProcessor extends Processor {
  constructor(@Inject(DEPS) deps: WorkerDeps) {
    super(deps);
  }
  protected start(): Worker {
    return startProcessor(HOLD_EXPIRY_QUEUE, this.deps, async (job) => void (await runHoldExpiry(this.deps, job.data as HoldExpiryData)));
  }
}

@Injectable()
export class NightAuditProcessor extends Processor {
  constructor(@Inject(DEPS) deps: WorkerDeps) {
    super(deps);
  }
  protected start(): Worker {
    return startProcessor(NIGHT_AUDIT_QUEUE, this.deps, async (job) => void (await runNightAudit(this.deps, job.data as NightAuditData)));
  }
}

@Injectable()
export class ChannelPushProcessor extends Processor {
  constructor(@Inject(DEPS) deps: WorkerDeps) {
    super(deps);
  }
  protected start(): Worker {
    return startProcessor(CHANNEL_PUSH_QUEUE, this.deps, (job, token) => handlePush(this.deps, job, token));
  }
}

@Injectable()
export class ChannelInboundProcessor extends Processor {
  constructor(@Inject(DEPS) deps: WorkerDeps) {
    super(deps);
  }
  protected start(): Worker {
    return startProcessor(CHANNEL_INBOUND_QUEUE, this.deps, async (job) => void (await runInbound(this.deps, job.data as InboundData)));
  }
}

@Injectable()
export class EmailProcessor extends Processor {
  constructor(@Inject(DEPS) deps: WorkerDeps) {
    super(deps);
  }
  protected start(): Worker {
    return startProcessor(EMAIL_QUEUE, this.deps, async (job) => void (await runEmail(this.deps, job.data as EmailData)));
  }
}

@Injectable()
export class Reconciler implements OnModuleInit, OnApplicationShutdown {
  private stop: (() => void) | undefined;
  constructor(@Inject(DEPS) private readonly deps: WorkerDeps) {}
  onModuleInit(): void {
    this.stop = startReconciler(this.deps);
  }
  onApplicationShutdown(): void {
    this.stop?.();
  }
}

@Module({ providers: [HoldExpiryProcessor] })
export class HoldExpiryModule {}
@Module({ providers: [NightAuditProcessor] })
export class NightAuditModule {}
@Module({ providers: [ChannelPushProcessor] })
export class ChannelPushModule {}
@Module({ providers: [ChannelInboundProcessor] })
export class ChannelInboundModule {}
@Module({ providers: [EmailProcessor] })
export class EmailModule {}
@Module({ providers: [Reconciler] })
export class ReconcilerModule {}
