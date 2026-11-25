import type { Db } from '@hotel/db';

export interface ReportFilter {
  readonly hotelId: string;
  readonly from: string;
  readonly to: string;
  readonly roomTypeId?: string;
  readonly source?: 'web' | 'channel';
}

interface TypeRow {
  roomTypeId: string;
  name: string;
  available: bigint;
  sold: bigint;
  revenue: bigint;
}

/** Capacity per night is rooms minus out-of-order, so a repair period lowers RevPAR's denominator. */
export const loadByRoomType = (db: Db, f: ReportFilter): Promise<TypeRow[]> =>
  db.$queryRaw<TypeRow[]>`
    WITH types AS (
      SELECT rt.id, rt.name, (SELECT count(*) FROM room r WHERE r.room_type_id = rt.id)::int AS rooms
      FROM room_type rt WHERE rt.hotel_id = ${f.hotelId}::uuid AND (${f.roomTypeId ?? null}::uuid IS NULL OR rt.id = ${f.roomTypeId ?? null}::uuid)
    ), cap AS (
      SELECT t.id, sum(t.rooms - COALESCE(i.ooo, 0)) AS available
      FROM types t CROSS JOIN generate_series(${f.from}::date, ${f.to}::date - 1, interval '1 day') AS d
      LEFT JOIN inventory i ON i.room_type_id = t.id AND i.night = d::date
      GROUP BY t.id
    ), sold AS (
      SELECT b.room_type_id AS id, count(*) AS nights, COALESCE(sum(bn.price), 0) AS revenue
      FROM booking_night bn JOIN booking b ON b.id = bn.booking_id
      WHERE bn.night >= ${f.from}::date AND bn.night < ${f.to}::date AND b.hotel_id = ${f.hotelId}::uuid
        AND b.status IN ('confirmed', 'checked_in', 'checked_out')
        AND (${f.source ?? null}::text IS NULL OR b.source::text = ${f.source ?? null})
      GROUP BY b.room_type_id
    )
    SELECT t.id::text AS "roomTypeId", t.name, c.available, COALESCE(s.nights, 0) AS sold, COALESCE(s.revenue, 0) AS revenue
    FROM types t JOIN cap c ON c.id = t.id LEFT JOIN sold s ON s.id = t.id
    ORDER BY t.name`;

interface SourceRow {
  source: 'web' | 'channel';
  bookings: bigint;
  cancelled: bigint;
  noShows: bigint;
  soldNights: bigint;
  revenue: bigint;
}

/** Cancellations and no-shows are counted for stays that were due to arrive in the period, by sales channel. */
export const loadBySource = (db: Db, f: ReportFilter): Promise<SourceRow[]> =>
  db.$queryRaw<SourceRow[]>`
    SELECT b.source::text AS source, count(*) AS bookings,
           count(*) FILTER (WHERE b.status = 'cancelled') AS cancelled,
           count(*) FILTER (WHERE b.status = 'no_show') AS "noShows",
           COALESCE(sum(n.nights) FILTER (WHERE b.status IN ('confirmed', 'checked_in', 'checked_out')), 0) AS "soldNights",
           COALESCE(sum(n.revenue) FILTER (WHERE b.status IN ('confirmed', 'checked_in', 'checked_out')), 0) AS revenue
    FROM booking b
    LEFT JOIN LATERAL (SELECT count(*) AS nights, sum(price) AS revenue FROM booking_night WHERE booking_id = b.id) n ON true
    WHERE b.hotel_id = ${f.hotelId}::uuid AND b.check_in >= ${f.from}::date AND b.check_in < ${f.to}::date
      AND b.status NOT IN ('held', 'expired')
      AND (${f.roomTypeId ?? null}::uuid IS NULL OR b.room_type_id = ${f.roomTypeId ?? null}::uuid)
    GROUP BY b.source ORDER BY b.source`;
