import { addDays, diffDays, domainError, err, isRoomReady, nightsOf, ok, quoteStay, type DomainError, type Result, type RoomStatus } from '@hotel/shared';
import { inTxResult, type Db, type Tx } from './client';
import { loadBookingById, loadNights } from './bookings';
import { occupy, release } from './inventory';
import { mapRoomConflict } from './rooms';

interface Deps {
  readonly db: Db;
  readonly now: () => Date;
}

const lockBooking = (tx: Tx, id: string) => tx.$queryRaw<{ id: string }[]>`SELECT id::text FROM booking WHERE id = ${id}::uuid FOR UPDATE`;

/**
 * Moves a checked-in guest to another room of the same type for the remaining nights.
 * The assignment range is split: the old room keeps the nights up to today and becomes dirty.
 */
export const moveRoom = (deps: Deps, input: { bookingId: string; roomId: string; actor: string }): Promise<Result<{ from: string; to: string }, DomainError>> =>
  mapRoomConflict(() =>
    inTxResult(deps.db, async (tx) => {
      await lockBooking(tx, input.bookingId);
      const b = await loadBookingById(tx, input.bookingId);
      if (!b) return err(domainError('NOT_FOUND', 'Booking not found'));
      if (b.status !== 'checked_in') return err(domainError('INVALID_STATUS', 'Only a checked-in guest can move to another room'));
      const today = addDays(b.last_closed_date, 1);
      if (today >= b.check_out) return err(domainError('INVALID_STATUS', 'No nights are left to move'));
      const [room] = await tx.$queryRaw<{ id: string; hotel_id: string; room_type_id: string; status: RoomStatus }[]>`
        SELECT id::text, hotel_id::text, room_type_id::text, status::text FROM room WHERE id = ${input.roomId}::uuid FOR UPDATE`;
      if (!room || room.hotel_id !== b.hotel_id) return err(domainError('NOT_FOUND', 'Room not found'));
      if (room.room_type_id !== b.room_type_id) return err(domainError('VALIDATION_ERROR', 'Move within the same room type; use an upgrade for another type'));
      if (!isRoomReady(room.status)) return err(domainError('ROOM_NOT_READY', `The room is ${room.status}, only clean or inspected rooms can be occupied`));
      const [cur] = await tx.$queryRaw<{ room_id: string; from_date: string }[]>`
        SELECT room_id::text, lower(nights)::text AS from_date FROM room_assignment WHERE booking_id = ${b.id}::uuid AND upper(nights) = ${b.check_out}::date`;
      if (!cur) return err(domainError('ROOM_NOT_READY', 'The guest has no room to move from'));
      if (cur.room_id === room.id) return err(domainError('VALIDATION_ERROR', 'The guest is already in this room'));
      if (cur.from_date >= today) {
        await tx.$executeRaw`DELETE FROM room_assignment WHERE booking_id = ${b.id}::uuid AND room_id = ${cur.room_id}::uuid`;
      } else {
        await tx.$executeRaw`UPDATE room_assignment SET nights = daterange(${cur.from_date}::date, ${today}::date) WHERE booking_id = ${b.id}::uuid AND room_id = ${cur.room_id}::uuid`;
      }
      await tx.$executeRaw`INSERT INTO room_assignment (booking_id, room_id, nights) VALUES (${b.id}::uuid, ${room.id}::uuid, daterange(${today}::date, ${b.check_out}::date))`;
      await tx.$executeRaw`UPDATE room SET status = 'dirty' WHERE id = ${cur.room_id}::uuid`;
      return ok({ from: cur.room_id, to: room.id });
    }),
  );

