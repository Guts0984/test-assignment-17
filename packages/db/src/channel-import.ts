import { addDays, domainError, err, nightsOf, ok, type ChannelEvent, type ChannelEventResult, type DomainError, type Result } from '@hotel/shared';
import { cancelBooking, changeBooking, loadBookingById, type BookingRow } from './bookings';
import { inTx, type Db, type Tx } from './client';
import { hashToken, newBookingCode, newToken } from './ids';
import { occupy } from './inventory';

export interface ImportDeps {
  readonly db: Db;
  readonly now: () => Date;
}

export interface ImportOutcome {
  readonly result: Result<ChannelEventResult, DomainError>;
  readonly roomTypeId: string;
}

type Applied = Result<ChannelEventResult, DomainError>;

const view = (result: ChannelEventResult['result'], b: Pick<BookingRow, 'code' | 'overbooking'> | undefined): Applied =>
  ok({ result, bookingCode: b?.code ?? null, overbooking: b?.overbooking ?? false });

const lockRef = (tx: Tx, ref: string): Promise<unknown> => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ref}))`;

const findByRef = async (tx: Tx, ref: string): Promise<(BookingRow & { channel_version: number }) | undefined> => {
  const [row] = await tx.$queryRaw<{ id: string; channel_version: number }[]>`SELECT id::text, COALESCE(channel_version, 0) AS channel_version FROM booking WHERE channel_ref = ${ref}`;
  const b = row ? await loadBookingById(tx, row.id) : undefined;
  return b && row ? { ...b, channel_version: row.channel_version } : undefined;
};

/** Scope check: the channel sees only connected room types of the given hotel. */
export const inChannelScope = async (db: Db, hotelId: string, roomTypeId: string): Promise<boolean> =>
  (await db.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) n FROM channel_room_type c JOIN room_type r ON r.id = c.room_type_id WHERE c.room_type_id = ${roomTypeId}::uuid AND r.hotel_id = ${hotelId}::uuid`)[0]?.n === 1n;

