import { randomInt, randomUUID } from 'node:crypto';
import { newBookingCode, newToken, hashToken, occupy, type Db } from '@hotel/db';
import { addDays, nightsOf, type Role } from '@hotel/shared';
import { signToken } from '../src/common/auth/token';
import { bookStay, client, createStaff, uniqueEmail, type Fixture, type TestApp } from './helpers';

/** A private loopback address per caller, so tests do not share one IP's general rate limit counter. */
export const freshIp = (): string => `127.${randomInt(1, 250)}.${randomInt(1, 250)}.${randomInt(1, 250)}`;

export interface Actor {
  readonly id: string;
  readonly token: string;
  readonly api: ReturnType<typeof client>;
}

/** A staff member in the database plus a signed token (no login, so no limiter state is touched). */
export const makeStaff = async (app: TestApp, roles: { hotelId: string | null; role: Role }[]): Promise<Actor> => {
  const email = uniqueEmail('staff');
  const id = await createStaff(app.db, { email, password: 'correct-horse-battery', roles });
  const token = signToken({ id, name: email, roles }, app.env.JWT_SECRET, 3600);
  return { id, token, api: client(app, { token, sourceIp: freshIp() }) };
};

/** A confirmed web booking through the guest flow; returns the booking id. */
export const confirmedBooking = async (app: TestApp, f: Fixture, checkIn: string, checkOut: string): Promise<string> => {
  const r = await bookStay(app, f, checkIn, checkOut, { sourceIp: freshIp() });
  if (!r.booked || r.confirmStatus !== 200) throw new Error(`booking failed: ${r.errorCode}`);
  return r.booked.id;
};

export const setRoomStatus = (db: Db, roomId: string, status: string) => db.$executeRaw`UPDATE room SET status = ${status}::"RoomStatus" WHERE id = ${roomId}::uuid`;

/** Moves the hotel date: the last closed date becomes `date - 1`. */
export const setHotelDate = (db: Db, hotelId: string, date: string) => db.$executeRaw`UPDATE hotel SET last_closed_date = ${addDays(date, -1)}::date WHERE id = ${hotelId}::uuid`;

/** A channel booking accepted as overbooking on a sold-out type. */
export const overbookedBooking = async (db: Db, f: Fixture, checkIn: string, checkOut: string): Promise<string> => {
  const id = randomUUID();
  const nights = nightsOf(checkIn, checkOut);
  await db.$transaction(async (tx) => {
    const occ = await occupy(tx, { roomTypeId: f.roomTypeId, nights, kind: 'sold', allowOverbooking: true, meta: { reason: 'test', docId: id, actor: 'test' } });
    if (!occ.ok) throw new Error('occupy failed');
    await tx.$executeRaw`
      INSERT INTO booking (id, code, hotel_id, room_type_id, check_in, check_out, guests, status, source, channel_ref, overbooking, guest_name, total_price, currency, token_hash)
      VALUES (${id}::uuid, ${newBookingCode()}, ${f.hotelId}::uuid, ${f.roomTypeId}::uuid, ${checkIn}::date, ${checkOut}::date, 2, 'confirmed', 'channel', ${`ch-${id}`}, ${occ.value.overbookedNights.length > 0}, 'Olena Overbooked', ${nights.length * 10_000}, 'EUR', ${hashToken(newToken())})`;
    for (const n of nights) {
      await tx.$executeRaw`INSERT INTO booking_night (booking_id, night, price, overbooked) VALUES (${id}::uuid, ${n}::date, 10000, ${occ.value.overbookedNights.includes(n)})`;
    }
  });
  return id;
};
