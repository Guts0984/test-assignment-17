import type { Queue } from 'bullmq';
import type { Db } from '@hotel/db';

export interface NotifyDeps {
  readonly db: Db;
  readonly queue: Queue;
  readonly now: () => Date;
  readonly debounceMs: number;
  readonly attempts: number;
}

/**
 * Remembers in Postgres that the channel's view of these room types is stale, and asks the worker
 * to push. The jobId makes the queue keep ONE pending push per room type (the debounce); a lost job
 * (Redis wipe) is rebuilt from `channel_dirty` by the worker's reconciler.
 */
export const markChannelDirty = async (deps: NotifyDeps, roomTypeIds: readonly string[]): Promise<void> => {
  const ids = [...new Set(roomTypeIds)];
  if (ids.length === 0) return;
  await deps.db.$executeRaw`
    INSERT INTO channel_dirty (room_type_id, dirty_at)
    SELECT t, ${deps.now()} FROM unnest(${ids}::uuid[]) AS t WHERE t IN (SELECT room_type_id FROM channel_room_type)
    ON CONFLICT (room_type_id) DO UPDATE SET dirty_at = GREATEST(channel_dirty.dirty_at + interval '1 millisecond', EXCLUDED.dirty_at)`;
  await Promise.all(
    ids.map((id) =>
      deps.queue
        .add('push', { roomTypeId: id }, { jobId: `push-${id}`, delay: deps.debounceMs, attempts: deps.attempts, backoff: { type: 'exponential', delay: 500 }, removeOnComplete: true, removeOnFail: false })
        .catch(() => undefined),
    ),
  );
};
