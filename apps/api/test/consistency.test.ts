import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addOutOfOrder, assignRoom, checkIn, expireHold, importChannelEvent, removeOutOfOrder } from '@hotel/db';
import { addDays } from '@hotel/shared';
import { assertConsistent, bookStay, client, createFixture, createStaff, loginAs, parallel, startApp, TEST_TODAY, uniqueEmail, type TestApp } from './helpers';

let app: TestApp;
beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => {
  await app.close();
});

const day = (n: number): string => addDays(TEST_TODAY, n);
const count = async (q: Promise<{ n: bigint }[]>): Promise<number> => Number((await q)[0]?.n ?? 0);

describe('availability stays exact under races', () => {
  it('cancel racing a change of dates: no 500, and the counters equal what the bookings really hold', async () => {
    const f = await createFixture(app.db, { rooms: 3 });
    const stays = await parallel(6, (i) => bookStay(app, f, day(10 + i * 4), day(12 + i * 4)));
    expect(stays.every((s) => s.confirmStatus === 200)).toBe(true);
    const replies = await parallel(12, (i) => {
      const s = stays[Math.floor(i / 2)];
      const token = s?.booked?.token ?? '';
      return i % 2 === 0
        ? client(app).patch(`/api/manage/${token}`, { checkIn: day(40 + Math.floor(i / 2) * 3), checkOut: day(42 + Math.floor(i / 2) * 3), guests: 2 })
        : client(app).post(`/api/manage/${token}/cancel`, {});
    });
    expect(replies.filter((r) => r.status >= 500)).toEqual([]);
    expect(replies.every((r) => [200, 409].includes(r.status))).toBe(true);
    await assertConsistent(app.db);
  });
});

describe('overbooking is handed over when a room is freed', () => {
  it('the web guest cancels: the overbooked channel booking gets the room and the night is not sold again', async () => {
    const f = await createFixture(app.db, { rooms: 1 });
    const web = await bookStay(app, f, day(5), day(7));
    expect(web.confirmStatus).toBe(200);
    const event = { channelRef: `OTA-${randomUUID()}`, version: 1, type: 'new' as const, hotelId: f.hotelId, roomTypeId: f.roomTypeId, checkIn: day(5), checkOut: day(7), guests: 2 };
    const imported = await importChannelEvent({ db: app.db, now: app.clock.now }, event);
    expect(imported.result.ok && imported.result.value.overbooking).toBe(true);

    expect((await client(app).post(`/api/manage/${web.booked?.token}/cancel`, {})).status).toBe(200);

    const [chan] = await app.db.$queryRaw<{ overbooking: boolean }[]>`SELECT overbooking FROM booking WHERE channel_ref = ${event.channelRef}`;
    expect(chan?.overbooking).toBe(false);
    expect(await count(app.db.$queryRaw`SELECT count(*) n FROM booking_night bn JOIN booking b ON b.id = bn.booking_id WHERE b.channel_ref = ${event.channelRef} AND bn.overbooked`)).toBe(0);
    const again = await bookStay(app, f, day(5), day(7), { confirm: false });
    expect([again.holdStatus, again.errorCode]).toEqual([409, 'NO_AVAILABILITY']);
    const nights = await app.db.$queryRaw<{ sold: number; overbooked: number }[]>`SELECT sold, overbooked FROM inventory WHERE room_type_id = ${f.roomTypeId}::uuid AND sold > 0`;
    expect(nights).toEqual([{ sold: 1, overbooked: 0 }, { sold: 1, overbooked: 0 }]);
    await assertConsistent(app.db);
  });
  it('a repair ends early: the returned room goes to the overbooked channel booking, not back on sale', async () => {
    const f = await createFixture(app.db, { rooms: 2 });
    const deps = { db: app.db, now: app.clock.now };
    const ooo = await addOutOfOrder(deps, { roomId: f.roomIds[1] ?? '', from: day(5), to: day(7), reason: 'leak', actor: 'test', hotelDate: TEST_TODAY });
    expect(ooo.ok).toBe(true);
    expect((await bookStay(app, f, day(5), day(7))).confirmStatus).toBe(200);
    const event = { channelRef: `OTA-${randomUUID()}`, version: 1, type: 'new' as const, hotelId: f.hotelId, roomTypeId: f.roomTypeId, checkIn: day(5), checkOut: day(7), guests: 2 };
    const imported = await importChannelEvent(deps, event);
    expect(imported.result.ok && imported.result.value.overbooking).toBe(true);

    expect((await removeOutOfOrder(deps, { roomId: f.roomIds[1] ?? '', oooId: ooo.ok ? ooo.value.id : '', actor: 'test', hotelDate: TEST_TODAY })).ok).toBe(true);

    const [chan] = await app.db.$queryRaw<{ overbooking: boolean }[]>`SELECT overbooking FROM booking WHERE channel_ref = ${event.channelRef}`;
    expect(chan?.overbooking).toBe(false);
    const again = await bookStay(app, f, day(5), day(7), { confirm: false });
    expect([again.holdStatus, again.errorCode]).toEqual([409, 'NO_AVAILABILITY']);
    await assertConsistent(app.db);
  });
});

