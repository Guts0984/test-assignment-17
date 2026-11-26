import { domainError, err, ok, type DomainError, type Result } from '@hotel/shared';
import type { Meta, Tx } from './client';

export interface NightRow {
  readonly night: string;
  readonly total: number;
  readonly ooo: number;
  readonly sold: number;
  readonly held: number;
  readonly overbooked: number;
}

export interface NightDelta {
  readonly night: string;
  readonly dSold: number;
  readonly dHeld: number;
  readonly dOverbooked: number;
}

/** Creates missing inventory rows (rooms + allowance, minus out-of-order periods) for the nights. */
export const ensureNights = async (tx: Tx, roomTypeId: string, nights: readonly string[]): Promise<void> => {
  await tx.$executeRaw`
    INSERT INTO inventory (room_type_id, night, total, ooo)
    SELECT ${roomTypeId}::uuid, n,
      (SELECT count(*) FROM room WHERE room_type_id = ${roomTypeId}::uuid)::int
        + (SELECT overbooking_allowance FROM room_type WHERE id = ${roomTypeId}::uuid),
      (SELECT count(*) FROM room_out_of_order o JOIN room r ON r.id = o.room_id
         WHERE r.room_type_id = ${roomTypeId}::uuid AND n >= o.from_date AND n < o.to_date)::int
    FROM unnest(${nights as string[]}::date[]) AS n
    ON CONFLICT DO NOTHING`;
};

/** Locks the nights' rows in ascending order, so concurrent bookings never deadlock. */
export const lockNights = async (tx: Tx, roomTypeId: string, nights: readonly string[]): Promise<NightRow[]> => {
  await ensureNights(tx, roomTypeId, nights);
  return tx.$queryRaw<NightRow[]>`
    SELECT night::text, total, ooo, sold, held, overbooked FROM inventory
    WHERE room_type_id = ${roomTypeId}::uuid AND night = ANY(${nights as string[]}::date[])
    ORDER BY night FOR UPDATE`;
};

/**
 * The channel's view of this room type is stale now. Written in the same transaction as the change, so a hold that
 * expires, a no-show or a cancel can never leave the channel with an old number (the worker pushes it).
 * The mark only moves forward: a push deletes marks up to the snapshot it read, and a long transaction (the night
 * audit) must not write a time older than a mark another request set meanwhile, or its change would be dropped.
 */
export const markChannelStale = (tx: Tx, roomTypeId: string): Promise<unknown> =>
  tx.$executeRaw`
    INSERT INTO channel_dirty (room_type_id, dirty_at)
    SELECT ${roomTypeId}::uuid, clock_timestamp() WHERE EXISTS (SELECT 1 FROM channel_room_type WHERE room_type_id = ${roomTypeId}::uuid)
    ON CONFLICT (room_type_id) DO UPDATE SET dirty_at = GREATEST(channel_dirty.dirty_at + interval '1 millisecond', EXCLUDED.dirty_at)`;

/** Writes counters and journal rows for the deltas. The caller already holds the row locks. */
export const applyDeltas = async (tx: Tx, roomTypeId: string, deltas: readonly NightDelta[], meta: Meta): Promise<void> => {
  if (deltas.length > 0) await markChannelStale(tx, roomTypeId);
  for (const d of deltas) {
    await tx.$executeRaw`
      UPDATE inventory SET sold = sold + ${d.dSold}, held = held + ${d.dHeld}, overbooked = overbooked + ${d.dOverbooked}
      WHERE room_type_id = ${roomTypeId}::uuid AND night = ${d.night}::date`;
    await tx.$executeRaw`
      INSERT INTO inventory_journal (room_type_id, night, d_sold, d_held, d_overbooked, reason, doc_id, actor)
      VALUES (${roomTypeId}::uuid, ${d.night}::date, ${d.dSold}, ${d.dHeld}, ${d.dOverbooked}, ${meta.reason}, ${meta.docId}::uuid, ${meta.actor})`;
  }
};

const free = (r: NightRow): number => r.total - r.ooo - (r.sold - r.overbooked + r.held);

export interface Occupation {
  readonly overbookedNights: readonly string[];
}

/**
 * Occupies all nights or none. A night without a free room fails the whole call,
 * unless `allowOverbooking` is set (channel bookings): those nights are accepted and marked overbooked.
 */
export const occupy = async (
  tx: Tx,
  input: { roomTypeId: string; nights: readonly string[]; kind: 'held' | 'sold'; allowOverbooking: boolean; meta: Meta },
): Promise<Result<Occupation, DomainError>> => {
  const rows = await lockNights(tx, input.roomTypeId, input.nights);
  const full = rows.filter((r) => free(r) < 1).map((r) => r.night);
  if (full.length > 0 && !input.allowOverbooking) {
    return err(domainError('NO_AVAILABILITY', 'No rooms left for some of the nights', { nights: full }));
  }
  const overbookedNights = new Set(full);
  const deltas = rows.map((r) => ({
    night: r.night,
    dSold: input.kind === 'sold' ? 1 : 0,
    dHeld: input.kind === 'held' ? 1 : 0,
    dOverbooked: overbookedNights.has(r.night) ? 1 : 0,
  }));
  await applyDeltas(tx, input.roomTypeId, deltas, input.meta);
  return ok({ overbookedNights: [...overbookedNights] });
};

