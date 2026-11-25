import type { Db } from '@hotel/db';
import type { BookingStatus, RoomStatus } from '@hotel/shared';

export interface BookingCtx {
  readonly hotelId: string;
  readonly roomTypeId: string;
  readonly hotelDate: string;
  readonly currency: string;
  readonly status: BookingStatus;
}

export const bookingCtx = async (db: Db, id: string): Promise<BookingCtx | null> => {
  const [r] = await db.$queryRaw<{ hotel_id: string; room_type_id: string; hotel_date: string; currency: string; status: BookingStatus }[]>`
    SELECT b.hotel_id::text, b.room_type_id::text, (h.last_closed_date + 1)::text AS hotel_date, b.currency, b.status::text
    FROM booking b JOIN hotel h ON h.id = b.hotel_id WHERE b.id = ${id}::uuid`;
  return r ? { hotelId: r.hotel_id, roomTypeId: r.room_type_id, hotelDate: r.hotel_date, currency: r.currency, status: r.status } : null;
};

export const hotelDateOf = async (db: Db, hotelId: string): Promise<string | null> => {
  const [h] = await db.$queryRaw<{ d: string }[]>`SELECT (last_closed_date + 1)::text AS d FROM hotel WHERE id = ${hotelId}::uuid`;
  return h?.d ?? null;
};

export interface DeskRow {
  readonly bookingId: string;
  readonly code: string;
  readonly status: BookingStatus;
  readonly guestName: string | null;
  readonly roomId: string | null;
  readonly roomNumber: string | null;
  readonly roomTypeName: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly balance: number;
  readonly overbooking: boolean;
}

type RawRow = Omit<DeskRow, 'balance'> & { balance: bigint };

const toRow = (r: RawRow): DeskRow => ({ ...r, balance: Number(r.balance) });

/** `%` and `_` typed by the user must not act as wildcards. */
export const likePrefix = (q: string): string => `${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const SELECT = `
  b.id::text AS "bookingId", b.code, b.status::text AS status, b.guest_name AS "guestName", rm.id::text AS "roomId", rm.number AS "roomNumber",
  t.name AS "roomTypeName", b.check_in::text AS "checkIn", b.check_out::text AS "checkOut", b.overbooking,
  (SELECT COALESCE(sum(amount), 0) FROM folio_line WHERE booking_id = b.id) AS balance`;

export const listDesk = async (db: Db, hotelId: string, view: string, today: string, q: string | undefined): Promise<DeskRow[]> => {
  const like = q ? `%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const rows = await db.$queryRawUnsafe<RawRow[]>(
    `SELECT ${SELECT}
     FROM booking b JOIN room_type t ON t.id = b.room_type_id
     LEFT JOIN LATERAL (SELECT r.id, r.number FROM room_assignment a JOIN room r ON r.id = a.room_id WHERE a.booking_id = b.id ORDER BY upper(a.nights) DESC LIMIT 1) rm ON true
     WHERE b.hotel_id = $1::uuid AND (
       ($2::text = 'arrivals' AND b.check_in = $3::date AND b.status IN ('confirmed', 'checked_in')) OR
       ($2::text = 'departures' AND b.check_out = $3::date AND b.status IN ('checked_in', 'checked_out')) OR
       ($2::text = 'inhouse' AND b.status = 'checked_in') OR
       ($2::text = 'overbooked' AND b.overbooking AND b.status = 'confirmed' AND b.check_out > $3::date))
     AND ($4::text IS NULL OR lower(b.guest_name) LIKE $4 OR b.code ILIKE $4)
     ORDER BY b.check_in, b.code LIMIT 500`,
    hotelId, view, today, like,
  );
  return rows.map(toRow);
};

/** Four index-backed prefix lookups (code, name, surname, e-mail) merged and capped at 50. */
export const searchDesk = async (db: Db, hotelId: string, q: string): Promise<DeskRow[]> => {
  const p = likePrefix(q);
  const rows = await db.$queryRawUnsafe<RawRow[]>(
    `WITH ids AS (
       (SELECT id FROM booking WHERE code = upper($2) AND hotel_id = $1::uuid LIMIT 50)
       UNION (SELECT id FROM booking WHERE lower(guest_name) LIKE $3 AND hotel_id = $1::uuid LIMIT 50)
       UNION (SELECT id FROM booking WHERE lower(split_part(guest_name, ' ', -1)) LIKE $3 AND hotel_id = $1::uuid LIMIT 50)
       UNION (SELECT id FROM booking WHERE lower(guest_email) LIKE $3 AND hotel_id = $1::uuid LIMIT 50))
     SELECT ${SELECT}
     FROM (SELECT id FROM ids LIMIT 50) i JOIN booking b ON b.id = i.id JOIN room_type t ON t.id = b.room_type_id
     LEFT JOIN LATERAL (SELECT r.id, r.number FROM room_assignment a JOIN room r ON r.id = a.room_id WHERE a.booking_id = b.id ORDER BY upper(a.nights) DESC LIMIT 1) rm ON true
     ORDER BY b.check_in DESC, b.code`,
    hotelId, q.trim(), p,
  );
  return rows.map(toRow);
};

