import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { confirmHold, createHold } from '@hotel/db';
import { addDays } from '@hotel/shared';
import { jobOptions } from '../src/infra/deps';
import { reconcileOnce } from '../src/jobs/reconciler';
import { assertConsistent, createFixture, num, openDb, PAST_TODAY, startPushServer, startWorkers, testEnv, waitFor } from './helpers';

const db = openDb(testEnv());
afterAll(async () => {
  await db.$disconnect();
});

describe('Redis loss', () => {
  it('after a wipe the reconciler rebuilds holds, audits, pushes and mails from Postgres, and nothing runs twice', async () => {
    let clockNow = new Date('2020-01-10T09:00:00Z');
    const now = (): Date => clockNow;
    const mail = `wipe-${randomUUID()}@test.local`;
    const f = await createFixture(db, { rooms: 3 });
    const h = await createHold({ db, now, holdMinutes: 10 }, { hotelId: f.hotelId, roomTypeId: f.roomTypeId, checkIn: addDays(PAST_TODAY, 4), checkOut: addDays(PAST_TODAY, 5), guests: 2 });
    if (!h.ok) throw new Error(h.error.message);
    const kept = await createHold({ db, now, holdMinutes: 10 }, { hotelId: f.hotelId, roomTypeId: f.roomTypeId, checkIn: addDays(PAST_TODAY, 8), checkOut: addDays(PAST_TODAY, 9), guests: 2 });
    if (!kept.ok) throw new Error(kept.error.message);
    await confirmHold({ db, now, holdMinutes: 10, manageUrl: (t) => t }, kept.value.token, { guestName: 'G', guestEmail: mail, guestPhone: '1' });
    await db.$executeRaw`INSERT INTO channel_dirty (room_type_id, dirty_at) VALUES (${f.roomTypeId}::uuid, now())`;
    const server = await startPushServer(async () => 200);
    const env = testEnv({ CHANNEL_PUSH_URL: server.url, CHANNEL_PUSH_DAYS: '5' });
    const [probe] = await startWorkers(env, now, 1);
    if (!probe) throw new Error('no worker');
    await probe.deps.queues.holdExpiry.add('expire', { bookingId: h.value.bookingId }, { ...jobOptions(env, `expire-${h.value.bookingId}`), delay: 3_600_000 });
    await probe.deps.queues.nightAudit.add('audit', { hotelId: f.hotelId }, { ...jobOptions(env, `audit-${f.hotelId}`), delay: 3_600_000 });
    await probe.deps.connection.flushdb();
    expect(await probe.deps.queues.holdExpiry.getJobCounts('delayed', 'waiting')).toMatchObject({ delayed: 0, waiting: 0 });
    await probe.close();

    clockNow = new Date('2020-01-11T04:00:00Z');
    const copies = await startWorkers(env, now, 2, true);
    try {
      const done = async (): Promise<boolean> =>
        (await num(db.$queryRaw`SELECT count(*) n FROM booking WHERE id = ${h.value.bookingId}::uuid AND status = 'expired'`)) === 1 &&
        (await num(db.$queryRaw`SELECT count(*) n FROM night_audit WHERE hotel_id = ${f.hotelId}::uuid`)) === 1 &&
        (await num(db.$queryRaw`SELECT count(*) n FROM email_outbox WHERE "to" = ${mail} AND sent_at IS NOT NULL`)) === 1 &&
        (await num(db.$queryRaw`SELECT count(*) n FROM channel_dirty WHERE room_type_id = ${f.roomTypeId}::uuid`)) === 0;
      await waitFor(done, 'everything rebuilt and done');
      const first = copies[0];
      if (!first) throw new Error('no worker');
      await reconcileOnce(first.deps);
      await waitFor(async () => {
        const c = await first.deps.queues.holdExpiry.getJobCounts('waiting', 'active', 'delayed');
        const a = await first.deps.queues.nightAudit.getJobCounts('waiting', 'active', 'delayed');
        return c.waiting + c.active + c.delayed + a.waiting + a.active + a.delayed === 0;
      }, 'queues drained');
      expect(await num(db.$queryRaw`SELECT count(*) n FROM inventory_journal WHERE reason = 'hold_expired' AND doc_id = ${h.value.bookingId}::uuid`)).toBe(1);
      expect(await num(db.$queryRaw`SELECT count(*) n FROM night_audit WHERE hotel_id = ${f.hotelId}::uuid`)).toBe(1);
      const mine = server.received.filter((r) => r.raw.includes(f.roomTypeId));
      expect(mine).toHaveLength(1);
      await assertConsistent(db);
    } finally {
      await Promise.all(copies.map((c) => c.close()));
      await server.close();
    }
  });
});
