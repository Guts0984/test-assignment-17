import { addDays, auditInstant } from '@hotel/shared';
import { inTx, type Db } from './client';
import { addFolioLine } from './folio';
import { loadBookingById, loadNights, releaseBookingNights } from './bookings';

export type AuditOutcome = 'closed' | 'not_due' | 'already_closed';

interface HotelRow {
  timezone: string;
  audit_time: string;
  last_closed_date: string;
}

/**
 * Closes the next hotel date, if its audit instant has passed. The hotel row lock
 * serializes copies; `night_audit (hotel, date)` is unique, so a date closes exactly once and in order.
 * Everything inside is idempotent: no-show and room charges carry unique keys.
 */
export const closeNextDate = async (deps: { db: Db; now: () => Date }, hotelId: string): Promise<AuditOutcome> =>
  inTx(deps.db, async (tx) => {
    const now = deps.now();
    const [h] = await tx.$queryRaw<HotelRow[]>`
      SELECT timezone, audit_time, last_closed_date::text FROM hotel WHERE id = ${hotelId}::uuid FOR UPDATE`;
    const date = addDays(h.last_closed_date, 1);
    if (auditInstant(date, h.audit_time, h.timezone).getTime() > now.getTime()) return 'not_due';
    const inserted = await tx.$executeRaw`
      INSERT INTO night_audit (hotel_id, hotel_date, closed_at, no_shows, room_charges)
      VALUES (${hotelId}::uuid, ${date}::date, ${now}, 0, 0) ON CONFLICT (hotel_id, hotel_date) DO NOTHING`;
    if (inserted === 0) return 'already_closed';

    const noShows = await tx.$queryRaw<{ id: string }[]>`
      UPDATE booking b SET status = 'no_show', updated_at = ${now},
             penalty = COALESCE((SELECT price FROM booking_night WHERE booking_id = b.id ORDER BY night LIMIT 1), 0)
      WHERE b.hotel_id = ${hotelId}::uuid AND b.status = 'confirmed' AND b.check_in = ${date}::date
      RETURNING b.id::text`;
    for (const { id } of noShows) {
      const b = await loadBookingById(tx, id);
      if (!b) continue;
      await releaseBookingNights(tx, b, await loadNights(tx, id), 'no_show', 'audit');
      if ((b.penalty ?? 0) > 0) {
        await addFolioLine(tx, {
          bookingId: id, kind: 'charge', category: 'penalty', amount: b.penalty ?? 0, note: 'No-show penalty',
          hotelDate: date, actor: 'audit', idemKey: `penalty:${id}`,
        });
      }
    }

    const charged = await tx.$executeRaw`
      INSERT INTO folio_line (booking_id, kind, category, amount, note, idem_key, hotel_date, created_by)
      SELECT b.id, 'charge', 'room', n.price, 'Room night ' || n.night::text, 'night:' || b.id::text || ':' || n.night::text, ${date}::date, 'audit'
      FROM booking b JOIN booking_night n ON n.booking_id = b.id
      WHERE b.hotel_id = ${hotelId}::uuid AND b.status = 'checked_in' AND n.night = ${date}::date
      ON CONFLICT (idem_key) DO NOTHING`;
    await tx.$executeRaw`UPDATE hotel SET last_closed_date = ${date}::date WHERE id = ${hotelId}::uuid`;
    await tx.$executeRaw`UPDATE night_audit SET no_shows = ${noShows.length}, room_charges = ${charged} WHERE hotel_id = ${hotelId}::uuid AND hotel_date = ${date}::date`;
    return 'closed';
  });

/** Catch-up after downtime: closes every missed date, one by one, in order. */
export const closeDueDates = async (deps: { db: Db; now: () => Date }, hotelId: string, max = 400): Promise<number> => {
  let closed = 0;
  while (closed < max && (await closeNextDate(deps, hotelId)) === 'closed') closed += 1;
  return closed;
};

export const hotelsDueForAudit = async (db: Db, now: Date): Promise<string[]> => {
  const hotels = await db.$queryRaw<(HotelRow & { id: string })[]>`SELECT id::text, timezone, audit_time, last_closed_date::text FROM hotel`;
  return hotels
    .filter((h) => auditInstant(addDays(h.last_closed_date, 1), h.audit_time, h.timezone).getTime() <= now.getTime())
    .map((h) => h.id);
};