/** Adds nights at the end of the stay in the same transaction; a failure rolls everything back. */
export const extendStay = (deps: Deps, input: { bookingId: string; checkOut: string; actor: string }): Promise<Result<{ total: number; added: number; roomTypeId: string }, DomainError>> =>
  mapRoomConflict(() =>
    inTxResult(deps.db, async (tx) => {
      await lockBooking(tx, input.bookingId);
      const b = await loadBookingById(tx, input.bookingId);
      if (!b) return err(domainError('NOT_FOUND', 'Booking not found'));
      if (b.status !== 'confirmed' && b.status !== 'checked_in') return err(domainError('INVALID_STATUS', 'Only a confirmed or checked-in booking can be extended'));
      if (input.checkOut <= b.check_out) return err(domainError('VALIDATION_ERROR', 'The new check-out must be after the current one'));
      if (diffDays(b.check_in, input.checkOut) > 30) return err(domainError('VALIDATION_ERROR', 'Stay is limited to 30 nights'));
      const added = nightsOf(b.check_out, input.checkOut);
      const rates = await tx.$queryRaw<{ night: string; price: number }[]>`
        SELECT night::text, price FROM rate WHERE room_type_id = ${b.room_type_id}::uuid AND night = ANY(${added as string[]}::date[])`;
      const priceMap = new Map(rates.map((r) => [r.night, r.price]));
      const quote = quoteStay(added, (d) => priceMap.get(d));
      if (!quote) return err(domainError('NO_AVAILABILITY', 'No rates for some of the new nights'));
      const [blocked] = await tx.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) n FROM restriction WHERE room_type_id = ${b.room_type_id}::uuid
          AND ((night = ANY(${added as string[]}::date[]) AND stop_sell) OR (night = ${input.checkOut}::date AND closed_to_departure))`;
      if (Number(blocked.n) > 0) return err(domainError('RESTRICTION_VIOLATED', 'Sales are closed for some of the new nights'));
      const occ = await occupy(tx, {
        roomTypeId: b.room_type_id, nights: added, kind: 'sold', allowOverbooking: false,
        meta: { reason: 'extend', docId: b.id, actor: input.actor },
      });
      if (!occ.ok) return occ;
      for (const n of quote.nights) {
        await tx.$executeRaw`INSERT INTO booking_night (booking_id, night, price, overbooked) VALUES (${b.id}::uuid, ${n.date}::date, ${n.price}, false)`;
      }
      await tx.$executeRaw`UPDATE room_assignment SET nights = daterange(lower(nights), ${input.checkOut}::date) WHERE booking_id = ${b.id}::uuid AND upper(nights) = ${b.check_out}::date`;
      const total = b.total_price + quote.total;
      await tx.$executeRaw`UPDATE booking SET check_out = ${input.checkOut}::date, total_price = ${total}, updated_at = ${deps.now()} WHERE id = ${b.id}::uuid`;
      return ok({ total, added: added.length, roomTypeId: b.room_type_id });
    }),
  );

/**
 * Moves an overbooked booking to a higher-class type of its hotel or to a type of another hotel of the chain
 * with free capacity. The locked nightly prices stay; the old nights (and their overbooked flags) are released.
 */
export const resolveOverbooking = (
  deps: Deps,
  input: { bookingId: string; roomTypeId: string; actor: string },
): Promise<Result<{ hotelId: string; roomTypeId: string; fromRoomTypeId: string }, DomainError>> =>
  inTxResult(deps.db, async (tx) => {
    await lockBooking(tx, input.bookingId);
    const b = await loadBookingById(tx, input.bookingId);
    if (!b) return err(domainError('NOT_FOUND', 'Booking not found'));
    if (b.status !== 'confirmed') return err(domainError('INVALID_STATUS', 'Only a confirmed booking can be re-seated'));
    if (!b.overbooking) return err(domainError('INVALID_STATUS', 'The booking is not overbooked'));
    const [target] = await tx.$queryRaw<{ hotel_id: string; rank: number; max_guests: number; currency: string }[]>`
      SELECT t.hotel_id::text, t.rank, t.max_guests, h.currency FROM room_type t JOIN hotel h ON h.id = t.hotel_id WHERE t.id = ${input.roomTypeId}::uuid`;
    if (!target) return err(domainError('NOT_FOUND', 'Room type not found'));
    const [own] = await tx.$queryRaw<{ rank: number }[]>`SELECT rank FROM room_type WHERE id = ${b.room_type_id}::uuid`;
    if (target.hotel_id === b.hotel_id && target.rank <= own.rank) return err(domainError('VALIDATION_ERROR', 'Pick a higher-class room type or another hotel'));
    if (target.currency !== b.currency) return err(domainError('VALIDATION_ERROR', 'The other hotel uses another currency'));
    if (target.max_guests < b.guests) return err(domainError('VALIDATION_ERROR', `At most ${target.max_guests} guests fit this room type`));
    const nights = await loadNights(tx, b.id);
    const keys = nights.map((n) => n.night);
    const occ = await occupy(tx, {
      roomTypeId: input.roomTypeId, nights: keys, kind: 'sold', allowOverbooking: false,
      meta: { reason: 'resolve_overbooking_occupy', docId: b.id, actor: input.actor },
    });
    if (!occ.ok) return occ;
    await release(tx, {
      roomTypeId: b.room_type_id, nights: keys, kind: 'sold', overbookedNights: nights.filter((n) => n.overbooked).map((n) => n.night),
      meta: { reason: 'resolve_overbooking_release', docId: b.id, actor: input.actor },
    });
    await tx.$executeRaw`UPDATE booking SET hotel_id = ${target.hotel_id}::uuid, room_type_id = ${input.roomTypeId}::uuid, overbooking = false, updated_at = ${deps.now()} WHERE id = ${b.id}::uuid`;
    await tx.$executeRaw`UPDATE booking_night SET overbooked = false WHERE booking_id = ${b.id}::uuid`;
    await tx.$executeRaw`DELETE FROM room_assignment WHERE booking_id = ${b.id}::uuid`;
    return ok({ hotelId: target.hotel_id, roomTypeId: input.roomTypeId, fromRoomTypeId: b.room_type_id });
  });
