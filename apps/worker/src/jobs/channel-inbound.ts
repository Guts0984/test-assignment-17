import { processInboundEvent } from '@hotel/db';
import { jobOptions, type WorkerDeps } from '../infra/deps';

export interface InboundData {
  readonly inboxId: string;
}

/**
 * Applies one stored channel event. Safe to repeat: a processed event is skipped. A change marks the room
 * type dirty in Postgres and asks for a push (the reconciler does the same if Redis lost the job).
 */
export const runInbound = async (deps: WorkerDeps, data: InboundData): Promise<void> => {
  const out = await processInboundEvent(deps, data.inboxId);
  if (out.status !== 'processed' || !out.changed) return;
  await deps.db.$executeRaw`
    INSERT INTO channel_dirty (room_type_id, dirty_at)
    SELECT ${out.roomTypeId}::uuid, ${deps.now()} WHERE ${out.roomTypeId}::uuid IN (SELECT room_type_id FROM channel_room_type)
    ON CONFLICT (room_type_id) DO UPDATE SET dirty_at = EXCLUDED.dirty_at`;
  await deps.queues.channelPush.add('push', { roomTypeId: out.roomTypeId }, jobOptions(deps.env, `push-${out.roomTypeId}`, deps.env.CHANNEL_DEBOUNCE_MS)).catch(() => undefined);
};
