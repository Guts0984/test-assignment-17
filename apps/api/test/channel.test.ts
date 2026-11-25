import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { addDays } from '@hotel/shared';
import { createWorkerApp, type WorkerApp } from '../../worker/src/app';
import { parseEnv as parseWorkerEnv } from '../../worker/src/config/env';
import { reconcileInbound } from '../../worker/src/jobs/reconciler';
import { assertConsistent, bookStay, client, createFixture, parallel, startApp, TEST_TODAY, type Fixture, type TestApp } from './helpers';

// Channel events are accepted by the api, stored in Postgres, and applied by a worker through BullMQ.
// This file runs one real worker on its own Redis database, so nothing else consumes its queues.
const REDIS_URL = `${process.env.TEST_REDIS_BASE ?? 'redis://127.0.0.1:56379'}/13`;

let a: TestApp;
let b: TestApp;
let worker: WorkerApp;
const KEY = process.env.CHANNEL_API_KEY ?? '';

beforeAll(async () => {
  const redis = new Redis(REDIS_URL);
  await redis.flushdb();
  redis.disconnect();
  const limits = { RATE_LIMIT_GLOBAL_PER_MIN: '1000000', CHANNEL_RATE_PER_MIN: '1000000', REDIS_URL };
  a = await startApp(limits);
  b = await startApp(limits);
  worker = await createWorkerApp({ env: parseWorkerEnv({ ...process.env, REDIS_URL, CHANNEL_DEBOUNCE_MS: '0' }), now: () => a.clock.now(), reconciler: false, logger: false });
});
afterAll(async () => {
  await worker.close();
  await a.close();
  await b.close();
});

interface Accepted {
  result: string;
}

const send = (f: Pick<Fixture, 'hotelId' | 'roomTypeId'>, ref: string, version: number, type: 'new' | 'modify' | 'cancel', ci: number, co: number, app: TestApp = a) =>
  client(app).post<Accepted>('/api/channel/events', { channelRef: ref, version, type, hotelId: f.hotelId, roomTypeId: f.roomTypeId, checkIn: addDays(TEST_TODAY, ci), checkOut: addDays(TEST_TODAY, co), guests: 2, guestName: 'OTA Guest' }, { 'x-channel-key': KEY });

interface Inbox {
  channel_ref: string;
  version: number;
  type: string;
  result: string | null;
  error: string | null;
  processed: boolean;
}

const inbox = (refs: string[]) =>
  a.db.$queryRaw<Inbox[]>`
    SELECT channel_ref, version, type, result, error, processed_at IS NOT NULL AS processed FROM channel_inbox WHERE channel_ref = ANY(${refs}) ORDER BY received_at`;

/** Polls (no fixed sleep) until the worker has applied every stored event of these references. */
const settled = async (refs: string[], expected: number): Promise<Inbox[]> => {
  await expect.poll(async () => (await inbox(refs)).filter((r) => r.processed).length, { timeout: 60_000, interval: 50 }).toBe(expected);
  return inbox(refs);
};

const resultOf = (rows: Inbox[], version: number, type: string): string | null | undefined => rows.find((r) => r.version === version && r.type === type)?.result;

const soldNights = async (app: TestApp, f: Fixture): Promise<number> =>
  Number((await app.db.$queryRaw<{ s: bigint | null }[]>`SELECT sum(sold) s FROM inventory WHERE room_type_id = ${f.roomTypeId}::uuid`)[0]?.s ?? 0);

const bookingsOf = (f: Fixture) => a.db.$queryRaw<{ status: string; overbooking: boolean; channel_ref: string | null }[]>`SELECT status::text, overbooking, channel_ref FROM booking WHERE room_type_id = ${f.roomTypeId}::uuid`;

