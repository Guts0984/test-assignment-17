import { addDays, domainError, err, isRoomReady, nightsOf, ok, type DomainError, type Result, type RoomStatus } from '@hotel/shared';
import { inTxResult, pgCode, type Db, type Tx } from './client';
import { folioBalance } from './folio';
import { loadBookingById, loadNights } from './bookings';
import { occupy, release } from './inventory';

interface Deps {
  readonly db: Db;
  readonly now: () => Date;
}

interface RoomRow {
  id: string;
  hotel_id: string;
  room_type_id: string;
  status: RoomStatus;
  rank: number;
}

const loadRoom = async (tx: Tx, roomId: string): Promise<RoomRow | undefined> =>
  (
    await tx.$queryRaw<RoomRow[]>`
      SELECT r.id::text, r.hotel_id::text, r.room_type_id::text, r.status::text, rt.rank FROM room r JOIN room_type rt ON rt.id = r.room_type_id WHERE r.id = ${roomId}::uuid`
  )[0];

const lockBooking = (tx: Tx, id: string) => tx.$queryRaw<{ id: string }[]>`SELECT id::text FROM booking WHERE id = ${id}::uuid FOR UPDATE`;

/** Mapping the exclusion constraint violation to a clean domain error. */
export const mapRoomConflict = async <T>(run: () => Promise<Result<T, DomainError>>): Promise<Result<T, DomainError>> => {
  try {
    return await run();
  } catch (e) {
    if (pgCode(e) === '23P01') return err(domainError('ROOM_TAKEN', 'This room is already taken for some of these nights'));
    throw e;
  }
};

/**
 * Assigns a physical room. A higher-class room is a free upgrade: the sale moves to that
 * room type (and the overbooking flag disappears). The EXCLUDE constraint prevents double assignment.
 */
export const assignRoom = (deps: Deps, input: { bookingId: string; roomId: string; actor: string }): Promise<Result<{ upgraded: boolean }, DomainError>> =>
  mapRoomConflict(() =>
    inTxResult(deps.db, async (tx) => {
      const [locked] = await lockBooking(tx, input.bookingId);
      const b = locked && (await loadBookingById(tx, input.bookingId));
      if (!b) return err(domainError('NOT_FOUND', 'Booking not found'));
      if (b.status !== 'confirmed' && b.status !== 'checked_in') return err(domainError('INVALID_STATUS', 'Only a confirmed or checked-in booking can get a room'));
      const room = await loadRoom(tx, input.roomId);
      if (!room || room.hotel_id !== b.hotel_id) return err(domainError('NOT_FOUND', 'Room not found'));
      if (room.status === 'out_of_order') return err(domainError('ROOM_NOT_READY', 'The room is out of order'));
      const [own] = await tx.$queryRaw<{ rank: number }[]>`SELECT rank FROM room_type WHERE id = ${b.room_type_id}::uuid`;
      if (room.rank < own.rank) return err(domainError('VALIDATION_ERROR', 'The room is of a lower class than the booking'));
      const upgraded = room.room_type_id !== b.room_type_id;
      if (upgraded) {
        const nights = await loadNights(tx, b.id);
        await release(tx, {
          roomTypeId: b.room_type_id, nights: nights.map((n) => n.night), kind: 'sold',
          overbookedNights: nights.filter((n) => n.overbooked).map((n) => n.night),
          meta: { reason: 'upgrade_release', docId: b.id, actor: input.actor },
        });
        const occ = await occupy(tx, {
          roomTypeId: room.room_type_id, nights: nights.map((n) => n.night), kind: 'sold', allowOverbooking: false,
          meta: { reason: 'upgrade_occupy', docId: b.id, actor: input.actor },
        });
        if (!occ.ok) return occ;
        await tx.$executeRaw`UPDATE booking SET room_type_id = ${room.room_type_id}::uuid, overbooking = false WHERE id = ${b.id}::uuid`;
        await tx.$executeRaw`UPDATE booking_night SET overbooked = false WHERE booking_id = ${b.id}::uuid`;
      }
      // Serialize on the room row first: two inserts racing into the exclusion constraint can deadlock.
      await tx.$queryRaw`SELECT id FROM room WHERE id = ${room.id}::uuid FOR UPDATE`;
      await tx.$executeRaw`DELETE FROM room_assignment WHERE booking_id = ${b.id}::uuid`;
      await tx.$executeRaw`INSERT INTO room_assignment (booking_id, room_id, nights) VALUES (${b.id}::uuid, ${room.id}::uuid, daterange(${b.check_in}::date, ${b.check_out}::date))`;
      return ok({ upgraded });
    }),
  );

