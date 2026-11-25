import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Request } from 'express';
import {
  cancelBooking,
  changeBooking,
  confirmHold,
  createHold,
  expireHold,
  inTx,
  quoteAndCheck,
  type Db,
} from '@hotel/db';
import { addDays, domainError, err, nightsOf, ok, ERROR_STATUS, type DomainError, type Result } from '@hotel/shared';
import { toHttp } from '../../common/http-error';
import { guestLinkLimiter } from '../../common/rate-limit/middlewares';
import type { CounterStore } from '../../common/rate-limit/store';
import { CLOCK, DB, ENV, HOLD_QUEUE, LIMITER_STORE, QUEUE, type Clock, type EnvValue } from '../../infra/tokens';
import { markChannelDirty } from '../channel/channel-notify';
import { toBookingView } from './domain/booking-view';
import { availableRooms } from './domain/search';
import { bundleById, bundleByToken, findHotel, inventoryFor, listHotels, roomTypesWithCapacity, type BookingBundle } from './repo/guest.repo';

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{22}$/;

@Injectable()
export class GuestService {
  private readonly limiter: ReturnType<typeof guestLinkLimiter>;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: EnvValue,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LIMITER_STORE) store: CounterStore,
    @Inject(QUEUE) private readonly queue: Queue,
    @Inject(HOLD_QUEUE) private readonly holdQueue: Queue,
  ) {
    this.limiter = guestLinkLimiter(store, env.GUEST_LINK_LOOKUPS_PER_MIN);
  }

  hotels = () => listHotels(this.db);

  private dirty = (roomTypeId: string): Promise<void> =>
    markChannelDirty({ db: this.db, queue: this.queue, now: this.clock.now, debounceMs: this.env.CHANNEL_DEBOUNCE_MS, attempts: this.env.JOB_ATTEMPTS }, [roomTypeId]);

  async search(q: { hotelId: string; checkIn: string; checkOut: string; guests: number }): Promise<Result<unknown, DomainError>> {
    const hotel = await findHotel(this.db, q.hotelId);
    if (!hotel) return err(domainError('NOT_FOUND', 'Hotel not found'));
    const [types, inventory] = await Promise.all([roomTypesWithCapacity(this.db, q.hotelId), inventoryFor(this.db, q.hotelId, q.checkIn, q.checkOut)]);
    const roomTypes = [];
    for (const t of types.filter((x) => x.maxGuests >= q.guests)) {
      const quote = await inTx(this.db, (tx) => quoteAndCheck(tx, { roomTypeId: t.id, checkIn: q.checkIn, checkOut: q.checkOut }));
      const violations = !quote.ok && quote.error.code === 'RESTRICTION_VIOLATED' ? (quote.error.details as { code: string; date: string; message: string }[]) : [];
      if (!quote.ok && violations.length === 0) continue;
      const available = availableRooms(t.capacity, q.checkIn, q.checkOut, inventory.filter((r) => r.roomTypeId === t.id));
      const nights = quote.ok ? quote.value.nights : await this.nightsOnly(t.id, q.checkIn, q.checkOut);
      roomTypes.push({
        roomTypeId: t.id, name: t.name, maxGuests: t.maxGuests, available,
        total: nights.reduce((s, n) => s + n.price, 0), nights: [...nights], violations,
      });
    }
    return ok({ hotel, roomTypes });
  }

  private async nightsOnly(roomTypeId: string, checkIn: string, checkOut: string): Promise<{ date: string; price: number }[]> {
    const rows = await this.db.$queryRaw<{ date: string; price: number }[]>`
      SELECT night::text AS date, price FROM rate WHERE room_type_id = ${roomTypeId}::uuid AND night = ANY(${nightsOf(checkIn, checkOut) as string[]}::date[]) ORDER BY night`;
    return rows;
  }

  async hold(input: { hotelId: string; roomTypeId: string; checkIn: string; checkOut: string; guests: number }) {
    const r = await createHold({ db: this.db, now: this.clock.now, holdMinutes: this.env.HOLD_MINUTES }, input);
    if (!r.ok) return r;
    await this.dirty(input.roomTypeId);
    const h = r.value;
    // at the moment the hold is due; the worker's reconciler re-creates this job if Redis loses it
    await this.holdQueue
      .add('expire', { bookingId: h.bookingId }, { jobId: `expire-${h.bookingId}`, delay: Math.max(0, h.expiresAt.getTime() - this.clock.now().getTime()), attempts: this.env.JOB_ATTEMPTS, backoff: { type: 'exponential', delay: 500 }, removeOnComplete: true, removeOnFail: false })
      .catch(() => undefined);
    return ok({
      token: h.token, bookingCode: h.bookingCode, expiresAt: h.expiresAt.toISOString(), serverNow: this.clock.now().toISOString(),
      total: h.total, currency: h.currency, nights: [...h.nights],
    });
  }

  /** Looks a booking up by its secret link. Unknown tokens count against the caller's IP. */
  async lookup(req: Pick<Request, 'ip' | 'socket'>, token: string): Promise<BookingBundle> {
    const blocked = await this.limiter.check(req).catch(() => null);
    if (blocked) throw toHttp(blocked);
    const found = TOKEN_SHAPE.test(token) ? await bundleByToken(this.db, token) : null;
    if (!found) {
      await this.limiter.recordMiss(req).catch(() => undefined);
      throw new HttpException(domainError('NOT_FOUND', 'Booking not found'), ERROR_STATUS.NOT_FOUND);
    }
    return found;
  }

  async confirm(req: Pick<Request, 'ip' | 'socket'>, token: string, guest: { guestName: string; guestEmail: string; guestPhone: string }) {
    const found = await this.lookup(req, token);
    const r = await confirmHold({ db: this.db, now: this.clock.now, holdMinutes: this.env.HOLD_MINUTES, manageUrl: (t) => `${this.env.PUBLIC_WEB_URL}/manage/${t}` }, token, guest);
    if (!r.ok) return r;
    await this.dirty(found.booking.room_type_id);
    const view = await this.view(token);
    return ok({ code: found.booking.code, manageUrl: `${this.env.PUBLIC_WEB_URL}/manage/${token}`, booking: view });
  }

  async view(token: string) {
    const b = await bundleByToken(this.db, token);
    if (!b) throw new HttpException(domainError('NOT_FOUND', 'Booking not found'), ERROR_STATUS.NOT_FOUND);
    return this.render(b);
  }

  render = (b: BookingBundle) => toBookingView(b.booking, b.nights, { hotelName: b.hotelName, roomTypeName: b.roomTypeName }, this.clock.now());

  async change(req: Pick<Request, 'ip' | 'socket'>, token: string, input: { checkIn: string; checkOut: string; guests: number }) {
    const found = await this.lookup(req, token);
    const r = await changeBooking({ db: this.db, now: this.clock.now }, { bookingId: found.booking.id, ...input, actor: 'guest' });
    if (!r.ok) return r;
    await this.dirty(found.booking.room_type_id);
    return ok(await this.view(token));
  }

  async cancel(req: Pick<Request, 'ip' | 'socket'>, token: string) {
    const found = await this.lookup(req, token);
    const r = await cancelBooking({ db: this.db, now: this.clock.now }, { bookingId: found.booking.id, actor: 'guest', hotelDate: addDays(found.booking.last_closed_date, 1) });
    if (!r.ok) return r;
    await this.dirty(found.booking.room_type_id);
    return ok(await this.view(token));
  }

  byId = (id: string) => bundleById(this.db, id);
  expire = (id: string) => expireHold({ db: this.db, now: this.clock.now }, id);
}
