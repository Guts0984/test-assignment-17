import { channelEventSchema, type ChannelEvent } from '@hotel/shared';
import type { Db } from './client';
import { importChannelEvent } from './channel-import';
import { createSemaphore } from './semaphore';

/** Caps in-process concurrency so that waiting transactions can never exhaust the db pool. */
const limit = createSemaphore(8);

export interface Stored {
  readonly id: string;
  /** False when this exact event (reference, version, type) had already been received. */
  readonly isNew: boolean;
}

/** Writes the inbound event first. The unique key makes a repeat the same row. */
export const storeInboundEvent = async (db: Db, ev: ChannelEvent): Promise<Stored> => {
  const [created] = await db.$queryRaw<{ id: string }[]>`
    INSERT INTO channel_inbox (channel_ref, version, type, room_type_id, payload)
    VALUES (${ev.channelRef}, ${ev.version}, ${ev.type}, ${ev.roomTypeId}::uuid, ${JSON.stringify(ev)}::jsonb)
    ON CONFLICT (channel_ref, version, type) DO NOTHING RETURNING id::text`;
  if (created) return { id: created.id, isNew: true };
  const [existing] = await db.$queryRaw<{ id: string }[]>`SELECT id::text FROM channel_inbox WHERE channel_ref = ${ev.channelRef} AND version = ${ev.version} AND type = ${ev.type}`;
  return { id: existing?.id ?? '', isNew: false };
};

export type InboxOutcome = { readonly status: 'skipped' } | { readonly status: 'processed'; readonly roomTypeId: string; readonly changed: boolean };

/**
 * Applies one stored event. Running it again (a retry, a second worker, a rebuilt job) does nothing once
 * `processed_at` is set. A rule violation (no rates, restriction) is recorded on the row, not retried forever.
 */
export const processInboundEvent = async (deps: { db: Db; now: () => Date }, inboxId: string): Promise<InboxOutcome> => {
  const [row] = await deps.db.$queryRaw<{ payload: unknown; processed_at: Date | null }[]>`SELECT payload, processed_at FROM channel_inbox WHERE id = ${inboxId}::uuid`;
  if (!row || row.processed_at) return { status: 'skipped' };
  const ev = channelEventSchema.parse(row.payload);
  const out = await limit(() => importChannelEvent(deps, ev, inboxId));
  if (!out.result.ok) {
    // a rule violation (no rates, ...) is a final answer, recorded on the row; retrying cannot change it
    const error = `${out.result.error.code}: ${out.result.error.message}`;
    await deps.db.$executeRaw`UPDATE channel_inbox SET processed_at = ${deps.now()}, result = 'rejected', error = ${error} WHERE id = ${inboxId}::uuid AND processed_at IS NULL`;
  }
  return { status: 'processed', roomTypeId: out.roomTypeId, changed: out.result.ok && out.result.value.result !== 'stale' && out.result.value.result !== 'pending' };
};

export const unprocessedInboxIds = async (db: Db, limitRows = 500): Promise<string[]> =>
  (await db.$queryRaw<{ id: string }[]>`SELECT id::text FROM channel_inbox WHERE processed_at IS NULL ORDER BY received_at LIMIT ${limitRows}`).map((r) => r.id);
