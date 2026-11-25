import {
  DEFAULT_CANCELLATION_POLICY,
  addDays,
  cancellationPenalty,
  domainError,
  err,
  nightsOf,
  ok,
  type CancellationPolicy,
  type DomainError,
  type Result,
} from '@hotel/shared';
import { inTxResult, type Db, type Tx } from './client';
import { addFolioLine } from './folio';
import { occupy, release } from './inventory';
import { hashToken } from './ids';
import { quoteAndCheck } from './pricing';

export interface BookingRow {
  id: string;
  code: string;
  hotel_id: string;
  room_type_id: string;
  check_in: string;
  check_out: string;
  guests: number;
  status: string;
  source: string;
  overbooking: boolean;
  total_price: number;
  currency: string;
  penalty: number | null;
  hold_expires_at: Date | null;
  guest_name: string | null;
  guest_email: string | null;
  timezone: string;
  audit_time: string;
  cancel_free_days: number;
  cancel_free_until: string;
  last_closed_date: string;
}

export interface BookingNightRow {
  night: string;
  price: number;
  overbooked: boolean;
}

export const policyOf = (b: Pick<BookingRow, 'cancel_free_days' | 'cancel_free_until'>): CancellationPolicy => ({
  freeDaysBefore: b.cancel_free_days ?? DEFAULT_CANCELLATION_POLICY.freeDaysBefore,
  freeUntil: b.cancel_free_until ?? DEFAULT_CANCELLATION_POLICY.freeUntil,
});

const selectBooking = (tx: Tx, where: 'id' | 'token', value: string): Promise<BookingRow[]> =>
  where === 'id'
    ? tx.$queryRaw<BookingRow[]>`
        SELECT b.id::text, b.code, b.hotel_id::text, b.room_type_id::text, b.check_in::text, b.check_out::text, b.guests, b.status::text, b.source::text,
               b.overbooking, b.total_price, b.currency, b.penalty, b.hold_expires_at, b.guest_name, b.guest_email,
               h.timezone, h.audit_time, h.cancel_free_days, h.cancel_free_until, h.last_closed_date::text
        FROM booking b JOIN hotel h ON h.id = b.hotel_id WHERE b.id = ${value}::uuid`
    : tx.$queryRaw<BookingRow[]>`
        SELECT b.id::text, b.code, b.hotel_id::text, b.room_type_id::text, b.check_in::text, b.check_out::text, b.guests, b.status::text, b.source::text,
               b.overbooking, b.total_price, b.currency, b.penalty, b.hold_expires_at, b.guest_name, b.guest_email,
               h.timezone, h.audit_time, h.cancel_free_days, h.cancel_free_until, h.last_closed_date::text
        FROM booking b JOIN hotel h ON h.id = b.hotel_id WHERE b.token_hash = ${hashToken(value)}`;

export const loadBookingById = async (tx: Tx, id: string): Promise<BookingRow | undefined> => (await selectBooking(tx, 'id', id))[0];
export const loadBookingByToken = async (tx: Tx, token: string): Promise<BookingRow | undefined> => (await selectBooking(tx, 'token', token))[0];

export const loadNights = (tx: Tx, bookingId: string): Promise<BookingNightRow[]> =>
  tx.$queryRaw<BookingNightRow[]>`SELECT night::text, price, overbooked FROM booking_night WHERE booking_id = ${bookingId}::uuid ORDER BY night`;

/** What cancelling now would cost, from the locked nightly price of the first night. */
export const quoteCancellation = (b: BookingRow, nights: readonly BookingNightRow[], now: Date) =>
  cancellationPenalty({ now, checkIn: b.check_in, policy: policyOf(b), tz: b.timezone, firstNightPrice: nights[0]?.price ?? 0 });

export interface CancelDeps {
  readonly db: Db;
  readonly now: () => Date;
}

/**
 * Cancels a confirmed booking. The conditional UPDATE decides the race against the
 * night audit's no-show: exactly one of them changes the status, and the penalty line has a unique key.
 */
export const cancelBooking = async (
  deps: CancelDeps,
  input: { bookingId: string; actor: string; hotelDate: string },
): Promise<Result<{ penalty: number }, DomainError>> =>
  inTxResult(deps.db, async (tx) => {
    const now = deps.now();
    const b = await loadBookingById(tx, input.bookingId);
    if (!b) return err(domainError('NOT_FOUND', 'Booking not found'));
    const nights = await loadNights(tx, b.id);
    const quote = quoteCancellation(b, nights, now);
    const [row] = await tx.$queryRaw<{ id: string }[]>`
      UPDATE booking SET status = 'cancelled', penalty = ${quote.penalty}, updated_at = ${now}
      WHERE id = ${b.id}::uuid AND status = 'confirmed' RETURNING id::text`;
    if (!row) return err(domainError('INVALID_STATUS', 'Only a confirmed booking can be cancelled'));
    await releaseBookingNights(tx, b, nights, 'cancel', input.actor);
    if (quote.penalty > 0) {
      await addFolioLine(tx, {
        bookingId: b.id, kind: 'charge', category: 'penalty', amount: quote.penalty, note: 'Cancellation penalty',
        hotelDate: input.hotelDate, actor: input.actor, idemKey: `penalty:${b.id}`,
      });
    }
    return ok({ penalty: quote.penalty });
  });

