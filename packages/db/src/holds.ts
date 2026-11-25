import { addDays, domainError, err, nightsOf, ok, type DomainError, type NightPrice, type Result } from '@hotel/shared';
import { inTx, inTxResult, type Db, type Tx } from './client';
import { convertHeldToSold, occupy, release } from './inventory';
import { hashToken, newBookingCode, newToken } from './ids';
import { quoteAndCheck } from './pricing';

export interface HoldDeps {
  readonly db: Db;
  readonly now: () => Date;
  readonly holdMinutes: number;
}

export interface HoldCreated {
  readonly token: string;
  readonly bookingId: string;
  readonly bookingCode: string;
  readonly expiresAt: Date;
  readonly total: number;
  readonly currency: string;
  readonly nights: readonly NightPrice[];
}

interface HotelRoomType {
  currency: string;
  max_guests: number;
  hotel_id: string;
  last_closed_date: string;
}

export const createHold = async (
  deps: HoldDeps,
  input: { hotelId: string; roomTypeId: string; checkIn: string; checkOut: string; guests: number},
): Promise<Result<HoldCreated, DomainError>> =>
  inTxResult(deps.db, async (tx) => {
    const [rt] = await tx.$queryRaw<HotelRoomType[]>`
      SELECT h.currency, rt.max_guests, h.id::text AS hotel_id, h.last_closed_date::text FROM room_type rt JOIN hotel h ON h.id = rt.hotel_id
      WHERE rt.id = ${input.roomTypeId}::uuid AND h.id = ${input.hotelId}::uuid`;
    if (!rt) return err(domainError('NOT_FOUND', 'Room type not found in this hotel'));
    if (input.guests > rt.max_guests) return err(domainError('VALIDATION_ERROR', `At most ${rt.max_guests} guests fit this room type`));
    if (input.checkIn < addDays(rt.last_closed_date, 1)) return err(domainError('VALIDATION_ERROR', 'Check-in date is in the past'));
    const quote = await quoteAndCheck(tx, input);
    if (!quote.ok) return quote;
    const nights = nightsOf(input.checkIn, input.checkOut);
    const now = deps.now();
    const expiresAt = new Date(now.getTime() + deps.holdMinutes * 60_000);
    const token = newToken();
    const code = newBookingCode();
    const [created] = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO booking (code, hotel_id, room_type_id, check_in, check_out, guests, status, source, total_price, currency, hold_expires_at, token_hash, created_at, updated_at)
      VALUES (${code}, ${input.hotelId}::uuid, ${input.roomTypeId}::uuid, ${input.checkIn}::date, ${input.checkOut}::date, ${input.guests},
              'held', 'web', ${quote.value.total}, ${rt.currency}, ${expiresAt}, ${hashToken(token)}, ${now}, ${now})
      RETURNING id::text`;
    const occupied = await occupy(tx, {
      roomTypeId: input.roomTypeId,
      nights,
      kind: 'held',
      allowOverbooking: false,
      meta: { reason: 'hold', docId: created.id, actor: 'guest' },
    });
    if (!occupied.ok) return occupied;
    for (const n of quote.value.nights) {
      await tx.$executeRaw`INSERT INTO booking_night (booking_id, night, price) VALUES (${created.id}::uuid, ${n.date}::date, ${n.price})`;
    }
    return ok({ token, bookingId: created.id, bookingCode: code, expiresAt, total: quote.value.total, currency: rt.currency, nights: quote.value.nights });
  });

interface HeldRow {
  id: string;
  room_type_id: string;
  check_in: string;
  check_out: string;
  code: string;
}

export interface GuestDetails {
  readonly guestName: string;
  readonly guestEmail: string;
  readonly guestPhone: string;
}

/**
 * Confirm wins only while the hold is still alive (`hold_expires_at > now`) and still `held`.
 * The conditional UPDATE takes the row lock, so confirm and expire can never both succeed.
 */
export const confirmHold = async (
  deps: HoldDeps & { manageUrl: (token: string) => string },
  token: string,
  guest: GuestDetails,
): Promise<Result<{ bookingId: string }, DomainError>> =>
  inTxResult(deps.db, async (tx) => {
    const now = deps.now();
    const hash = hashToken(token);
    const [row] = await tx.$queryRaw<HeldRow[]>`
      UPDATE booking SET status = 'confirmed', guest_name = ${guest.guestName}, guest_email = ${guest.guestEmail}, guest_phone = ${guest.guestPhone},
             hold_expires_at = NULL, updated_at = ${now}
      WHERE token_hash = ${hash} AND status = 'held' AND hold_expires_at > ${now}
      RETURNING id::text, code, room_type_id::text, check_in::text, check_out::text`;
    if (!row) {
      const [cur] = await tx.$queryRaw<{ status: string }[]>`SELECT status::text FROM booking WHERE token_hash = ${hash}`;
      if (!cur) return err(domainError('NOT_FOUND', 'Booking not found'));
      if (cur.status === 'held' || cur.status === 'expired') return err(domainError('HOLD_EXPIRED', 'The hold has expired, please search again'));
      return err(domainError('INVALID_STATUS', `Booking is already ${cur.status}`));
    }
    await convertHeldToSold(tx, {
      roomTypeId: row.room_type_id,
      nights: nightsOf(row.check_in, row.check_out),
      meta: { reason: 'confirm', docId: row.id, actor: 'guest' },
    });
    await tx.$executeRaw`
      INSERT INTO email_outbox ("to", subject, body) VALUES
      (${guest.guestEmail}, 'Your booking is confirmed', ${`Booking ${row.code}. Manage it: ${deps.manageUrl(token)}`})`;
    return ok({ bookingId: row.id });
  });

/** Expires one hold if it is due. Returns true only for the caller that won. */
export const expireHold = async (deps: Pick<HoldDeps, 'db' | 'now'>, bookingId: string): Promise<boolean> =>
  inTx(deps.db, async (tx) => {
    const now = deps.now();
    const [row] = await tx.$queryRaw<HeldRow[]>`
      UPDATE booking SET status = 'expired', updated_at = ${now}
      WHERE id = ${bookingId}::uuid AND status = 'held' AND hold_expires_at <= ${now}
      RETURNING id::text, code, room_type_id::text, check_in::text, check_out::text`;
    if (!row) return false;
    await release(tx, {
      roomTypeId: row.room_type_id,
      nights: nightsOf(row.check_in, row.check_out),
      kind: 'held',
      meta: { reason: 'hold_expired', docId: row.id, actor: 'system' },
    });
    return true;
  });

export const dueHoldIds = async (db: Db | Tx, now: Date, limit = 500): Promise<string[]> =>
  (await db.$queryRaw<{ id: string }[]>`
    SELECT id::text FROM booking WHERE status = 'held' AND hold_expires_at <= ${now} ORDER BY hold_expires_at LIMIT ${limit}`).map((r) => r.id);
