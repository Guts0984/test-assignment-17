import type { Db } from '@hotel/db';
import type { RoomStatus } from '@hotel/shared';

export interface RoomInfo {
  readonly id: string;
  readonly hotelId: string;
  readonly roomTypeId: string;
  readonly status: RoomStatus;
  readonly housekeeperId: string | null;
}

export const findRoom = async (db: Db, id: string): Promise<RoomInfo | null> => {
  const [r] = await db.$queryRaw<{ id: string; hotel_id: string; room_type_id: string; status: RoomStatus; housekeeper_id: string | null }[]>`
    SELECT id::text, hotel_id::text, room_type_id::text, status::text, housekeeper_id::text FROM room WHERE id = ${id}::uuid`;
  return r ? { id: r.id, hotelId: r.hotel_id, roomTypeId: r.room_type_id, status: r.status, housekeeperId: r.housekeeper_id } : null;
};

/** Rooms with an arrival today first, then dirty ones, then the rest. `ownerId` limits the list to one housekeeper. */
export const listRooms = (db: Db, hotelId: string, today: string, ownerId: string | null) =>
  db.$queryRaw<{ id: string; number: string; roomTypeName: string; status: RoomStatus; occupied: boolean; arrivalToday: boolean; housekeeperId: string | null }[]>`
    SELECT r.id::text, r.number, t.name AS "roomTypeName", r.status::text AS status, r.housekeeper_id::text AS "housekeeperId",
      EXISTS (SELECT 1 FROM room_assignment a JOIN booking b ON b.id = a.booking_id
              WHERE a.room_id = r.id AND b.status = 'checked_in' AND a.nights @> ${today}::date) AS occupied,
      EXISTS (SELECT 1 FROM room_assignment a JOIN booking b ON b.id = a.booking_id
              WHERE a.room_id = r.id AND b.status IN ('confirmed', 'checked_in') AND b.check_in = ${today}::date) AS "arrivalToday"
    FROM room r JOIN room_type t ON t.id = r.room_type_id
    WHERE r.hotel_id = ${hotelId}::uuid AND (${ownerId}::uuid IS NULL OR r.housekeeper_id = ${ownerId}::uuid)
    ORDER BY "arrivalToday" DESC, (r.status = 'dirty') DESC, r.number`;

/** Conditional update: two racing changes cannot both win. */
export const changeStatus = async (db: Db, id: string, from: RoomStatus, to: RoomStatus): Promise<boolean> =>
  (await db.$executeRaw`UPDATE room SET status = ${to}::"RoomStatus" WHERE id = ${id}::uuid AND status = ${from}::"RoomStatus"`) === 1;

export const isHousekeeperOf = async (db: Db, staffId: string, hotelId: string): Promise<boolean> =>
  (await db.staffRole.count({ where: { staffId, hotelId, role: { in: ['housekeeper', 'head_housekeeper'] } } })) > 0;

export const assignHousekeeper = (db: Db, roomId: string, housekeeperId: string | null) =>
  db.$executeRaw`UPDATE room SET housekeeper_id = ${housekeeperId}::uuid WHERE id = ${roomId}::uuid`;