export const releaseBookingNights = async (tx: Tx, b: BookingRow, nights: readonly BookingNightRow[], reason: string, actor: string): Promise<void> => {
  await release(tx, {
    roomTypeId: b.room_type_id,
    nights: nights.map((n) => n.night),
    kind: 'sold',
    overbookedNights: nights.filter((n) => n.overbooked).map((n) => n.night),
    meta: { reason, docId: b.id, actor },
  });
  await tx.$executeRaw`DELETE FROM room_assignment WHERE booking_id = ${b.id}::uuid`;
};

/**
 * Changes the dates / guests. Everything happens in one transaction: if the new nights
 * cannot be taken, it rolls back and the old booking and inventory stay untouched.
 * Kept nights keep their price; new nights use the current rate.
 */
export const changeBooking = async (
  deps: CancelDeps,
  input: { bookingId: string; checkIn: string; checkOut: string; guests: number; actor: string },
): Promise<Result<{ total: number }, DomainError>> =>
  inTxResult(deps.db, async (tx) => {
      const now = deps.now();
      const [lock] = await tx.$queryRaw<{ id: string }[]>`SELECT id::text FROM booking WHERE id = ${input.bookingId}::uuid FOR UPDATE`;
      if (!lock) return err(domainError('NOT_FOUND', 'Booking not found'));
      const b = await loadBookingById(tx, input.bookingId);
      if (!b || b.status !== 'confirmed') return err(domainError('INVALID_STATUS', 'Only a confirmed booking can be changed'));
      const [rt] = await tx.$queryRaw<{ max_guests: number }[]>`SELECT max_guests FROM room_type WHERE id = ${b.room_type_id}::uuid`;
      if (input.guests > rt.max_guests) return err(domainError('VALIDATION_ERROR', `At most ${rt.max_guests} guests fit this room type`));
      if (input.checkIn < addDays(b.last_closed_date, 1)) return err(domainError('VALIDATION_ERROR', 'Check-in date is in the past'));
      const old = await loadNights(tx, b.id);
      const oldPrice = new Map(old.map((n) => [n.night, n]));
      const newNights = nightsOf(input.checkIn, input.checkOut);
      const quote = await quoteAndCheck(tx, { roomTypeId: b.room_type_id, checkIn: input.checkIn, checkOut: input.checkOut });
      if (!quote.ok) return quote;
      const removed = old.filter((n) => !newNights.includes(n.night));
      const added = newNights.filter((n) => !oldPrice.has(n));
      await release(tx, {
        roomTypeId: b.room_type_id, nights: removed.map((n) => n.night), kind: 'sold',
        overbookedNights: removed.filter((n) => n.overbooked).map((n) => n.night),
        meta: { reason: 'change_release', docId: b.id, actor: input.actor },
      });
      const occ = await occupy(tx, {
        roomTypeId: b.room_type_id, nights: added, kind: 'sold', allowOverbooking: b.source === 'channel',
        meta: { reason: 'change_occupy', docId: b.id, actor: input.actor },
      });
      if (!occ.ok) return occ;
      const over = new Set(occ.value.overbookedNights);
      await tx.$executeRaw`DELETE FROM booking_night WHERE booking_id = ${b.id}::uuid AND night = ANY(${removed.map((n) => n.night)}::date[])`;
      for (const n of quote.value.nights) {
        if (oldPrice.has(n.date)) continue;
        await tx.$executeRaw`INSERT INTO booking_night (booking_id, night, price, overbooked) VALUES (${b.id}::uuid, ${n.date}::date, ${n.price}, ${over.has(n.date)})`;
      }
      const total = (await tx.$queryRaw<{ t: bigint }[]>`SELECT sum(price) t FROM booking_night WHERE booking_id = ${b.id}::uuid`)[0].t;
      await tx.$executeRaw`
        UPDATE booking SET check_in = ${input.checkIn}::date, check_out = ${input.checkOut}::date, guests = ${input.guests}, total_price = ${Number(total)},
               overbooking = ${b.overbooking || over.size > 0}, updated_at = ${now} WHERE id = ${b.id}::uuid`;
      await tx.$executeRaw`DELETE FROM room_assignment WHERE booking_id = ${b.id}::uuid`;
      return ok({ total: Number(total) });
  });