describe('channel import (api stores and queues, a BullMQ worker applies)', () => {
  it('the same new booking sent 10 times in parallel to both copies is one stored event, one booking, one occupation', async () => {
    const f = await createFixture(a.db, { rooms: 3 });
    const ref = `OTA-${randomUUID()}`;
    const replies = await parallel(10, (i) => send(f, ref, 1, 'new', 4, 7, i % 2 === 0 ? a : b));
    expect(replies.every((r) => r.status === 202 && r.body.result === 'accepted')).toBe(true);
    const rows = await settled([ref], 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.result).toBe('created');
    expect(await bookingsOf(f)).toHaveLength(1);
    expect(await soldNights(a, f)).toBe(3);
    await assertConsistent(a.db);
  });

  it('a cancel (v2) that arrives before the booking leaves the booking cancelled and the nights free', async () => {
    const f = await createFixture(a.db, { rooms: 2 });
    const ref = `OTA-${randomUUID()}`;
    expect((await send(f, ref, 2, 'cancel', 4, 6)).status).toBe(202);
    expect(resultOf(await settled([ref], 1), 2, 'cancel')).toBe('pending');
    expect((await send(f, ref, 1, 'new', 4, 6, b)).status).toBe(202);
    const rows = await settled([ref], 2);
    expect(resultOf(rows, 1, 'new')).toBe('cancelled');
    expect(await bookingsOf(f)).toEqual([{ status: 'cancelled', overbooking: false, channel_ref: ref }]);
    expect(await soldNights(a, f)).toBe(0);
    await assertConsistent(a.db);
  });

  it('a modify before its booking is applied after it; stale versions are dropped', async () => {
    const f = await createFixture(a.db, { rooms: 2 });
    const ref = `OTA-${randomUUID()}`;
    let n = 0;
    const next = async (v: number, type: 'new' | 'modify' | 'cancel', ci: number, co: number): Promise<Inbox[]> => {
      expect((await send(f, ref, v, type, ci, co)).status).toBe(202);
      n += 1;
      return settled([ref], n);
    };
    expect(resultOf(await next(3, 'modify', 10, 13), 3, 'modify')).toBe('pending');
    expect(resultOf(await next(2, 'modify', 20, 22), 2, 'modify')).toBe('pending');
    expect(resultOf(await next(1, 'new', 4, 6), 1, 'new')).toBe('updated');
    const [row] = await a.db.$queryRaw<{ check_in: string; check_out: string; v: number }[]>`SELECT check_in::text, check_out::text, channel_version v FROM booking WHERE channel_ref = ${ref}`;
    expect(row).toEqual({ check_in: addDays(TEST_TODAY, 10), check_out: addDays(TEST_TODAY, 13), v: 3 });
    expect(resultOf(await next(2, 'cancel', 30, 32), 2, 'cancel')).toBe('stale');
    expect(resultOf(await next(3, 'cancel', 10, 13), 3, 'cancel')).toBe('stale');
    expect(await soldNights(a, f)).toBe(3);
    expect(resultOf(await next(4, 'cancel', 10, 13), 4, 'cancel')).toBe('cancelled');
    expect(await soldNights(a, f)).toBe(0);
    await assertConsistent(a.db);
  });

  it('a channel change is not blocked by min stay or stop-sell on the new dates (the channel already sold it)', async () => {
    const f = await createFixture(a.db, { rooms: 2 });
    const ref = `OTA-${randomUUID()}`;
    await a.db.$executeRaw`
      INSERT INTO restriction (room_type_id, night, min_stay, stop_sell)
      SELECT ${f.roomTypeId}::uuid, d, 5, true FROM unnest(${[addDays(TEST_TODAY, 20), addDays(TEST_TODAY, 21)] as string[]}::date[]) AS d`;
    expect((await send(f, ref, 1, 'new', 4, 6)).status).toBe(202);
    await settled([ref], 1);
    expect((await send(f, ref, 2, 'modify', 20, 22)).status).toBe(202);
    const rows = await settled([ref], 2);
    expect(resultOf(rows, 2, 'modify')).toBe('updated');
    const [row] = await a.db.$queryRaw<{ check_in: string }[]>`SELECT check_in::text FROM booking WHERE channel_ref = ${ref}`;
    expect(row?.check_in).toBe(addDays(TEST_TODAY, 20));
    await assertConsistent(a.db);
  });

  it('200 parallel bookings (web and channel) on the last 5 rooms: none lost, rooms never oversold, extras are overbooking', async () => {
    const f = await createFixture(a.db, { rooms: 5 });
    const ci = 8;
    const co = 10;
    const refs = Array.from({ length: 100 }, () => `OTA-${randomUUID()}`);
    const web = parallel(100, (i) => bookStay(i % 2 === 0 ? a : b, f, addDays(TEST_TODAY, ci), addDays(TEST_TODAY, co)));
    const chan = parallel(100, (i) => send(f, refs[i] ?? '', 1, 'new', ci, co, i % 2 === 0 ? a : b));
    const [webResults, chanResults] = await Promise.all([web, chan]);
    expect(chanResults.every((r) => r.status === 202)).toBe(true);
    const rows = await settled(refs, 100);
    expect(rows.filter((r) => r.result !== 'created').map((r) => `${r.result}: ${r.error}`)).toEqual([]);
    const webConfirmed = webResults.filter((r) => r.confirmStatus === 200).length;
    const bookings = await bookingsOf(f);
    const chanBookings = bookings.filter((r) => r.channel_ref !== null);
    const chanFit = chanBookings.filter((r) => !r.overbooking).length;
    expect(chanBookings).toHaveLength(100);
    expect(webConfirmed + chanFit).toBe(5);
    expect(bookings.filter((r) => r.channel_ref === null && r.status === 'confirmed')).toHaveLength(webConfirmed);
    const inv = await a.db.$queryRaw<{ sold: number; overbooked: number; held: number }[]>`SELECT sold, overbooked, held FROM inventory WHERE room_type_id = ${f.roomTypeId}::uuid AND sold > 0 ORDER BY night`;
    expect(inv).toHaveLength(2);
    for (const nightRow of inv) {
      expect(nightRow.sold - nightRow.overbooked).toBe(5);
      expect(nightRow.overbooked).toBe(100 - chanFit);
      expect(nightRow.held).toBe(0);
    }
    await assertConsistent(a.db);
  });

  it('web alone wins exactly 5 of 100 even while an overbooked channel booking exists', async () => {
    const f = await createFixture(a.db, { rooms: 5 });
    const results = await parallel(100, (i) => bookStay(i % 2 === 0 ? a : b, f, addDays(TEST_TODAY, 12), addDays(TEST_TODAY, 14)));
    expect(results.filter((r) => r.confirmStatus === 200)).toHaveLength(5);
    const ref = `OTA-${randomUUID()}`;
    expect((await send(f, ref, 1, 'new', 12, 14)).status).toBe(202);
    await settled([ref], 1);
    expect(await bookingsOf(f).then((r) => r.filter((x) => x.channel_ref === ref))).toEqual([{ status: 'confirmed', overbooking: true, channel_ref: ref }]);
    await assertConsistent(a.db);
  });

  it('an event whose Redis job is lost is still applied: the reconciler rebuilds it from the inbox table', async () => {
    const f = await createFixture(a.db, { rooms: 2 });
    const ref = `OTA-${randomUUID()}`;
    await worker.deps.queues.channelInbound.pause();
    expect((await send(f, ref, 1, 'new', 20, 22)).status).toBe(202);
    const redis = new Redis(REDIS_URL);
    await redis.flushdb(); // the queued job and the pause flag are gone
    redis.disconnect();
    expect((await inbox([ref])).map((r) => r.processed)).toEqual([false]);
    expect(await bookingsOf(f)).toHaveLength(0);
    expect(await reconcileInbound(worker.deps)).toBeGreaterThanOrEqual(1);
    const rows = await settled([ref], 1);
    expect(rows[0]?.result).toBe('created');
    expect(await bookingsOf(f)).toHaveLength(1);
    expect(await soldNights(a, f)).toBe(2);
    await assertConsistent(a.db);
  });

  it('rejects a wrong key (401), a room type that is not connected (403) and a bad body (400), all in the shared error format', async () => {
    const f = await createFixture(a.db, { rooms: 1 });
    const body = { channelRef: 'X', version: 1, type: 'new', hotelId: f.hotelId, roomTypeId: f.roomTypeId, checkIn: addDays(TEST_TODAY, 3), checkOut: addDays(TEST_TODAY, 4), guests: 2 };
    const c = client(a);
    const missing = await c.post<{ code: string }>('/api/channel/events', body);
    const wrong = await c.post<{ code: string }>('/api/channel/events', body, { 'x-channel-key': 'nope' });
    expect([missing.status, missing.body.code, wrong.status, wrong.body.code]).toEqual([401, 'UNAUTHORIZED', 401, 'UNAUTHORIZED']);
    const other = await createFixture(a.db, { rooms: 1 });
    await a.db.$executeRaw`DELETE FROM channel_room_type WHERE room_type_id = ${other.roomTypeId}::uuid`;
    const notConnected = await c.post<{ code: string }>('/api/channel/events', { ...body, hotelId: other.hotelId, roomTypeId: other.roomTypeId }, { 'x-channel-key': KEY });
    expect([notConnected.status, notConnected.body.code]).toEqual([403, 'FORBIDDEN']);
    const crossHotel = await c.post<{ code: string }>('/api/channel/events', { ...body, hotelId: other.hotelId }, { 'x-channel-key': KEY });
    expect(crossHotel.status).toBe(403);
    const bad = await c.post<{ code: string; message: string }>('/api/channel/events', { ...body, version: 0, type: 'bogus' }, { 'x-channel-key': KEY });
    expect([bad.status, bad.body.code]).toEqual([400, 'VALIDATION_ERROR']);
  });
});
