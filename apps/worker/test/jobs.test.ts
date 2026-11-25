import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { confirmHold, createHold, type Db } from '@hotel/db';
import { addDays } from '@hotel/shared';
import type { WorkerApp } from '../src/app';
import { jobOptions } from '../src/infra/deps';
import { assertConsistent, createFixture, num, openDb, PAST_TODAY, startWorkers, testEnv, waitFor } from './helpers';

const env = testEnv();
const db: Db = openDb(env);
let clockNow = new Date('2020-01-10T09:00:00Z');
const now = (): Date => clockNow;
let workers: WorkerApp[] = [];

beforeAll(async () => {
  await db.$connect();
  workers = await startWorkers(env, now, 2);
  await workers[0]?.deps.connection.flushdb();
});
afterAll(async () => {
  await Promise.all(workers.map((w) => w.close()));
  await db.$disconnect();
});

const q = (): WorkerApp['deps']['queues'] => {
  const w = workers[0];
  if (!w) throw new Error('no worker');
  return w.deps.queues;
};

const hold = async (roomTypeId: string, hotelId: string, checkIn: string, checkOut: string) => {
  const r = await createHold({ db, now, holdMinutes: 10 }, { hotelId, roomTypeId, checkIn, checkOut, guests: 2 });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

describe('hold expiry', () => {
  it('expires every hold exactly once with two processors running in parallel', async () => {
    clockNow = new Date('2020-01-10T09:00:00Z');
    const f = await createFixture(db, { rooms: 4 });
    const held = [];
    for (let i = 0; i < 3; i += 1) held.push(await hold(f.roomTypeId, f.hotelId, addDays(PAST_TODAY, 5), addDays(PAST_TODAY, 7)));
    const kept = await hold(f.roomTypeId, f.hotelId, addDays(PAST_TODAY, 20), addDays(PAST_TODAY, 21));
    await confirmHold({ db, now, holdMinutes: 10, manageUrl: (t) => t }, kept.token, { guestName: 'A', guestEmail: 'a@test.local', guestPhone: '1' });
    clockNow = new Date(clockNow.getTime() + 10 * 60_000 + 1000);
    for (const h of held) {
      await q().holdExpiry.add('expire', { bookingId: h.bookingId }, jobOptions(env, `expire-${h.bookingId}`));
      await q().holdExpiry.add('expire', { bookingId: h.bookingId }, jobOptions(env, `expire-dup-${h.bookingId}`));
    }
    await waitFor(async () => (await num(db.$queryRaw`SELECT count(*) n FROM booking WHERE room_type_id = ${f.roomTypeId}::uuid AND status = 'expired'`)) === 3, 'holds expired');
    const released = await num(db.$queryRaw`SELECT count(*) n FROM inventory_journal WHERE room_type_id = ${f.roomTypeId}::uuid AND reason = 'hold_expired'`);
    expect(released).toBe(6);
    const inv = await db.$queryRaw<{ held: number }[]>`SELECT held FROM inventory WHERE room_type_id = ${f.roomTypeId}::uuid AND held <> 0`;
    expect(inv).toEqual([]);
    expect(await num(db.$queryRaw`SELECT count(*) n FROM booking WHERE room_type_id = ${f.roomTypeId}::uuid AND status = 'confirmed'`)).toBe(1);
    await assertConsistent(db);
  });
});

const auditJob = (hotelId: string, tag: string) => q().nightAudit.add('audit', { hotelId }, jobOptions(env, `audit-${tag}-${hotelId}`));

const closedDates = async (hotelId: string): Promise<string[]> =>
  (await db.$queryRaw<{ d: string }[]>`SELECT hotel_date::text d FROM night_audit WHERE hotel_id = ${hotelId}::uuid ORDER BY closed_at, hotel_date`).map((r) => r.d);

const bookConfirmed = async (f: { roomTypeId: string; hotelId: string }, checkIn: string, checkOut: string) => {
  const h = await hold(f.roomTypeId, f.hotelId, checkIn, checkOut);
  await confirmHold({ db, now, holdMinutes: 10, manageUrl: (t) => t }, h.token, { guestName: 'G', guestEmail: 'g@test.local', guestPhone: '1' });
  return h.bookingId;
};

describe('night audit', () => {
  it('catches up 3 days after downtime: each date closed once, in order, no-show once, with two processors', async () => {
    clockNow = new Date('2020-01-10T09:00:00Z');
    const f = await createFixture(db, { rooms: 3 });
    const noShow = await bookConfirmed(f, addDays(PAST_TODAY, 1), addDays(PAST_TODAY, 3));
    clockNow = new Date('2020-01-13T04:00:00Z');
    await Promise.all([auditJob(f.hotelId, 'a'), auditJob(f.hotelId, 'b'), auditJob(f.hotelId, 'c')]);
    await waitFor(async () => (await closedDates(f.hotelId)).length === 3, '3 dates closed');
    expect(await closedDates(f.hotelId)).toEqual(['2020-01-10', '2020-01-11', '2020-01-12']);
    const [b] = await db.$queryRaw<{ status: string; penalty: number }[]>`SELECT status::text, penalty FROM booking WHERE id = ${noShow}::uuid`;
    expect(b).toEqual({ status: 'no_show', penalty: 10000 });
    expect(await num(db.$queryRaw`SELECT count(*) n FROM folio_line WHERE booking_id = ${noShow}::uuid AND category = 'penalty'`)).toBe(1);
    await assertConsistent(db);
  });

  it.each([
    ['spring forward', '2026-03-27', '2026-03-30T12:00:00Z', ['2026-03-27', '2026-03-28', '2026-03-29']],
    ['fall back', '2026-10-24', '2026-10-27T12:00:00Z', ['2026-10-24', '2026-10-25', '2026-10-26']],
  ])('Kyiv DST %s: every date closes once, no-show once', async (_name, today, clock, expected) => {
    clockNow = new Date(`${today}T08:00:00Z`);
    const f = await createFixture(db, { rooms: 2, timezone: 'Europe/Kyiv', today });
    const noShow = await bookConfirmed(f, addDays(today, 1), addDays(today, 3));
    clockNow = new Date(clock);
    await Promise.all([auditJob(f.hotelId, 'a'), auditJob(f.hotelId, 'b')]);
    await waitFor(async () => (await closedDates(f.hotelId)).length === 3, '3 dates closed');
    expect(await closedDates(f.hotelId)).toEqual(expected);
    expect(await num(db.$queryRaw`SELECT count(*) n FROM booking WHERE id = ${noShow}::uuid AND status = 'no_show'`)).toBe(1);
    expect(await num(db.$queryRaw`SELECT count(*) n FROM folio_line WHERE booking_id = ${noShow}::uuid AND category = 'penalty'`)).toBe(1);
    await assertConsistent(db);
  });
});
