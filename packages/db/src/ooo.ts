import { diffDays, domainError, err, nightsOf, ok, type DomainError, type Result } from '@hotel/shared';
import { inTxResult, pgCode, type Db, type Tx } from './client';
import { lockNights } from './inventory';

interface Deps {
  readonly db: Db;
  readonly now: () => Date;
}

const shiftOoo = async (tx: Tx, roomTypeId: string, nights: readonly string[], delta: 1 | -1, docId: string, actor: string): Promise<void> => {
  for (const night of nights) {
    await tx.$executeRaw`UPDATE inventory SET ooo = ooo + ${delta} WHERE room_type_id = ${roomTypeId}::uuid AND night = ${night}::date`;
    await tx.$executeRaw`
      INSERT INTO inventory_journal (room_type_id, night, d_ooo, reason, doc_id, actor)
      VALUES (${roomTypeId}::uuid, ${night}::date, ${delta}, ${delta > 0 ? 'out_of_order' : 'out_of_order_end'}, ${docId}::uuid, ${actor})`;
  }
};

const conflict = async <T>(run: () => Promise<Result<T, DomainError>>): Promise<Result<T, DomainError>> => {
  try {
    return await run();
  } catch (e) {
    if (pgCode(e) === '23514') return err(domainError('CONFLICT', 'Not enough free rooms of this type: the nights are already sold'));
    throw e;
  }
};

/** Takes a room out of sale for [from, to): one ooo +1 per night with a journal row, nights locked in order. */
export const addOutOfOrder = (
  deps: Deps,
  input: { roomId: string; from: string; to: string; reason: string; actor: string; hotelDate: string },
): Promise<Result<{ id: string; nights: number }, DomainError>> =>
  conflict(() =>
    inTxResult(deps.db, async (tx) => {
      const [room] = await tx.$queryRaw<{ room_type_id: string }[]>`SELECT room_type_id::text FROM room WHERE id = ${input.roomId}::uuid FOR UPDATE`;
      if (!room) return err(domainError('NOT_FOUND', 'Room not found'));
      if (diffDays(input.from, input.to) > 366) return err(domainError('VALIDATION_ERROR', 'The period is limited to one year'));
      const nights = nightsOf(input.from, input.to);
      await lockNights(tx, room.room_type_id, nights);
      const [row] = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO room_out_of_order (room_id, from_date, to_date, reason, created_by)
        VALUES (${input.roomId}::uuid, ${input.from}::date, ${input.to}::date, ${input.reason}, ${input.actor}) RETURNING id::text`;
      await shiftOoo(tx, room.room_type_id, nights, 1, row.id, input.actor);
      if (input.from <= input.hotelDate && input.hotelDate < input.to) await tx.$executeRaw`UPDATE room SET status = 'out_of_order' WHERE id = ${input.roomId}::uuid`;
      return ok({ id: row.id, nights: nights.length });
    }),
  );

export const removeOutOfOrder = (
  deps: Deps,
  input: { roomId: string; oooId: string; actor: string; hotelDate: string },
): Promise<Result<{ nights: number; roomTypeId: string }, DomainError>> =>
  inTxResult(deps.db, async (tx) => {
    const [room] = await tx.$queryRaw<{ room_type_id: string }[]>`SELECT room_type_id::text FROM room WHERE id = ${input.roomId}::uuid FOR UPDATE`;
    if (!room) return err(domainError('NOT_FOUND', 'Room not found'));
    const [o] = await tx.$queryRaw<{ from_date: string; to_date: string }[]>`
      SELECT from_date::text, to_date::text FROM room_out_of_order WHERE id = ${input.oooId}::uuid AND room_id = ${input.roomId}::uuid`;
    if (!o) return err(domainError('NOT_FOUND', 'Out-of-order period not found'));
    const nights = nightsOf(o.from_date, o.to_date);
    await lockNights(tx, room.room_type_id, nights);
    await tx.$executeRaw`DELETE FROM room_out_of_order WHERE id = ${input.oooId}::uuid`;
    await shiftOoo(tx, room.room_type_id, nights, -1, input.oooId, input.actor);
    await tx.$executeRaw`
      UPDATE room SET status = 'dirty' WHERE id = ${input.roomId}::uuid AND status = 'out_of_order'
        AND NOT EXISTS (SELECT 1 FROM room_out_of_order WHERE room_id = ${input.roomId}::uuid AND from_date <= ${input.hotelDate}::date AND ${input.hotelDate}::date < to_date)`;
    return ok({ nights: nights.length, roomTypeId: room.room_type_id });
  });