/** Gives nights back. `overbookedNights` are the nights that were accepted as overbooking. */
export const release = async (
  tx: Tx,
  input: { roomTypeId: string; nights: readonly string[]; kind: 'held' | 'sold'; overbookedNights?: readonly string[]; meta: Meta },
): Promise<void> => {
  if (input.nights.length === 0) return;
  const rows = await lockNights(tx, input.roomTypeId, input.nights);
  const over = new Set(input.overbookedNights ?? []);
  await applyDeltas(
    tx,
    input.roomTypeId,
    rows.map((r) => ({
      night: r.night,
      dSold: input.kind === 'sold' ? -1 : 0,
      dHeld: input.kind === 'held' ? -1 : 0,
      dOverbooked: over.has(r.night) ? -1 : 0,
    })),
    input.meta,
  );
  await handOverFreedRooms(tx, input.roomTypeId, input.nights, input.meta);
};

/**
 * A room that becomes free on a night with accepted overbooking goes to an overbooked booking first (the oldest),
 * which then stops being overbooked. Called by every path that frees capacity: a release, a repair that ends, a higher
 * allowance. The booking that is releasing (`meta.docId`) is never picked: its own nights are leaving. Without this the counter would show a free room and the site or the channel
 * would sell it again, leaving two active bookings for one room.
 */
export const handOverFreedRooms = async (tx: Tx, roomTypeId: string, nights: readonly string[], meta: Meta): Promise<void> => {
  if (nights.length === 0) return;
  const rows = await tx.$queryRaw<NightRow[]>`
    SELECT night::text, total, ooo, sold, held, overbooked FROM inventory
    WHERE room_type_id = ${roomTypeId}::uuid AND night = ANY(${nights as string[]}::date[]) AND overbooked > 0 ORDER BY night`;
  for (const r of rows) {
    const promote = Math.min(r.overbooked, r.total - r.ooo - (r.sold - r.overbooked + r.held));
    if (promote < 1) continue;
    await applyDeltas(tx, roomTypeId, [{ night: r.night, dSold: 0, dHeld: 0, dOverbooked: -promote }], { ...meta, reason: 'overbooking_resolved' });
    await tx.$executeRaw`
      UPDATE booking_night SET overbooked = false
      WHERE (booking_id, night) IN (
        SELECT bn.booking_id, bn.night FROM booking_night bn JOIN booking b ON b.id = bn.booking_id
        WHERE b.room_type_id = ${roomTypeId}::uuid AND bn.night = ${r.night}::date AND bn.overbooked AND b.status IN ('confirmed', 'checked_in')
          AND b.id IS DISTINCT FROM ${meta.docId}::uuid
        ORDER BY b.created_at LIMIT ${promote})`;
  }
  if (rows.length > 0) {
    await tx.$executeRaw`
      UPDATE booking b SET overbooking = false
      WHERE b.room_type_id = ${roomTypeId}::uuid AND b.overbooking AND NOT EXISTS (SELECT 1 FROM booking_night n WHERE n.booking_id = b.id AND n.overbooked)`;
  }
};

/** Turns a hold into a sale on the same nights. */
export const convertHeldToSold = async (tx: Tx, input: { roomTypeId: string; nights: readonly string[]; meta: Meta }): Promise<void> => {
  const rows = await lockNights(tx, input.roomTypeId, input.nights);
  await applyDeltas(
    tx,
    input.roomTypeId,
    rows.map((r) => ({ night: r.night, dSold: 1, dHeld: -1, dOverbooked: 0 })),
    input.meta,
  );
};

export interface ConsistencyReport {
  readonly counterMismatches: readonly { roomTypeId: string; night: string }[];
  readonly negatives: number;
  readonly folioMismatches: readonly { bookingId: string }[];
}

/** Counters equal the journal sums; nothing negative; every storno exactly reverses its line (balance is always the sum of lines). */
export const checkConsistency = async (tx: Tx): Promise<ConsistencyReport> => {
  const counterMismatches = await tx.$queryRaw<{ roomTypeId: string; night: string }[]>`
    SELECT i.room_type_id::text AS "roomTypeId", i.night::text AS night
    FROM inventory i
    LEFT JOIN (SELECT room_type_id, night, sum(d_sold) s, sum(d_held) h, sum(d_overbooked) o
               FROM inventory_journal GROUP BY 1, 2) j USING (room_type_id, night)
    WHERE i.sold <> COALESCE(j.s, 0) OR i.held <> COALESCE(j.h, 0) OR i.overbooked <> COALESCE(j.o, 0)`;
  // ... and the counters must equal what the bookings really hold (a journal can agree with a counter and both be wrong)
  const bookingMismatches = await tx.$queryRaw<{ roomTypeId: string; night: string }[]>`
    SELECT i.room_type_id::text AS "roomTypeId", i.night::text AS night
    FROM inventory i
    LEFT JOIN (
      SELECT b.room_type_id, bn.night,
             count(*) FILTER (WHERE b.status IN ('confirmed', 'checked_in', 'checked_out')) AS s,
             count(*) FILTER (WHERE b.status = 'held') AS h,
             count(*) FILTER (WHERE bn.overbooked AND b.status IN ('confirmed', 'checked_in', 'checked_out')) AS o
      FROM booking_night bn JOIN booking b ON b.id = bn.booking_id GROUP BY 1, 2) x ON x.room_type_id = i.room_type_id AND x.night = i.night
    WHERE i.sold <> COALESCE(x.s, 0) OR i.held <> COALESCE(x.h, 0) OR i.overbooked <> COALESCE(x.o, 0)`;
  const neg = await tx.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) n FROM inventory WHERE sold < 0 OR held < 0 OR overbooked < 0`;
  const folioMismatches = await tx.$queryRaw<{ bookingId: string }[]>`
    SELECT s.booking_id::text AS "bookingId" FROM folio_line s
    JOIN folio_line o ON o.id = s.storno_of_id
    WHERE s.kind = 'storno' AND s.amount <> -o.amount`;
  return { counterMismatches: [...counterMismatches, ...bookingMismatches], negatives: Number(neg[0]?.n ?? 0), folioMismatches };
};
