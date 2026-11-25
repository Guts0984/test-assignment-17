import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays } from '@hotel/shared';
import { assertConsistent, bookStay, createFixture, TEST_TODAY, startApp, type TestApp } from './helpers';
import { confirmedBooking, freshIp, makeStaff, setRoomStatus } from './staff-helpers';

let app: TestApp;
beforeAll(async () => {
  app = await startApp({ RATE_LIMIT_GLOBAL_PER_MIN: '100000' });
});
afterAll(async () => {
  await app.close();
});

interface Rooms { rooms: { id: string; number: string; status: string; arrivalToday: boolean; housekeeperId: string | null }[] }
const statusOf = async (id: string): Promise<string> => (await app.db.$queryRaw<{ s: string }[]>`SELECT status::text s FROM room WHERE id = ${id}::uuid`)[0].s;

describe('housekeeping', () => {
  it('a housekeeper sees and changes only her own rooms; only the head inspects', async () => {
    const f = await createFixture(app.db, { rooms: 3 });
    const hk1 = await makeStaff(app, [{ hotelId: f.hotelId, role: 'housekeeper' }]);
    const hk2 = await makeStaff(app, [{ hotelId: f.hotelId, role: 'housekeeper' }]);
    const head = await makeStaff(app, [{ hotelId: f.hotelId, role: 'head_housekeeper' }]);
    const [r0, r1, r2] = f.roomIds;
    expect((await hk1.api.put(`/api/rooms/${r0}/housekeeper`, { housekeeperId: hk1.id })).status).toBe(403);
    expect((await head.api.put(`/api/rooms/${r0}/housekeeper`, { housekeeperId: hk1.id })).status).toBe(200);
    expect((await head.api.put(`/api/rooms/${r1}/housekeeper`, { housekeeperId: hk2.id })).status).toBe(200);
    const outsider = await makeStaff(app, []);
    expect((await head.api.put(`/api/rooms/${r2}/housekeeper`, { housekeeperId: outsider.id })).status).toBe(400);
    const mine = await hk1.api.get<Rooms>(`/api/hotels/${f.hotelId}/housekeeping/rooms`);
    expect(mine.body.rooms.map((r) => r.id)).toEqual([r0]);
    const all = await head.api.get<Rooms>(`/api/hotels/${f.hotelId}/housekeeping/rooms`);
    expect(all.body.rooms).toHaveLength(5);
    await setRoomStatus(app.db, r0, 'dirty');
    await setRoomStatus(app.db, r1, 'dirty');
    const foreign = await hk1.api.post<{ code: string }>(`/api/rooms/${r1}/status`, { status: 'clean' });
    expect([foreign.status, foreign.body.code]).toEqual([403, 'FORBIDDEN']);
    expect(await statusOf(r1)).toBe('dirty');
    expect((await hk1.api.post(`/api/rooms/${r0}/status`, { status: 'clean' })).status).toBe(200);
    const early = await hk1.api.post(`/api/rooms/${r0}/status`, { status: 'inspected' });
    expect(early.status).toBe(403);
    expect(await statusOf(r0)).toBe('clean');
    expect((await head.api.post(`/api/rooms/${r0}/status`, { status: 'inspected' })).status).toBe(200);
    const invalid = await head.api.post<{ code: string }>(`/api/rooms/${r1}/status`, { status: 'inspected' });
    expect([invalid.status, invalid.body.code]).toEqual([409, 'INVALID_STATUS']);
  });

  it('after check-out the room is dirty and shown to its housekeeper, arrivals first', async () => {
    const f = await createFixture(app.db, { rooms: 3 });
    const hk = await makeStaff(app, [{ hotelId: f.hotelId, role: 'housekeeper' }]);
    const head = await makeStaff(app, [{ hotelId: f.hotelId, role: 'head_housekeeper' }]);
    const desk = await makeStaff(app, [{ hotelId: f.hotelId, role: 'frontdesk' }]);
    for (const r of f.roomIds) await head.api.put(`/api/rooms/${r}/housekeeper`, { housekeeperId: hk.id });
    const out = await confirmedBooking(app, f, TEST_TODAY, addDays(TEST_TODAY, 1));
    await desk.api.post(`/api/bookings/${out}/assign-room`, { roomId: f.roomIds[2] });
    await desk.api.post(`/api/bookings/${out}/check-in`);
    const arriving = await confirmedBooking(app, f, TEST_TODAY, addDays(TEST_TODAY, 2));
    await desk.api.post(`/api/bookings/${arriving}/assign-room`, { roomId: f.roomIds[1] });
    expect((await desk.api.post(`/api/bookings/${out}/check-out`)).status).toBe(200);
    const list = await hk.api.get<Rooms>(`/api/hotels/${f.hotelId}/housekeeping/rooms`);
    expect(list.body.rooms[0]).toMatchObject({ id: f.roomIds[1], arrivalToday: true });
    expect(list.body.rooms[1]).toMatchObject({ id: f.roomIds[2], status: 'dirty' });
    expect((await hk.api.post(`/api/rooms/${f.roomIds[2]}/status`, { status: 'clean' })).status).toBe(200);
  });

  it('out-of-order reduces availability, is journaled per night and can be reversed', async () => {
    const f = await createFixture(app.db, { rooms: 1 });
    const head = await makeStaff(app, [{ hotelId: f.hotelId, role: 'head_housekeeper' }]);
    const from = addDays(TEST_TODAY, 5);
    const to = addDays(TEST_TODAY, 7);
    const r = await head.api.post<{ id: string; nights: number }>(`/api/rooms/${f.roomIds[0]}/out-of-order`, { from, to, reason: 'Water leak' });
    expect([r.status, r.body.nights]).toEqual([200, 2]);
    const journal = await app.db.$queryRaw<{ d: bigint }[]>`SELECT count(*) d FROM inventory_journal WHERE room_type_id = ${f.roomTypeId}::uuid AND d_ooo = 1`;
    expect(Number(journal[0].d)).toBe(2);
    const blocked = await bookStay(app, f, from, to, { sourceIp: freshIp() });
    expect([blocked.holdStatus, blocked.errorCode]).toEqual([409, 'NO_AVAILABILITY']);
    const free = await bookStay(app, f, to, addDays(to, 1), { sourceIp: freshIp() });
    expect(free.confirmStatus).toBe(200);
    const del = await head.api.raw('DELETE', `/api/rooms/${f.roomIds[0]}/out-of-order/${r.body.id}`);
    expect(del.status).toBe(200);
    expect((await bookStay(app, f, from, to, { sourceIp: freshIp() })).confirmStatus).toBe(200);
    await assertConsistent(app.db);
  });

  it('out-of-order on sold-out nights is a clear conflict and changes nothing', async () => {
    const f = await createFixture(app.db, { rooms: 1 });
    const head = await makeStaff(app, [{ hotelId: f.hotelId, role: 'head_housekeeper' }]);
    await confirmedBooking(app, f, addDays(TEST_TODAY, 5), addDays(TEST_TODAY, 6));
    const r = await head.api.post<{ code: string; message: string }>(`/api/rooms/${f.roomIds[0]}/out-of-order`, { from: addDays(TEST_TODAY, 4), to: addDays(TEST_TODAY, 7), reason: 'Repainting' });
    expect([r.status, r.body.code]).toEqual([409, 'CONFLICT']);
    expect((await app.db.$queryRaw<{ n: bigint }[]>`SELECT count(*) n FROM room_out_of_order WHERE room_id = ${f.roomIds[0]}::uuid`)[0].n).toBe(0n);
    const o = await app.db.$queryRaw<{ n: bigint }[]>`SELECT count(*) n FROM inventory WHERE room_type_id = ${f.roomTypeId}::uuid AND ooo > 0`;
    expect(Number(o[0].n)).toBe(0);
    const today = await head.api.post(`/api/rooms/${f.roomIds[0]}/out-of-order`, { from: TEST_TODAY, to: addDays(TEST_TODAY, 1), reason: 'Broken lock' });
    expect(today.status).toBe(200);
    expect(await statusOf(f.roomIds[0])).toBe('out_of_order');
  });
});
