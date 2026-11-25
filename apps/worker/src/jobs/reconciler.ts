import { dueHoldIds, hotelsDueForAudit } from '@hotel/db';
import { Logger } from '@nestjs/common';
import { jobOptions, type WorkerDeps } from '../infra/deps';
import { debounceRemaining } from './channel-push';

const log = new Logger('reconciler');

export interface ReconcileReport {
  readonly holds: number;
  readonly audits: number;
  readonly pushes: number;
  readonly emails: number;
}

/**
 * Rebuilds pending work from Postgres, the source of truth, with deterministic jobIds, so running it
 * repeatedly (or after FLUSHALL) never duplicates a job. A job that already exists is a no-op in BullMQ.
 */
export const reconcileOnce = async (deps: WorkerDeps): Promise<ReconcileReport> => {
  const { db, env, queues } = deps;
  const now = deps.now();
  const holds = await dueHoldIds(db, now);
  await Promise.all(holds.map((id) => queues.holdExpiry.add('expire', { bookingId: id }, jobOptions(env, `expire-${id}`))));

  const hotels = await hotelsDueForAudit(db, now);
  await Promise.all(hotels.map((id) => queues.nightAudit.add('audit', { hotelId: id }, jobOptions(env, `audit-${id}`))));

  const dirty = await db.$queryRaw<{ room_type_id: string; last_sent_at: Date | null }[]>`
    SELECT d.room_type_id::text, s.last_sent_at FROM channel_dirty d LEFT JOIN channel_push_state s USING (room_type_id)`;
  await Promise.all(
    dirty.map((d) =>
      queues.channelPush.add('push', { roomTypeId: d.room_type_id }, jobOptions(env, `push-${d.room_type_id}`, debounceRemaining(d.last_sent_at ?? undefined, now, env.CHANNEL_DEBOUNCE_MS))),
    ),
  );

  const emails = await db.$queryRaw<{ id: string }[]>`SELECT id::text FROM email_outbox WHERE sent_at IS NULL ORDER BY created_at LIMIT 500`;
  await Promise.all(emails.map((e) => queues.email.add('send', { emailId: e.id }, jobOptions(env, `email-${e.id}`))));

  return { holds: holds.length, audits: hotels.length, pushes: dirty.length, emails: emails.length };
};

/** Plain timer, not a BullMQ repeatable: it must keep running after Redis loses all its data. */
export const startReconciler = (deps: WorkerDeps): (() => void) => {
  let running = false;
  const tick = (): void => {
    if (running) return;
    running = true;
    reconcileOnce(deps)
      .catch((e: unknown) => log.warn(`reconcile failed: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => {
        running = false;
      });
  };
  tick();
  const timer = setInterval(tick, deps.env.RECONCILE_INTERVAL_MS);
  return () => clearInterval(timer);
};