export const checkIn = (deps: Deps, input: { bookingId: string; actor: string }): Promise<Result<true, DomainError>> =>
  inTxResult(deps.db, async (tx) => {
    await lockBooking(tx, input.bookingId);
    const b = await loadBookingById(tx, input.bookingId);
    if (!b) return err(domainError('NOT_FOUND', 'Booking not found'));
    const today = addDays(b.last_closed_date, 1);
    if (b.status !== 'confirmed') return err(domainError('INVALID_STATUS', 'Only a confirmed booking can check in'));
    if (b.check_in > today || b.check_out <= today) return err(domainError('INVALID_STATUS', `Check-in is possible from ${b.check_in} to the night before ${b.check_out}`));
    const [room] = await tx.$queryRaw<{ status: RoomStatus }[]>`
      SELECT r.status::text FROM room_assignment a JOIN room r ON r.id = a.room_id WHERE a.booking_id = ${b.id}::uuid`;
    if (!room) return err(domainError('ROOM_NOT_READY', 'Assign a room first'));
    if (!isRoomReady(room.status)) return err(domainError('ROOM_NOT_READY', `The room is ${room.status}, only clean or inspected rooms can be occupied`));
    await tx.$executeRaw`UPDATE booking SET status = 'checked_in', updated_at = ${deps.now()} WHERE id = ${b.id}::uuid AND status = 'confirmed'`;
    return ok(true);
  });

/** Check-out needs a zero balance. Leaving early releases the unused nights. */
export const checkOut = (deps: Deps, input: { bookingId: string; actor: string }): Promise<Result<{ earlyRelease: number }, DomainError>> =>
  inTxResult(deps.db, async (tx) => {
    await lockBooking(tx, input.bookingId);
    const b = await loadBookingById(tx, input.bookingId);
    if (!b) return err(domainError('NOT_FOUND', 'Booking not found'));
    if (b.status !== 'checked_in') return err(domainError('INVALID_STATUS', 'Only a checked-in booking can check out'));
    const balance = await folioBalance(tx, b.id);
    if (balance !== 0) return err(domainError('BALANCE_NOT_ZERO', `The balance is ${balance}, it must be zero to check out`, { balance }));
    const today = addDays(b.last_closed_date, 1);
    let early = 0;
    if (today === b.check_in && today < b.check_out) {
      // checked in and out on the arrival day: the guest did not stay a night, so every night goes back on sale and nothing is charged
      const all = await loadNights(tx, b.id);
      await release(tx, {
        roomTypeId: b.room_type_id, nights: all.map((n) => n.night), kind: 'sold', overbookedNights: all.filter((n) => n.overbooked).map((n) => n.night),
        meta: { reason: 'same_day_checkout', docId: b.id, actor: input.actor },
      });
      await tx.$executeRaw`DELETE FROM booking_night WHERE booking_id = ${b.id}::uuid`;
      await tx.$executeRaw`UPDATE booking SET total_price = 0 WHERE id = ${b.id}::uuid`;
      early = all.length;
    } else if (today < b.check_out && today > b.check_in) {
      const unused = nightsOf(today, b.check_out);
      const nights = (await loadNights(tx, b.id)).filter((n) => unused.includes(n.night));
      await release(tx, {
        roomTypeId: b.room_type_id, nights: unused, kind: 'sold', overbookedNights: nights.filter((n) => n.overbooked).map((n) => n.night),
        meta: { reason: 'early_checkout', docId: b.id, actor: input.actor },
      });
      await tx.$executeRaw`DELETE FROM booking_night WHERE booking_id = ${b.id}::uuid AND night >= ${today}::date`;
      await tx.$executeRaw`UPDATE booking SET check_out = ${today}::date, total_price = (SELECT COALESCE(sum(price), 0) FROM booking_night WHERE booking_id = ${b.id}::uuid) WHERE id = ${b.id}::uuid`;
      await tx.$executeRaw`UPDATE room_assignment SET nights = daterange(lower(nights), ${today}::date) WHERE booking_id = ${b.id}::uuid AND upper(nights) = ${b.check_out}::date`;
      early = unused.length;
    }
    await tx.$executeRaw`UPDATE booking SET status = 'checked_out', updated_at = ${deps.now()} WHERE id = ${b.id}::uuid AND status = 'checked_in'`;
    await tx.$executeRaw`UPDATE room SET status = 'dirty' WHERE id IN (SELECT room_id FROM room_assignment WHERE booking_id = ${b.id}::uuid)`;
    return ok({ earlyRelease: early });
  });
