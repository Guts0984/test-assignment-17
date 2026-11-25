import type { Db } from '@hotel/db';
import { inTx } from '@hotel/db';
import { addDays, applyRateChange, diffDays, domainError, err, nightsOf, ok, type DomainError, type RateChange, type Result } from '@hotel/shared';

export const roomTypeInHotel = async (db: Db, hotelId: string, roomTypeId: string): Promise<boolean> =>
  (await db.roomType.count({ where: { id: roomTypeId, hotelId } })) > 0;

export const hotelToday = async (db: Db, hotelId: string): Promise<string | null> => {
  const [h] = await db.$queryRaw<{ d: string }[]>`SELECT (last_closed_date + 1)::text AS d FROM hotel WHERE id = ${hotelId}::uuid`;
  return h?.d ?? null;
};

/** Sets or adjusts rates for every night in [from, to]. Existing bookings keep their locked prices. */
export const applyRates = async (db: Db, input: { roomTypeId: string; from: string; to: string } & RateChange): Promise<number> =>
  inTx(db, async (tx) => {
    const nights = nightsOf(input.from, addDays(input.to, 1));
    const current = await tx.$queryRaw<{ night: string; price: number }[]>`
      SELECT night::text, price FROM rate WHERE room_type_id = ${input.roomTypeId}::uuid AND night = ANY(${nights as string[]}::date[])`;
    const byNight = new Map(current.map((r) => [r.night, r.price]));
    const rows = nights.flatMap((d) => {
      const price = applyRateChange(d, byNight.get(d), input);
      return price === undefined || price === byNight.get(d) ? [] : [{ d, p: price }];
    });
    if (rows.length === 0) return 0;
    await tx.$executeRaw`
      INSERT INTO rate (room_type_id, night, price)
      SELECT ${input.roomTypeId}::uuid, x.d::date, x.p FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(d text, p int)
      ON CONFLICT (room_type_id, night) DO UPDATE SET price = EXCLUDED.price`;
    return rows.length;
  });

export interface RestrictionPatch {
  readonly roomTypeId: string;
  readonly from: string;
  readonly to: string;
  readonly minStay?: number | null;
  readonly closedToArrival?: boolean;
  readonly closedToDeparture?: boolean;
  readonly stopSell?: boolean;
}

export const applyRestrictions = async (db: Db, p: RestrictionPatch): Promise<number> => {
  const nights = nightsOf(p.from, addDays(p.to, 1));
  const n = await db.$executeRaw`
    INSERT INTO restriction (room_type_id, night, min_stay, closed_to_arrival, closed_to_departure, stop_sell)
    SELECT ${p.roomTypeId}::uuid, d, ${p.minStay ?? null}::int, ${p.closedToArrival ?? false}, ${p.closedToDeparture ?? false}, ${p.stopSell ?? false}
    FROM unnest(${nights as string[]}::date[]) AS d
    ON CONFLICT (room_type_id, night) DO UPDATE SET
      min_stay = CASE WHEN ${p.minStay !== undefined} THEN EXCLUDED.min_stay ELSE restriction.min_stay END,
      closed_to_arrival = CASE WHEN ${p.closedToArrival !== undefined} THEN EXCLUDED.closed_to_arrival ELSE restriction.closed_to_arrival END,
      closed_to_departure = CASE WHEN ${p.closedToDeparture !== undefined} THEN EXCLUDED.closed_to_departure ELSE restriction.closed_to_departure END,
      stop_sell = CASE WHEN ${p.stopSell !== undefined} THEN EXCLUDED.stop_sell ELSE restriction.stop_sell END`;
  return n;
};

/** Changes the allowance and the capacity of all future nights. Fails if rooms are already sold beyond the new capacity. */
export const applyOverbookingAllowance = async (db: Db, hotelId: string, roomTypeId: string, allowance: number, today: string): Promise<Result<true, DomainError>> => {
  try {
    await inTx(db, async (tx) => {
      await tx.$executeRaw`UPDATE room_type SET overbooking_allowance = ${allowance} WHERE id = ${roomTypeId}::uuid AND hotel_id = ${hotelId}::uuid`;
      await tx.$executeRaw`
        UPDATE inventory SET total = (SELECT count(*) FROM room WHERE room_type_id = ${roomTypeId}::uuid)::int + ${allowance}
        WHERE room_type_id = ${roomTypeId}::uuid AND night >= ${today}::date`;
    });
    return ok(true);
  } catch (e) {
    if (JSON.stringify(e).includes('23514')) return err(domainError('CONFLICT', 'Rooms are already sold beyond the new allowance'));
    throw e;
  }
};

export interface GridRow {
  roomTypeId: string;
  night: string;
  total: number;
  ooo: number;
  sold: number;
  held: number;
  overbooked: number;
  price: number | null;
  minStay: number | null;
  cta: boolean | null;
  ctd: boolean | null;
  stop: boolean | null;
}

export const loadGrid = async (db: Db, hotelId: string, from: string, days: number) => {
  const to = addDays(from, Math.min(days, diffDays(from, addDays(from, 60))));
  const types = await db.$queryRaw<{ id: string; name: string; allowance: number; rooms: number }[]>`
    SELECT rt.id::text, rt.name, rt.overbooking_allowance AS allowance, (SELECT count(*) FROM room r WHERE r.room_type_id = rt.id)::int AS rooms
    FROM room_type rt WHERE rt.hotel_id = ${hotelId}::uuid ORDER BY rt.rank`;
  const rows = await db.$queryRaw<GridRow[]>`
    SELECT rt.id::text AS "roomTypeId", d::text AS night, COALESCE(i.total, 0)::int AS total, COALESCE(i.ooo, 0)::int AS ooo, COALESCE(i.sold, 0)::int AS sold,
           COALESCE(i.held, 0)::int AS held, COALESCE(i.overbooked, 0)::int AS overbooked, r.price,
           x.min_stay AS "minStay", x.closed_to_arrival AS cta, x.closed_to_departure AS ctd, x.stop_sell AS stop
    FROM room_type rt
    CROSS JOIN generate_series(${from}::date, ${to}::date - 1, interval '1 day') AS d
    LEFT JOIN inventory i ON i.room_type_id = rt.id AND i.night = d::date
    LEFT JOIN rate r ON r.room_type_id = rt.id AND r.night = d::date
    LEFT JOIN restriction x ON x.room_type_id = rt.id AND x.night = d::date
    WHERE rt.hotel_id = ${hotelId}::uuid ORDER BY rt.rank, d`;
  return {
    from,
    days: diffDays(from, to),
    roomTypes: types.map((t) => ({
      roomTypeId: t.id,
      name: t.name,
      overbookingAllowance: t.allowance,
      nights: rows
        .filter((r) => r.roomTypeId === t.id)
        .map((r) => {
          const total = r.total || t.rooms + t.allowance;
          return {
            date: r.night, total, ooo: r.ooo, sold: r.sold, held: r.held, free: total - r.ooo - (r.sold - r.overbooked + r.held), price: r.price,
            minStay: r.minStay, closedToArrival: r.cta ?? false, closedToDeparture: r.ctd ?? false, stopSell: r.stop ?? false,
          };
        }),
    })),
  };
};
