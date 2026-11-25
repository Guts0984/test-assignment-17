import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays } from '@hotel/shared';
import { assertConsistent, bookStay, client, createFixture, parallel, startApp, TEST_TODAY, type Fixture, type TestApp } from './helpers';

let a: TestApp;
let b: TestApp;
const KEY = process.env.CHANNEL_API_KEY ?? '';

beforeAll(async () => {
  const limits = { RATE_LIMIT_GLOBAL_PER_MIN: '1000000', CHANNEL_RATE_PER_MIN: '1000000' };
  a = await startApp(limits);
  b = await startApp(limits);
});
afterAll(async () => {
  await a.close();
  await b.close();
});

interface Reply {
  result: string;
  bookingCode: string | null;
  overbooking: boolean;
}

const event = (f: Pick<Fixture, 'hotelId' | 'roomTypeId'>, ref: string, version: number, type: 'new' | 'modify' | 'cancel', ci: number, co: number, app: TestApp = a) =>
  client(app).post<Reply>('/api/channel/events', { channelRef: ref, version, type, hotelId: f.hotelId, roomTypeId: f.roomTypeId, checkIn: addDays(TEST_TODAY, ci), checkOut: addDays(TEST_TODAY, co), guests: 2, guestName: 'OTA Guest' }, { 'x-channel-key': KEY });

const soldNights = async (app: TestApp, f: Fixture): Promise<number> =>
  Number((await app.db.$queryRaw<{ s: bigint | null }[]>`SELECT sum(sold) s FROM inventory WHERE room_type_id = ${f.roomTypeId}::uuid`)[0]?.s ?? 0);

const bookingsOf = (f: Fixture) => a.db.$queryRaw<{ status: string; overbooking: boolean; channel_ref: string | null }[]>`SELECT status::text, overbooking, channel_ref FROM booking WHERE room_type_id = ${f.roomTypeId}::uuid`;

describe('channel import', () => {
  it('the same new booking sent 10 times in parallel to both copies is one booking and one occupation', async () => {
    const f = await createFixture(a.db, { rooms: 3 });
    const ref = `OTA-${randomUUID()}`;
    const replies = await parallel(10, (i) => event(f, ref, 1, 'new', 4, 7, i % 2 === 0 ? a : b));
    expect(replies.every((r) => r.status === 200)).toBe(true);
    expect(replies.filter((r) => r.body.result === 'created')).toHaveLength(1);
    expect(replies.filter((r) => r.body.result === 'stale')).toHaveLength(9);
    expect(await bookingsOf(f)).toHaveLength(1);
    expect(await soldNights(a, f)).toBe(3);
    await assertConsistent(a.db);
  });

  it('a cancel (v2) that arrives before the booking leaves the booking cancelled and the nights free', async () => {
    const f = await createFixture(a.db, { rooms: 2 });
    const ref = `OTA-${randomUUID()}`;
    const early = await event(f, ref, 2, 'cancel', 4, 6);
    expect(early.body).toMatchObject({ result: 'pending', bookingCode: null });
    const created = await event(f, ref, 1, 'new', 4, 6, b);
    expect(created.body.result).toBe('cancelled');
    expect(created.body.bookingCode).not.toBeNull();
    expect(await bookingsOf(f)).toEqual([{ status: 'cancelled', overbooking: false, channel_ref: ref }]);
    expect(await soldNights(a, f)).toBe(0);
    await assertConsistent(a.db);
  });

  it('a modify before its booking is applied after it; stale versions are dropped', async () => {
    const f = await createFixture(a.db, { rooms: 2 });
    const ref = `OTA-${randomUUID()}`;
    expect((await event(f, ref, 3, 'modify', 10, 13)).body.result).toBe('pending');
    expect((await event(f, ref, 2, 'modify', 20, 22)).body.result).toBe('pending');
    expect((await event(f, ref, 1, 'new', 4, 6)).body.result).toBe('updated');
    const [row] = await a.db.$queryRaw<{ check_in: string; check_out: string; v: number }[]>`SELECT check_in::text, check_out::text, channel_version v FROM booking WHERE channel_ref = ${ref}`;
    expect(row).toEqual({ check_in: addDays(TEST_TODAY, 10), check_out: addDays(TEST_TODAY, 13), v: 3 });
    expect((await event(f, ref, 2, 'modify', 30, 32)).body.result).toBe('stale');
    expect((await event(f, ref, 3, 'cancel', 10, 13)).body.result).toBe('stale');
    expect((await event(f, ref, 1, 'new', 4, 6)).body.result).toBe('stale');
    expect(await soldNights(a, f)).toBe(3);
    expect((await event(f, ref, 4, 'cancel', 10, 13)).body.result).toBe('cancelled');
    expect(await soldNights(a, f)).toBe(0);
    await assertConsistent(a.db);
  });

  it('200 parallel bookings (web and channel) on the last 5 rooms: none lost, rooms never oversold, extras are overbooking', async () => {
    const f = await createFixture(a.db, { rooms: 5 });
    const ci = 8;
    const co = 10;
    const web = parallel(100, (i) => bookStay(i % 2 === 0 ? a : b, f, addDays(TEST_TODAY, ci), addDays(TEST_TODAY, co)));
    const chan = parallel(100, (i) => event(f, `OTA-${randomUUID()}`, 1, 'new', ci, co, i % 2 === 0 ? a : b));
    const [webResults, chanResults] = await Promise.all([web, chan]);
    expect(chanResults.every((r) => r.status === 200 && r.body.result === 'created')).toBe(true);
    const webConfirmed = webResults.filter((r) => r.confirmStatus === 200).length;
    const chanFit = chanResults.filter((r) => !r.body.overbooking).length;
    expect(webConfirmed + chanFit).toBe(5);
    const rows = await bookingsOf(f);
    expect(rows.filter((r) => r.channel_ref !== null)).toHaveLength(100);
    expect(rows.filter((r) => r.channel_ref !== null && r.overbooking)).toHaveLength(100 - chanFit);
    expect(rows.filter((r) => r.channel_ref === null && r.status === 'confirmed')).toHaveLength(webConfirmed);
    const inv = await a.db.$queryRaw<{ sold: number; overbooked: number; held: number }[]>`SELECT sold, overbooked, held FROM inventory WHERE room_type_id = ${f.roomTypeId}::uuid AND sold > 0 ORDER BY night`;
    expect(inv).toHaveLength(2);
    for (const n of inv) {
      expect(n.sold - n.overbooked).toBe(5);
      expect(n.overbooked).toBe(100 - chanFit);
      expect(n.held).toBe(0);
    }
    await assertConsistent(a.db);
  });

  it('web alone wins exactly 5 of 100 even while an overbooked channel booking exists', async () => {
    const f = await createFixture(a.db, { rooms: 5 });
    const results = await parallel(100, (i) => bookStay(i % 2 === 0 ? a : b, f, addDays(TEST_TODAY, 12), addDays(TEST_TODAY, 14)));
    expect(results.filter((r) => r.confirmStatus === 200)).toHaveLength(5);
    const over = await event(f, `OTA-${randomUUID()}`, 1, 'new', 12, 14);
    expect(over.body).toMatchObject({ result: 'created', overbooking: true });
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
