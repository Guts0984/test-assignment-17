import { DelayedError, type Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import type { WorkerDeps } from '../infra/deps';
import { buildCurrentState, buildRequest } from './channel-state';

export interface ChannelPushData {
  readonly roomTypeId: string;
}

export type PushOutcome = { readonly kind: 'nothing' } | { readonly kind: 'sent'; readonly version: number } | { readonly kind: 'wait'; readonly ms: number };

const log = new Logger('channel-push');

/** Milliseconds still to wait so that one room type gets at most one push per debounce period. */
export const debounceRemaining = (lastSentAt: Date | undefined, now: Date, debounceMs: number): number => {
  if (!lastSentAt) return 0;
  const elapsed = now.getTime() - lastSentAt.getTime();
  return elapsed < 0 ? 0 : Math.max(0, debounceMs - elapsed);
};

/**
 * One push attempt. Reads the dirty snapshot first, then the CURRENT state (so the payload is never older than
 * the snapshot), takes a NEW version from the sequence, signs the raw body and POSTs it. Any failure throws,
 * and BullMQ retries: the retry re-reads state and takes a higher version.
 */
export const pushOnce = async (deps: WorkerDeps, data: ChannelPushData): Promise<PushOutcome> => {
  const { db, env } = deps;
  const dirty = await db.$queryRaw<{ dirty_at: Date }[]>`SELECT dirty_at FROM channel_dirty WHERE room_type_id = ${data.roomTypeId}::uuid`;
  if (!dirty[0]) return { kind: 'nothing' };
  const snapshot = dirty[0].dirty_at;
  const last = await db.$queryRaw<{ last_sent_at: Date }[]>`SELECT last_sent_at FROM channel_push_state WHERE room_type_id = ${data.roomTypeId}::uuid`;
  const wait = debounceRemaining(last[0]?.last_sent_at, deps.now(), env.CHANNEL_DEBOUNCE_MS);
  if (wait > 0) return { kind: 'wait', ms: wait };
  const state = await buildCurrentState(db, data.roomTypeId, env.CHANNEL_PUSH_DAYS);
  if (!state) {
    await db.$executeRaw`DELETE FROM channel_dirty WHERE room_type_id = ${data.roomTypeId}::uuid AND dirty_at <= ${snapshot}`;
    return { kind: 'nothing' };
  }
  const [{ v }] = await db.$queryRaw<{ v: bigint }[]>`SELECT nextval('channel_push_version') AS v`;
  const version = Number(v);
  const req = buildRequest(env.CHANNEL_PUSH_URL, env.CHANNEL_HMAC_SECRET, { ...state, version, sentAt: deps.now().toISOString() });
  const res = await fetch(req.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-signature': req.signature },
    body: req.body,
    signal: AbortSignal.timeout(env.CHANNEL_PUSH_TIMEOUT_MS),
  });
  await res.arrayBuffer().catch(() => undefined);
  if (!res.ok) throw new Error(`channel answered ${res.status}`);
  await db.$executeRaw`DELETE FROM channel_dirty WHERE room_type_id = ${data.roomTypeId}::uuid AND dirty_at <= ${snapshot}`;
  await db.$executeRaw`
    INSERT INTO channel_push_state (room_type_id, last_sent_at, last_version) VALUES (${data.roomTypeId}::uuid, ${deps.now()}, ${version})
    ON CONFLICT (room_type_id) DO UPDATE SET last_sent_at = EXCLUDED.last_sent_at, last_version = GREATEST(channel_push_state.last_version, EXCLUDED.last_version)`;
  log.log(`pushed ${data.roomTypeId} v${version}`);
  return { kind: 'sent', version };
};

/** BullMQ handler: after a push, a newer dirty mark or a debounce wait re-delays the same job instead of failing it. */
export const handlePush = async (deps: WorkerDeps, job: Job<ChannelPushData>, token?: string): Promise<void> => {
  const outcome = await pushOnce(deps, job.data);
  let waitMs = outcome.kind === 'wait' ? outcome.ms : 0;
  if (outcome.kind === 'sent') {
    const again = await deps.db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM channel_dirty WHERE room_type_id = ${job.data.roomTypeId}::uuid`;
    if (Number(again[0]?.n ?? 0) > 0) waitMs = deps.env.CHANNEL_DEBOUNCE_MS;
  }
  if (waitMs > 0 && token) {
    await job.moveToDelayed(Date.now() + waitMs, token);
    throw new DelayedError();
  }
};
