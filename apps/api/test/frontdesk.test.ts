import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays } from '@hotel/shared';
import { assertConsistent, createFixture, parallel, TEST_TODAY, startApp, type Fixture, type TestApp } from './helpers';
import { confirmedBooking, makeStaff, overbookedBooking, setHotelDate, setRoomStatus, type Actor } from './staff-helpers';

let app: TestApp;
beforeAll(async () => {
  app = await startApp({ RATE_LIMIT_GLOBAL_PER_MIN: '100000' });
});
afterAll(async () => {
  await app.close();
});

const setup = async (rooms = 3): Promise<{ f: Fixture; desk: Actor }> => {
  const f = await createFixture(app.db, { rooms });
  return { f, desk: await makeStaff(app, [{ hotelId: f.hotelId, role: 'frontdesk' }]) };
};

interface Folio { balance: number; lines: { id: string; amount: number }[] }
const num = async (q: Promise<{ n: bigint }[]>): Promise<number> => Number((await q)[0].n);
const status = async (id: string): Promise<string> => (await app.db.$queryRaw<{ s: string }[]>`SELECT status::text s FROM booking WHERE id = ${id}::uuid`)[0].s;

describe('front desk', () => {
  it('check-in only into a clean or inspected room; the arrival list shows the booking', async () => {
    const { f, desk } = await setup();
    const id = await confirmedBooking(app, f, TEST_TODAY, addDays(TEST_TODAY, 2));
    expect((await desk.api.post(`/api/bookings/${id}/check-in`)).body).toMatchObject({ code: 'ROOM_NOT_READY' });
    const room = f.roomIds[0];
    await setRoomStatus(app.db, room, 'dirty');
    expect((await desk.api.post(`/api/bookings/${id}/assign-room`, { roomId: room })).status).toBe(200);
    const dirty = await desk.api.post<{ code: string }>(`/api/bookings/${id}/check-in`);
    expect([dirty.status, dirty.body.code]).toEqual([409, 'ROOM_NOT_READY']);
    expect(await status(id)).toBe('confirmed');
    await setRoomStatus(app.db, room, 'clean');
    expect((await desk.api.post(`/api/bookings/${id}/check-in`)).status).toBe(200);
    expect(await status(id)).toBe('checked_in');
    const list = await desk.api.get<{ hotelDate: string; bookings: { bookingId: string; roomNumber: string; balance: number }[] }>(`/api/hotels/${f.hotelId}/frontdesk?view=inhouse`);
    expect(list.body.hotelDate).toBe(TEST_TODAY);
    expect(list.body.bookings.find((b) => b.bookingId === id)).toMatchObject({ roomNumber: '100', balance: 0 });
    const found = await desk.api.get<{ bookings: { bookingId: string }[] }>(`/api/hotels/${f.hotelId}/bookings/search?q=guest`);
    expect(found.body.bookings.map((b) => b.bookingId)).toContain(id);
  });

  it('check-out needs a zero balance; storno works once; balance is the sum of the lines', async () => {
    const { f, desk } = await setup();
    const id = await confirmedBooking(app, f, TEST_TODAY, addDays(TEST_TODAY, 1));
    await desk.api.post(`/api/bookings/${id}/assign-room`, { roomId: f.roomIds[0] });
    await desk.api.post(`/api/bookings/${id}/check-in`);
    const charge = await desk.api.post<Folio>(`/api/bookings/${id}/folio`, { kind: 'charge', category: 'minibar', amount: 1500 });
    expect(charge.body.balance).toBe(1500);
    const blocked = await desk.api.post<{ code: string }>(`/api/bookings/${id}/check-out`);
    expect([blocked.status, blocked.body.code]).toEqual([409, 'BALANCE_NOT_ZERO']);
    expect(await status(id)).toBe('checked_in');
    const extra = await desk.api.post<Folio>(`/api/bookings/${id}/folio`, { kind: 'charge', category: 'service', amount: 700 });
    const lineId = extra.body.lines.find((l) => l.amount === 700)?.id ?? '';
    const s1 = await desk.api.post<Folio>(`/api/bookings/${id}/folio/${lineId}/storno`);
    expect([s1.status, s1.body.balance]).toEqual([200, 1500]);
    const s2 = await desk.api.post<{ code: string }>(`/api/bookings/${id}/folio/${lineId}/storno`);
    expect([s2.status, s2.body.code]).toEqual([409, 'CONFLICT']);
    const paid = await desk.api.post<Folio>(`/api/bookings/${id}/folio`, { kind: 'payment', category: 'card', amount: 1500 });
    expect(paid.body.balance).toBe(0);
    const sum = await num(app.db.$queryRaw`SELECT COALESCE(sum(amount), 0) n FROM folio_line WHERE booking_id = ${id}::uuid`);
    expect(sum).toBe(0);
    expect((await desk.api.post(`/api/bookings/${id}/check-out`)).status).toBe(200);
    expect(await status(id)).toBe('checked_out');
    const [room] = await app.db.$queryRaw<{ status: string }[]>`SELECT status::text FROM room WHERE id = ${f.roomIds[0]}::uuid`;
    expect(room.status).toBe('dirty');
    const bad = await desk.api.post(`/api/bookings/${id}/folio`, { kind: 'charge', category: 'room', amount: -5 });
    expect(bad.status).toBe(400);
    await assertConsistent(app.db);
  });

  it('early check-out releases the unused nights', async () => {
    const { f, desk } = await setup();
    const id = await confirmedBooking(app, f, TEST_TODAY, addDays(TEST_TODAY, 4));
    await desk.api.post(`/api/bookings/${id}/assign-room`, { roomId: f.roomIds[0] });
    await desk.api.post(`/api/bookings/${id}/check-in`);
    await setHotelDate(app.db, f.hotelId, addDays(TEST_TODAY, 1));
    const r = await desk.api.post<{ earlyRelease: number }>(`/api/bookings/${id}/check-out`);
    expect([r.status, r.body.earlyRelease]).toEqual([200, 3]);
    const sold = await app.db.$queryRaw<{ night: string; sold: number }[]>`SELECT night::text, sold FROM inventory WHERE room_type_id = ${f.roomTypeId}::uuid AND sold > 0`;
    expect(sold).toEqual([{ night: TEST_TODAY, sold: 1 }]);
    await assertConsistent(app.db);
  });

  it('cancel after the deadline writes ONE penalty line', async () => {
    const { f, desk } = await setup();
    const id = await confirmedBooking(app, f, addDays(TEST_TODAY, 1), addDays(TEST_TODAY, 3));
    const r = await desk.api.post<{ penalty: number }>(`/api/bookings/${id}/cancel`);
    expect([r.status, r.body.penalty]).toEqual([200, 10_000]);
    expect((await desk.api.post(`/api/bookings/${id}/cancel`)).status).toBe(409);
    const lines = await app.db.$queryRaw<{ category: string; amount: number }[]>`SELECT category, amount FROM folio_line WHERE booking_id = ${id}::uuid`;
    expect(lines).toEqual([{ category: 'penalty', amount: 10_000 }]);
    await assertConsistent(app.db);
  });

  it('two admins assigning the same room to overlapping bookings: one wins', async () => {
    const { f } = await setup();
    const a1 = await makeStaff(app, [{ hotelId: null, role: 'admin' }]);
    const a2 = await makeStaff(app, [{ hotelId: null, role: 'admin' }]);
    const b1 = await confirmedBooking(app, f, addDays(TEST_TODAY, 10), addDays(TEST_TODAY, 14));
    const b2 = await confirmedBooking(app, f, addDays(TEST_TODAY, 13), addDays(TEST_TODAY, 17));
    const [r1, r2] = await Promise.all([a1.api.post<{ code?: string }>(`/api/bookings/${b1}/assign-room`, { roomId: f.roomIds[0] }), a2.api.post<{ code?: string }>(`/api/bookings/${b2}/assign-room`, { roomId: f.roomIds[0] })]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect([r1, r2].find((r) => r.status === 409)?.body.code).toBe('ROOM_TAKEN');
    expect(await num(app.db.$queryRaw`SELECT count(*) n FROM room_assignment WHERE room_id = ${f.roomIds[0]}::uuid`)).toBe(1);
    const opts = await a1.api.get<{ rooms: { roomId: string }[] }>(`/api/bookings/${b2}/room-options`);
    expect(opts.status).toBe(200);
    await parallel(2, () => a1.api.get(`/api/bookings/${b1}`));
  });

  it('move-room splits the stay; a taken or dirty target rolls back', async () => {
    const { f, desk } = await setup(4);
    const id = await confirmedBooking(app, f, TEST_TODAY, addDays(TEST_TODAY, 4));
    await desk.api.post(`/api/bookings/${id}/assign-room`, { roomId: f.roomIds[0] });
    await desk.api.post(`/api/bookings/${id}/check-in`);
    await setHotelDate(app.db, f.hotelId, addDays(TEST_TODAY, 1));
    const other = await confirmedBooking(app, f, addDays(TEST_TODAY, 2), addDays(TEST_TODAY, 3));
    await desk.api.post(`/api/bookings/${other}/assign-room`, { roomId: f.roomIds[1] });
    const taken = await desk.api.post<{ code: string }>(`/api/bookings/${id}/move-room`, { roomId: f.roomIds[1] });
    expect([taken.status, taken.body.code]).toEqual([409, 'ROOM_TAKEN']);
    await setRoomStatus(app.db, f.roomIds[2], 'dirty');
    expect((await desk.api.post<{ code: string }>(`/api/bookings/${id}/move-room`, { roomId: f.roomIds[2] })).body.code).toBe('ROOM_NOT_READY');
    const before = await app.db.$queryRaw<{ room_id: string }[]>`SELECT room_id::text FROM room_assignment WHERE booking_id = ${id}::uuid`;
    expect(before).toEqual([{ room_id: f.roomIds[0] }]);
    const ok = await desk.api.post(`/api/bookings/${id}/move-room`, { roomId: f.roomIds[3] });
    expect(ok.status).toBe(200);
    const after = await app.db.$queryRaw<{ room_id: string; nights: string }[]>`SELECT room_id::text, nights::text FROM room_assignment WHERE booking_id = ${id}::uuid ORDER BY lower(nights)`;
    expect(after.map((r) => r.room_id)).toEqual([f.roomIds[0], f.roomIds[3]]);
    const [old] = await app.db.$queryRaw<{ status: string }[]>`SELECT status::text FROM room WHERE id = ${f.roomIds[0]}::uuid`;
    expect(old.status).toBe('dirty');
  });

  it('extend adds nights at the current rate; no availability or a room conflict rolls back', async () => {
    const { f, desk } = await setup(2);
    const a = await confirmedBooking(app, f, addDays(TEST_TODAY, 5), addDays(TEST_TODAY, 7));
    await desk.api.post(`/api/bookings/${a}/assign-room`, { roomId: f.roomIds[0] });
    const ok = await desk.api.post<{ total: number; added: number }>(`/api/bookings/${a}/extend`, { checkOut: addDays(TEST_TODAY, 8) });
    expect([ok.status, ok.body.total, ok.body.added]).toEqual([200, 30_000, 1]);
    const c = await confirmedBooking(app, f, addDays(TEST_TODAY, 8), addDays(TEST_TODAY, 10));
    await desk.api.post(`/api/bookings/${c}/assign-room`, { roomId: f.roomIds[0] });
    const clash = await desk.api.post<{ code: string }>(`/api/bookings/${a}/extend`, { checkOut: addDays(TEST_TODAY, 9) });
    expect([clash.status, clash.body.code]).toEqual([409, 'ROOM_TAKEN']);
    const sold = (d: number) => app.db.$queryRaw<{ sold: number }[]>`SELECT sold FROM inventory WHERE room_type_id = ${f.roomTypeId}::uuid AND night = ${addDays(TEST_TODAY, d)}::date`;
    expect((await sold(8))[0].sold).toBe(1);
    await confirmedBooking(app, f, addDays(TEST_TODAY, 10), addDays(TEST_TODAY, 11));
    await confirmedBooking(app, f, addDays(TEST_TODAY, 10), addDays(TEST_TODAY, 11));
    const full = await desk.api.post<{ code: string }>(`/api/bookings/${c}/extend`, { checkOut: addDays(TEST_TODAY, 11) });
    expect([full.status, full.body.code]).toEqual([409, 'NO_AVAILABILITY']);
    const [row] = await app.db.$queryRaw<{ check_out: string; n: bigint }[]>`SELECT check_out::text, (SELECT count(*) FROM booking_night WHERE booking_id = ${c}::uuid) n FROM booking WHERE id = ${c}::uuid`;
    expect([row.check_out, Number(row.n)]).toEqual([addDays(TEST_TODAY, 10), 2]);
    await assertConsistent(app.db);
  });

  it('resolve-overbooking moves the booking to a higher class and clears the flag', async () => {
    const { f, desk } = await setup(1);
    await confirmedBooking(app, f, addDays(TEST_TODAY, 10), addDays(TEST_TODAY, 12));
    const id = await overbookedBooking(app.db, f, addDays(TEST_TODAY, 10), addDays(TEST_TODAY, 12));
    const list = await desk.api.get<{ bookings: { bookingId: string; overbooking: boolean }[] }>(`/api/hotels/${f.hotelId}/frontdesk?view=overbooked`);
    expect(list.body.bookings).toEqual([expect.objectContaining({ bookingId: id, overbooking: true })]);
    const same = await desk.api.post<{ code: string }>(`/api/bookings/${id}/resolve-overbooking`, { roomTypeId: f.roomTypeId });
    expect(same.status).toBe(400);
    const r = await desk.api.post(`/api/bookings/${id}/resolve-overbooking`, { roomTypeId: f.upperRoomTypeId });
    expect(r.status).toBe(200);
    const [b] = await app.db.$queryRaw<{ room_type_id: string; overbooking: boolean; price: number }[]>`
      SELECT b.room_type_id::text, b.overbooking, (SELECT max(price) FROM booking_night WHERE booking_id = b.id) price FROM booking b WHERE b.id = ${id}::uuid`;
    expect(b).toEqual({ room_type_id: f.upperRoomTypeId, overbooking: false, price: 10_000 });
    const inv = await app.db.$queryRaw<{ sold: number; overbooked: number }[]>`SELECT sold, overbooked FROM inventory WHERE room_type_id = ${f.roomTypeId}::uuid AND night = ${addDays(TEST_TODAY, 10)}::date`;
    expect(inv).toEqual([{ sold: 1, overbooked: 0 }]);
    await assertConsistent(app.db);
  });
});
