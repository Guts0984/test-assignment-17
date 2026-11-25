import { Inject, Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { inChannelScope, storeInboundEvent, type Db } from '@hotel/db';
import { domainError, err, ok, type ChannelEvent, type ChannelEventResult, type DomainError, type Result } from '@hotel/shared';
import { DB, ENV, INBOUND_QUEUE, type EnvValue } from '../../infra/tokens';

@Injectable()
export class ChannelService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: EnvValue,
    @Inject(INBOUND_QUEUE) private readonly inbound: Queue,
  ) {}

  /**
   * The event is written to Postgres first, then queued for the worker (BullMQ). If the queue cannot be
   * reached the event is still stored, and the worker's reconciler picks it up.
   */
  async accept(ev: ChannelEvent): Promise<Result<ChannelEventResult, DomainError>> {
    if (!(await inChannelScope(this.db, ev.hotelId, ev.roomTypeId))) {
      return err(domainError('FORBIDDEN', 'This hotel or room type is not connected to the channel'));
    }
    const stored = await storeInboundEvent(this.db, ev);
    if (stored.isNew) {
      await this.inbound
        .add('event', { inboxId: stored.id }, { jobId: `inbox-${stored.id}`, attempts: this.env.JOB_ATTEMPTS, backoff: { type: 'exponential', delay: 500 }, removeOnComplete: true, removeOnFail: false })
        .catch(() => undefined);
    }
    return ok({ result: 'accepted', bookingCode: null, overbooking: false });
  }
}
