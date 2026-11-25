import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assignRoom, checkIn, closeNextDate, confirmHold, createHold, expireHold } from '@hotel/db';
import { addDays } from '@hotel/shared';
import { assertConsistent, bookStay, client, createFixture, parallel, startApp, TEST_TODAY, type TestApp } from './helpers';

let app: TestApp;
beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => {
  await app.close();
});

const count = async (sql: Promise<{ n: bigint }[]>): Promise<number> => Number((await sql)[0].n);

describe('core races', () => {
  it('last rooms: 50 parallel bookings on 5 rooms confirm exactly 5', async () => {
    const f = await createFixture(app.db, { rooms: 5 });
    const ci = addDays(TEST_TODAY, 10);
    const co = addDays(TEST_TODAY, 12);
    const results = await parallel(50, () => bookStay(app, f, ci, co));
    const confirmed = results.filter((r) => r.confirmStatus === 200);
    const refused = results.filter((r) => r.holdStatus !== 200 && r.holdStatus !== 201);
    expect(confirmed).toHaveLength(5);
    expect(refused).toHaveLength(45);
    expect(new Set(refused.map((r) => r.errorCode))).toEqual(new Set(['NO_AVAILABILITY']));
    expect(refused.every((r) => r.holdStatus === 409)).toBe(true);
    const rows = await app.db.$queryRaw<{ sold: number; held: number }[]>`SELECT sold, held FROM inventory WHERE room_type_id = ${f.roomTypeId}::uuid AND night IN (${ci}::date, ${addDays(ci, 1)}::date)`;
    expect(rows).toEqual([{ sold: 5, held: 0 }, { sold: 5, held: 0 }]);
    expect(await count(app.db.$queryRaw`SELECT count(*) n FROM booking WHERE room_type_id = ${f.roomTypeId}::uuid AND status = 'confirmed'`)).toBe(5);
    await assertConsistent(app.db);
  });

  it('overlap: "1–5" and "4–8" on the last room — one gets all its nights, the other none', async () => {
    const f = await createFixture(app.db, { rooms: 1 });
    const a = [addDays(TEST_TODAY, 20), addDays(TEST_TODAY, 24)] as const;
    const b = [addDays(TEST_TODAY, 23), addDays(TEST_TODAY, 27)] as const;
    const [ra, rb] = await Promise.all([bookStay(app, f, a[0], a[1], { confirm: false }), bookStay(app, f, b[0], b[1], { confirm: false })]);
    const winners = [ra, rb].filter((r) => r.holdStatus === 200 || r.holdStatus === 201);
    expect(winners).toHaveLength(1);
    const loser = [ra, rb].find((r) => r !== winners[0]);
    expect(loser?.holdStatus).toBe(409);
    expect(loser?.errorCode).toBe('NO_AVAILABILITY');
    const win = winners[0] === ra ? a : b;
    const held = await app.db.$queryRaw<{ night: string; held: number }[]>`SELECT night::text, held FROM inventory WHERE room_type_id = ${f.roomTypeId}::uuid AND held > 0 ORDER BY night`;
    expect(held).toHaveLength(4);
    expect(held[0].night).toBe(win[0]);
    expect(held.every((h) => h.held === 1)).toBe(true);
    expect(await count(app.db.$queryRaw`SELECT count(*) n FROM booking WHERE room_type_id = ${f.roomTypeId}::uuid`)).toBe(1);
    await assertConsistent(app.db);
  });

  it('hold vs expiry: confirm and the expire job racing give exactly one result, nights released at most once', async () => {
    const f = await createFixture(app.db, { rooms: 3 });
    const deps = { db: app.db, holdMinutes: 10 };
    for (let i = 0; i < 6; i += 1) {
      const t0 = new Date(Date.parse('2030-05-01T09:00:00Z') + i * 1000);
      const hold = await createHold({ ...deps, now: () => t0 }, { hotelId: f.hotelId, roomTypeId: f.roomTypeId, checkIn: addDays(TEST_TODAY, 5 + i * 3), checkOut: addDays(TEST_TODAY, 7 + i * 3), guests: 2 });
      if (!hold.ok) throw new Error(hold.error.message);
      const expiresAt = hold.value.expiresAt;
      // the web process still sees the hold alive (1 ms before), the worker sees it due
      const [conf, expired] = await Promise.all([
        confirmHold({ ...deps, now: () => new Date(expiresAt.getTime() - 1), manageUrl: (t) => t }, hold.value.token, { guestName: 'A B', guestEmail: 'a@b.test', guestPhone: '+351912345678' }),
        expireHold({ db: app.db, now: () => expiresAt }, hold.value.bookingId),
      ]);
      expect(conf.ok !== expired).toBe(true);
      const [b] = await app.db.$queryRaw<{ status: string }[]>`SELECT status::text FROM booking WHERE id = ${hold.value.bookingId}::uuid`;
      expect(b.status).toBe(conf.ok ? 'confirmed' : 'expired');
      const [inv] = await app.db.$queryRaw<{ sold: number; held: number }[]>`SELECT sold, held FROM inventory WHERE room_type_id = ${f.roomTypeId}::uuid AND night = ${addDays(TEST_TODAY, 5 + i * 3)}::date`;
      expect(inv).toEqual(conf.ok ? { sold: 1, held: 0 } : { sold: 0, held: 0 });
    }
    await assertConsistent(app.db);
  });

  it('hold at exactly 10 minutes is expired, the nights return to sale', async () => {
    const f = await createFixture(app.db, { rooms: 1 });
    const ci = addDays(TEST_TODAY, 8);
    const r = await bookStay(app, f, ci, addDays(ci, 1), { confirm: false });
    expect(r.booked).not.toBeNull();
    app.clock.set('2030-05-01T09:10:00Z');
    const conf = await client(app).post(`/api/holds/${r.booked?.token}/confirm`, { guestName: 'Late Guest', guestEmail: 'late@test.local', guestPhone: '+351912345678' });
    expect(conf.status).toBe(410);
    expect(await expireHold({ db: app.db, now: app.clock.now }, r.booked?.id ?? '')).toBe(true);
    expect(await expireHold({ db: app.db, now: app.clock.now }, r.booked?.id ?? '')).toBe(false);
    const again = await bookStay(app, f, ci, addDays(ci, 1));
    expect(again.confirmStatus).toBe(200);
    app.clock.set('2030-05-01T09:00:00Z');
    await assertConsistent(app.db);
  });

  it('room assignment: two overlapping bookings for one room in parallel — one succeeds', async () => {
    const f = await createFixture(app.db, { rooms: 2 });
    const a = await bookStay(app, f, addDays(TEST_TODAY, 3), addDays(TEST_TODAY, 6));
    const b = await bookStay(app, f, addDays(TEST_TODAY, 5), addDays(TEST_TODAY, 8));
    const deps = { db: app.db, now: app.clock.now };
    const room = f.roomIds[0];
    const results = await Promise.all([a, b].map((x) => assignRoom(deps, { bookingId: x.booked?.id ?? '', roomId: room, actor: 'test' })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const failed = results.find((r) => !r.ok);
    expect(failed && !failed.ok && failed.error.code).toBe('ROOM_TAKEN');
    expect(await count(app.db.$queryRaw`SELECT count(*) n FROM room_assignment WHERE room_id = ${room}::uuid`)).toBe(1);
    await assertConsistent(app.db);
  });

  it('night audit twice in parallel: the date closes once, room nights are charged once, no-show penalised once', async () => {
    const f = await createFixture(app.db, { rooms: 3 });
    const stay = await bookStay(app, f, TEST_TODAY, addDays(TEST_TODAY, 2));
    const noShow = await bookStay(app, f, TEST_TODAY, addDays(TEST_TODAY, 3));
    const deps = { db: app.db, now: app.clock.now };
    const asg = await assignRoom(deps, { bookingId: stay.booked?.id ?? '', roomId: f.roomIds[0], actor: 'test' });
    expect(asg.ok).toBe(true);
    expect((await checkIn(deps, { bookingId: stay.booked?.id ?? '', actor: 'test' })).ok).toBe(true);
    app.clock.set('2030-05-02T04:00:00Z'); // 05:00 Lisbon, after the 03:00 audit of 2030-05-02
    const outcomes = await Promise.all([closeNextDate(deps, f.hotelId), closeNextDate(deps, f.hotelId)]);
    expect(outcomes.filter((o) => o === 'closed')).toHaveLength(1);
    expect(await count(app.db.$queryRaw`SELECT count(*) n FROM night_audit WHERE hotel_id = ${f.hotelId}::uuid`)).toBe(1);
    expect(await count(app.db.$queryRaw`SELECT count(*) n FROM folio_line WHERE booking_id = ${stay.booked?.id}::uuid AND category = 'room'`)).toBe(1);
    const [ns] = await app.db.$queryRaw<{ status: string; penalty: number }[]>`SELECT status::text, penalty FROM booking WHERE id = ${noShow.booked?.id}::uuid`;
    expect(ns).toEqual({ status: 'no_show', penalty: 10_000 });
    expect(await count(app.db.$queryRaw`SELECT count(*) n FROM folio_line WHERE booking_id = ${noShow.booked?.id}::uuid AND category = 'penalty'`)).toBe(1);
    const [inv] = await app.db.$queryRaw<{ sold: number }[]>`SELECT sold FROM inventory WHERE room_type_id = ${f.roomTypeId}::uuid AND night = ${addDays(TEST_TODAY, 2)}::date`;
    expect(inv.sold).toBe(0);
    app.clock.set('2030-05-01T09:00:00Z');
    await assertConsistent(app.db);
  });
});