export interface RoomOption {
  readonly roomId: string;
  readonly number: string;
  readonly roomTypeId: string;
  readonly roomTypeName: string;
  readonly status: RoomStatus;
  readonly ready: boolean;
  readonly upgrade: boolean;
}

/** Free physical rooms of the booking's type and higher classes for the stay. */
export const roomOptions = async (db: Db, bookingId: string): Promise<RoomOption[] | null> => {
  const [b] = await db.$queryRaw<{ hotel_id: string; room_type_id: string; check_in: string; check_out: string; rank: number }[]>`
    SELECT b.hotel_id::text, b.room_type_id::text, b.check_in::text, b.check_out::text, t.rank FROM booking b JOIN room_type t ON t.id = b.room_type_id WHERE b.id = ${bookingId}::uuid`;
  if (!b) return null;
  const rows = await db.$queryRaw<{ id: string; number: string; room_type_id: string; name: string; status: RoomStatus }[]>`
    SELECT r.id::text, r.number, r.room_type_id::text, t.name, r.status::text
    FROM room r JOIN room_type t ON t.id = r.room_type_id
    WHERE r.hotel_id = ${b.hotel_id}::uuid AND t.rank >= ${b.rank} AND r.status <> 'out_of_order'
      AND NOT EXISTS (SELECT 1 FROM room_assignment a WHERE a.room_id = r.id AND a.booking_id <> ${bookingId}::uuid AND a.nights && daterange(${b.check_in}::date, ${b.check_out}::date))
      AND NOT EXISTS (SELECT 1 FROM room_out_of_order o WHERE o.room_id = r.id AND daterange(o.from_date, o.to_date) && daterange(${b.check_in}::date, ${b.check_out}::date))
    ORDER BY t.rank, r.number`;
  return rows.map((r) => ({
    roomId: r.id, number: r.number, roomTypeId: r.room_type_id, roomTypeName: r.name, status: r.status,
    ready: r.status === 'clean' || r.status === 'inspected', upgrade: r.room_type_id !== b.room_type_id,
  }));
};

export const bookingDetail = async (db: Db, id: string) => {
  const [b] = await db.$queryRaw<
    { id: string; code: string; hotel_id: string; room_type_id: string; name: string; check_in: string; check_out: string; guests: number; guest_name: string | null; guest_email: string | null; overbooking: boolean; total_price: number; currency: string; penalty: number | null; status: BookingStatus }[]
  >`SELECT b.id::text, b.code, b.hotel_id::text, b.room_type_id::text, t.name, b.check_in::text, b.check_out::text, b.guests, b.guest_name, b.guest_email,
           b.overbooking, b.total_price, b.currency, b.penalty, b.status::text
    FROM booking b JOIN room_type t ON t.id = b.room_type_id WHERE b.id = ${id}::uuid`;
  if (!b) return null;
  const nights = await db.$queryRaw<{ date: string; price: number; overbooked: boolean }[]>`SELECT night::text AS date, price, overbooked FROM booking_night WHERE booking_id = ${id}::uuid ORDER BY night`;
  const rooms = await db.$queryRaw<{ roomId: string; number: string; from: string; to: string }[]>`
    SELECT r.id::text AS "roomId", r.number, lower(a.nights)::text AS "from", upper(a.nights)::text AS "to"
    FROM room_assignment a JOIN room r ON r.id = a.room_id WHERE a.booking_id = ${id}::uuid ORDER BY lower(a.nights)`;
  return {
    id: b.id, code: b.code, hotelId: b.hotel_id, status: b.status, roomTypeId: b.room_type_id, roomTypeName: b.name, checkIn: b.check_in, checkOut: b.check_out,
    guests: b.guests, guestName: b.guest_name, guestEmail: b.guest_email, overbooking: b.overbooking, total: b.total_price, currency: b.currency, penalty: b.penalty, nights, rooms,
  };
};
