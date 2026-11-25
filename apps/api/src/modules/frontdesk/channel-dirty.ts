import type { Queue } from 'bullmq';
import type { Db } from '@hotel/db';
import type { Clock, EnvValue } from '../../infra/tokens';
import { markChannelDirty } from '../channel/channel-notify';

/** Tells the channel pusher that these room types changed (after the transaction committed). */
export const dirtyRoomTypes = (ctx: { db: Db; env: EnvValue; clock: Clock; queue: Queue }, roomTypeIds: readonly string[]): Promise<void> =>
  markChannelDirty({ db: ctx.db, queue: ctx.queue, now: ctx.clock.now, debounceMs: ctx.env.CHANNEL_DEBOUNCE_MS, attempts: ctx.env.JOB_ATTEMPTS }, roomTypeIds);