const createBooking = async (tx: Tx, now: Date, ev: ChannelEvent): Promise<Result<BookingRow, DomainError>> => {
  const [rt] = await tx.$queryRaw<{ currency: string; max_guests: number; last_closed_date: string }[]>`
    SELECT h.currency, r.max_guests, h.last_closed_date::text FROM room_type r JOIN hotel h ON h.id = r.hotel_id WHERE r.id = ${ev.roomTypeId}::uuid`;
  if (!rt) return err(domainError('NOT_FOUND', 'Room type not found'));
  if (ev.guests > rt.max_guests) return err(domainError('VALIDATION_ERROR', `At most ${rt.max_guests} guests fit this room type`));
  if (ev.checkIn < addDays(rt.last_closed_date, 1)) return err(domainError('VALIDATION_ERROR', 'Check-in date is in the past'));
  const nights = nightsOf(ev.checkIn, ev.checkOut);
  const rates = await tx.$queryRaw<{ night: string; price: number }[]>`
    SELECT night::text, price FROM rate WHERE room_type_id = ${ev.roomTypeId}::uuid AND night = ANY(${nights as string[]}::date[])`;
  const price = new Map(rates.map((r) => [r.night, r.price]));
  if (nights.some((n) => !price.has(n))) return err(domainError('RESTRICTION_VIOLATED', 'No rates for some of the nights'));
  const total = nights.reduce((s, n) => s + (price.get(n) ?? 0), 0);
  const [created] = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO booking (code, hotel_id, room_type_id, check_in, check_out, guests, status, source, channel_ref, channel_version, guest_name, guest_email, total_price, currency, token_hash, created_at, updated_at)
    VALUES (${newBookingCode()}, ${ev.hotelId}::uuid, ${ev.roomTypeId}::uuid, ${ev.checkIn}::date, ${ev.checkOut}::date, ${ev.guests}, 'confirmed', 'channel', ${ev.channelRef}, ${ev.version},
            ${ev.guestName ?? null}, ${ev.guestEmail ?? null}, ${total}, ${rt.currency}, ${hashToken(newToken())}, ${now}, ${now})
    RETURNING id::text`;
  if (!created) return err(domainError('INTERNAL', 'Booking was not created'));
  const occ = await occupy(tx, { roomTypeId: ev.roomTypeId, nights, kind: 'sold', allowOverbooking: true, meta: { reason: 'channel_new', docId: created.id, actor: 'channel' } });
  if (!occ.ok) return occ;
  const over = new Set(occ.value.overbookedNights);
  for (const n of nights) {
    await tx.$executeRaw`INSERT INTO booking_night (booking_id, night, price, overbooked) VALUES (${created.id}::uuid, ${n}::date, ${price.get(n) ?? 0}, ${over.has(n)})`;
  }
  await tx.$executeRaw`UPDATE booking SET overbooking = ${over.size > 0} WHERE id = ${created.id}::uuid`;
  const b = await loadBookingById(tx, created.id);
  return b ? ok(b) : err(domainError('INTERNAL', 'Booking vanished'));
};

/** Applies a modify or cancel of a higher version. Both db functions run their own transaction, so the caller holds only the advisory lock. */
const applyChange = async (deps: ImportDeps, tx: Tx, b: BookingRow, ev: Pick<ChannelEvent, 'type' | 'version' | 'checkIn' | 'checkOut' | 'guests'>): Promise<Applied> => {
  const done = async (kind: ChannelEventResult['result']): Promise<Applied> => {
    await tx.$executeRaw`UPDATE booking SET channel_version = ${ev.version} WHERE id = ${b.id}::uuid`;
    return view(kind, (await loadBookingById(tx, b.id)) ?? b);
  };
  if (ev.type === 'cancel') {
    const r = await cancelBooking(deps, { bookingId: b.id, actor: 'channel', hotelDate: addDays(b.last_closed_date, 1) });
    if (r.ok || b.status === 'cancelled') return done('cancelled');
    return err(r.error);
  }
  const r = await changeBooking(deps, { bookingId: b.id, checkIn: ev.checkIn, checkOut: ev.checkOut, guests: ev.guests, actor: 'channel' });
  if (r.ok) return done('updated');
  if (r.error.code === 'INVALID_STATUS') return done('stale');
  return err(r.error);
};

const pendingFor = async (tx: Tx, ref: string, above: number): Promise<ChannelEvent | undefined> => {
  const [p] = await tx.$queryRaw<{ payload: ChannelEvent }[]>`SELECT payload FROM channel_pending_event WHERE channel_ref = ${ref} AND version > ${above}`;
  return p?.payload;
};

/** The change that arrived before its booking is applied right after the booking exists. */
const applyPending = (deps: ImportDeps, ref: string): Promise<Applied | null> =>
  inTx(deps.db, async (tx) => {
    await lockRef(tx, ref);
    const b = await findByRef(tx, ref);
    const p = b ? await pendingFor(tx, ref, b.channel_version) : undefined;
    if (!b || !p) return null;
    const r = await applyChange(deps, tx, b, p);
    if (r.ok) await tx.$executeRaw`DELETE FROM channel_pending_event WHERE channel_ref = ${ref} AND version <= ${p.version}`;
    return r;
  });

/** One channel event, idempotent per (channelRef, version). */
export const importChannelEvent = async (deps: ImportDeps, ev: ChannelEvent): Promise<ImportOutcome> => {
  const step = await inTx(deps.db, async (tx): Promise<{ done: Applied } | { created: BookingRow }> => {
    await lockRef(tx, ev.channelRef);
    const b = await findByRef(tx, ev.channelRef);
    if (!b) {
      if (ev.type !== 'new') {
        await tx.$executeRaw`
          INSERT INTO channel_pending_event (channel_ref, version, type, payload) VALUES (${ev.channelRef}, ${ev.version}, ${ev.type}, ${JSON.stringify(ev)}::jsonb)
          ON CONFLICT (channel_ref) DO UPDATE SET version = EXCLUDED.version, type = EXCLUDED.type, payload = EXCLUDED.payload, received_at = now()
          WHERE channel_pending_event.version < EXCLUDED.version`;
        return { done: view('pending', undefined) };
      }
      const created = await createBooking(tx, deps.now(), ev);
      if (!created.ok) throw Object.assign(new Error(created.error.message), { domain: created.error });
      return { created: created.value };
    }
    if (ev.type === 'new' || ev.version <= b.channel_version) return { done: view('stale', b) };
    return { done: await applyChange(deps, tx, b, ev) };
  }).catch((e: unknown): { done: Applied } => {
    const d = (e as { domain?: DomainError }).domain;
    if (d) return { done: err(d) };
    throw e;
  });
  if ('done' in step) return { result: step.done, roomTypeId: ev.roomTypeId };
  const after = await applyPending(deps, ev.channelRef);
  if (after && after.ok) return { result: after, roomTypeId: ev.roomTypeId };
  return { result: view('created', step.created), roomTypeId: ev.roomTypeId };
};
