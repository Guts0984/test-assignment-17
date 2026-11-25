import { Inject, Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Db } from '@hotel/db';
import { domainError, err, type ChannelEvent, type ChannelEventResult, type DomainError, type Result } from '@hotel/shared';
import { CLOCK, DB, ENV, QUEUE, type Clock, type EnvValue } from '../../infra/tokens';
import { markChannelDirty } from './channel-notify';
import { importChannelEvent, inChannelScope } from './domain/import';
import { createSemaphore } from './domain/semaphore';

const limit = createSemaphore(8);

@Injectable()
export class ChannelService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: EnvValue,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(QUEUE) private readonly queue: Queue,
  ) {}

  async handle(ev: ChannelEvent): Promise<Result<ChannelEventResult, DomainError>> {
    if (!(await inChannelScope(this.db, ev.hotelId, ev.roomTypeId))) {
      return err(domainError('FORBIDDEN', 'This hotel or room type is not connected to the channel'));
    }
    const out = await limit(() => importChannelEvent({ db: this.db, now: this.clock.now }, ev));
    if (out.result.ok && out.result.value.result !== 'stale' && out.result.value.result !== 'pending') {
      await markChannelDirty(
        { db: this.db, queue: this.queue, now: this.clock.now, debounceMs: this.env.CHANNEL_DEBOUNCE_MS, attempts: this.env.JOB_ATTEMPTS },
        [out.roomTypeId],
      );
    }
    return out.result;
  }
}
