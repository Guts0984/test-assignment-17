import { addDays, nightsOf, type ChannelPush } from '@hotel/shared';
import { signBody } from '@hotel/shared/dist/hmac';
import type { Db } from '@hotel/db';

interface NightRow {
  night: string;
  total: number;
  ooo: number;
  occupied: number;
  price: number | null;
  stop: boolean;
}

/** Rooms the channel may still sell: capacity minus out of order minus sold (without accepted overbooking) and held, never below 0. */
export const availableOf = (r: Pick<NightRow, 'total' | 'ooo' | 'occupied'>): number => Math.max(0, r.total - r.ooo - r.occupied);

/** CURRENT state for the next `days` nights from the hotel's today, straight from Postgres. Null when the room type is gone. */
export const buildCurrentState = async (db: Db, roomTypeId: string, days: number): Promise<Omit<ChannelPush, 'version' | 'sentAt'> | null> => {
  const [rt] = await db.$queryRaw<{ hotel_id: string; today: string }[]>`
    SELECT h.id::text AS hotel_id, (h.last_closed_date + 1)::text AS today
    FROM room_type r JOIN hotel h ON h.id = r.hotel_id WHERE r.id = ${roomTypeId}::uuid`;
  if (!rt) return null;
  const nights = nightsOf(rt.today, addDays(rt.today, days));
  const rows = await db.$queryRaw<NightRow[]>`
    SELECT n::text AS night,
      COALESCE(i.total, (SELECT count(*) FROM room WHERE room_type_id = ${roomTypeId}::uuid)::int
                        + (SELECT overbooking_allowance FROM room_type WHERE id = ${roomTypeId}::uuid)) AS total,
      COALESCE(i.ooo, (SELECT count(*) FROM room_out_of_order o JOIN room r ON r.id = o.room_id
                       WHERE r.room_type_id = ${roomTypeId}::uuid AND n >= o.from_date AND n < o.to_date)::int) AS ooo,
      COALESCE(i.sold - i.overbooked + i.held, 0) AS occupied,
      rt.price AS price,
      COALESCE(rs.stop_sell, false) AS stop
    FROM unnest(${nights as string[]}::date[]) AS n
    LEFT JOIN inventory i ON i.room_type_id = ${roomTypeId}::uuid AND i.night = n
    LEFT JOIN rate rt ON rt.room_type_id = ${roomTypeId}::uuid AND rt.night = n
    LEFT JOIN restriction rs ON rs.room_type_id = ${roomTypeId}::uuid AND rs.night = n
    ORDER BY n`;
  return {
    roomTypeId,
    hotelId: rt.hotel_id,
    nights: rows.map((r) => ({ night: r.night, available: availableOf(r), price: r.price, stopSell: r.stop })),
  };
};

export interface PushRequest {
  readonly url: string;
  readonly body: string;
  readonly signature: string;
}

export const buildRequest = (url: string, secret: string, push: ChannelPush): PushRequest => {
  const body = JSON.stringify(push);
  return { url, body, signature: signBody(secret, body) };
};