describe('a room is not free while its guest is in it', () => {
  it('check-in of the next guest is refused until the one inside has checked out', async () => {
    const f = await createFixture(app.db, { rooms: 2 });
    const room = f.roomIds[0] ?? '';
    const deps = { db: app.db, now: app.clock.now };
    const first = await bookStay(app, f, day(0), day(2));
    const next = await bookStay(app, f, day(2), day(4));
    expect((await assignRoom(deps, { bookingId: first.booked?.id ?? '', roomId: room, actor: 'test' })).ok).toBe(true);
    expect((await checkIn(deps, { bookingId: first.booked?.id ?? '', actor: 'test' })).ok).toBe(true);
    expect((await assignRoom(deps, { bookingId: next.booked?.id ?? '', roomId: room, actor: 'test' })).ok).toBe(true);
    await app.db.$executeRaw`UPDATE hotel SET last_closed_date = ${day(1)}::date WHERE id = ${f.hotelId}::uuid`; // the hotel date is now day 2
    const refused = await checkIn(deps, { bookingId: next.booked?.id ?? '', actor: 'test' });
    expect(!refused.ok && refused.error.code).toBe('ROOM_NOT_READY');
    expect(!refused.ok && refused.error.message).toContain('still occupied');
    expect(await count(app.db.$queryRaw`SELECT count(*) n FROM booking WHERE hotel_id = ${f.hotelId}::uuid AND status = 'checked_in'`)).toBe(1);
  });
});

describe('the channel hears about every release', () => {
  it('an expired hold marks the room type stale for the channel in the same transaction', async () => {
    const f = await createFixture(app.db, { rooms: 2 });
    const hold = await bookStay(app, f, day(8), day(9), { confirm: false });
    await app.db.$executeRaw`DELETE FROM channel_dirty WHERE room_type_id = ${f.roomTypeId}::uuid`;
    expect(await expireHold({ db: app.db, now: () => new Date('2030-05-01T09:11:00Z') }, hold.booked?.id ?? '')).toBe(true);
    expect(await count(app.db.$queryRaw`SELECT count(*) n FROM channel_dirty WHERE room_type_id = ${f.roomTypeId}::uuid`)).toBe(1);
    await assertConsistent(app.db);
  });
});

describe('the revenue grid', () => {
  it('returns nights as plain dates, starting at the hotel date', async () => {
    const f = await createFixture(app.db, { rooms: 2 });
    const email = uniqueEmail('rev');
    await createStaff(app.db, { email, password: 'pass-12345678', roles: [{ hotelId: f.hotelId, role: 'revenue' }] });
    const c = client(app, { token: await loginAs(app, email, 'pass-12345678', '127.0.9.1') });
    const grid = await c.get<{ from: string; roomTypes: { nights: { date: string }[] }[] }>(`/api/hotels/${f.hotelId}/grid?days=60`);
    expect(grid.status).toBe(200);
    const dates = grid.body.roomTypes.flatMap((t) => t.nights.map((n) => n.date));
    expect(dates.length).toBe(120);
    expect(dates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))).toBe(true);
    expect(grid.body.roomTypes[0]?.nights[0]?.date).toBe(TEST_TODAY);
  });
});

describe('live holds per address', () => {
  it('stops one address from holding everything, gives a slot back on confirm and on a refused hold', async () => {
    const capped = await startApp({ HOLDS_PER_IP_MAX: '2' });
    try {
      const f = await createFixture(capped.db, { rooms: 5 });
      const from = `127.0.${77 + Math.floor(Math.random() * 100)}.${1 + Math.floor(Math.random() * 250)}`; // the counter lives in Redis for a hold period: a fresh address keeps the test re-runnable
      const a = await bookStay(capped, f, day(20), day(21), { confirm: false, sourceIp: from });
      const b = await bookStay(capped, f, day(22), day(23), { confirm: false, sourceIp: from });
      expect([a.holdStatus, b.holdStatus]).toEqual([201, 201]);
      const third = await client(capped, { sourceIp: from }).post<{ code: string }>('/api/holds', { hotelId: f.hotelId, roomTypeId: f.roomTypeId, checkIn: day(24), checkOut: day(25), guests: 2 });
      expect([third.status, third.body.code]).toEqual([429, 'RATE_LIMITED']);
      expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);
      expect((await client(capped, { sourceIp: `127.1.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}` }).post('/api/holds', { hotelId: f.hotelId, roomTypeId: f.roomTypeId, checkIn: day(24), checkOut: day(25), guests: 2 })).status).toBe(201);
      const conf = await client(capped, { sourceIp: from }).post(`/api/holds/${a.booked?.token}/confirm`, { guestName: 'Slot Back', guestEmail: 'slot@test.local', guestPhone: '+351912345678' });
      expect(conf.status).toBe(200);
      expect((await client(capped, { sourceIp: from }).post('/api/holds', { hotelId: f.hotelId, roomTypeId: f.roomTypeId, checkIn: day(26), checkOut: day(27), guests: 2 })).status).toBe(201);
    } finally {
      await capped.close();
    }
  });
});

describe('connecting room types to the channel', () => {
  it('parallel adds never erase each other, and remove takes only what it names', async () => {
    const email = uniqueEmail('chain');
    await createStaff(app.db, { email, password: 'pass-12345678', roles: [{ hotelId: null, role: 'admin' }] });
    const admin = client(app, { token: await loginAs(app, email, 'pass-12345678', '127.0.9.2') });
    const types = (await parallel(8, () => createFixture(app.db, { rooms: 1 }))).map((f) => f.upperRoomTypeId);
    const added = await parallel(8, (i) => admin.raw('PATCH', '/api/admin/channel', JSON.stringify({ add: [types[i]] })));
    expect(added.every((r) => r.status === 200)).toBe(true);
    const listed = (await admin.get<{ roomTypeIds: string[] }>('/api/admin/channel')).body.roomTypeIds;
    expect(types.every((t) => listed.includes(t))).toBe(true);
    await admin.raw('PATCH', '/api/admin/channel', JSON.stringify({ remove: [types[0]] }));
    const after = (await admin.get<{ roomTypeIds: string[] }>('/api/admin/channel')).body.roomTypeIds;
    expect([after.includes(types[0] ?? ''), types.slice(1).every((t) => after.includes(t))]).toEqual([false, true]);
  });
});
