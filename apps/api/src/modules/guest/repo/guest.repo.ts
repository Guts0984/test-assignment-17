import { loadBookingById, loadBookingByToken, loadNights, type BookingNightRow, type BookingRow, type Db } from '@hotel/db';
import type { InventoryNight } from '../domain/search';

export const listHotels = (db: Db) =>
  db.hotel.findMany({ where: { listed: true }, select: { id: true, code: true, name: true, timezone: true, currency: true }, orderBy: { code: 'asc' } });

export const findHotel = (db: Db, id: string) => db.hotel.findUnique({ where: { id }, select: { id: true, name: true, timezone: true, currency: true } });

export interface RoomTypeCapacity {
  readonly id: string;
  readonly name: string;
  readonly maxGuests: number;
  readonly capacity: number;
}

export const roomTypesWithCapacity = (db: Db, hotelId: string): Promise<RoomTypeCapacity[]> =>
  db.$queryRaw<RoomTypeCapacity[]>`
    SELECT rt.id::text, rt.name, rt.max_guests AS "maxGuests",
           ((SELECT count(*) FROM room r WHERE r.room_type_id = rt.id) + rt.overbooking_allowance)::int AS capacity
    FROM room_type rt WHERE rt.hotel_id = ${hotelId}::uuid ORDER BY rt.rank`;

export const inventoryFor = (db: Db, hotelId: string, checkIn: string, checkOut: string): Promise<(InventoryNight & { roomTypeId: string })[]> =>
  db.$queryRaw<(InventoryNight & { roomTypeId: string })[]>`
    SELECT i.room_type_id::text AS "roomTypeId", i.night::text, i.total, i.ooo, i.sold, i.held, i.overbooked
    FROM inventory i JOIN room_type rt ON rt.id = i.room_type_id
    WHERE rt.hotel_id = ${hotelId}::uuid AND i.night >= ${checkIn}::date AND i.night < ${checkOut}::date`;

export interface BookingBundle {
  readonly booking: BookingRow;
  readonly nights: BookingNightRow[];
  readonly hotelName: string;
  readonly roomTypeName: string;
}

const bundle = async (db: Db, b: BookingRow | undefined): Promise<BookingBundle | null> => {
  if (!b) return null;
  const [nights, hotel, roomType] = await Promise.all([
    loadNights(db, b.id),
    db.hotel.findUnique({ where: { id: b.hotel_id }, select: { name: true } }),
    db.roomType.findUnique({ where: { id: b.room_type_id }, select: { name: true } }),
  ]);
  return { booking: b, nights, hotelName: hotel?.name ?? '', roomTypeName: roomType?.name ?? '' };
};

export const bundleByToken = async (db: Db, token: string): Promise<BookingBundle | null> => bundle(db, await loadBookingByToken(db, token));
export const bundleById = async (db: Db, id: string): Promise<BookingBundle | null> => bundle(db, await loadBookingById(db, id));
