import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { assignRoom, cancelBooking, checkIn, checkOut, extendStay, moveRoom, resolveOverbooking, type Db } from '@hotel/db';
import { domainError, ERROR_STATUS, type Role } from '@hotel/shared';
import type { StaffIdentity } from '../../common/auth/access';
import { hideForeignHotel, requireHotel } from '../../common/auth/hotel-access';
import { unwrap } from '../../common/http-error';
import { CLOCK, DB, ENV, QUEUE, type Clock, type EnvValue } from '../../infra/tokens';
import { dirtyRoomTypes } from './channel-dirty';
import { bookingCtx, bookingDetail, hotelDateOf, listDesk, roomOptions, searchDesk, type BookingCtx } from './repo/frontdesk.repo';

const DESK: readonly Role[] = ['frontdesk', 'admin'];
const notFound = (m: string): HttpException => new HttpException(domainError('NOT_FOUND', m), ERROR_STATUS.NOT_FOUND);

@Injectable()
export class FrontdeskService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: EnvValue,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(QUEUE) private readonly queue: Queue,
  ) {}

  private deps = () => ({ db: this.db, now: this.clock.now });
  private dirty = (ids: readonly string[]) => dirtyRoomTypes({ db: this.db, env: this.env, clock: this.clock, queue: this.queue }, ids);

  /** A booking of a hotel the staff member cannot work in looks like a missing booking. */
  async authorize(staff: StaffIdentity, bookingId: string): Promise<BookingCtx> {
    const ctx = await bookingCtx(this.db, bookingId);
    if (!ctx) throw notFound('Booking not found');
    hideForeignHotel(staff, ctx.hotelId, DESK);
    return ctx;
  }

  async desk(staff: StaffIdentity, hotelId: string, view: string, q: string | undefined) {
    requireHotel(staff, hotelId, DESK);
    const hotelDate = await hotelDateOf(this.db, hotelId);
    if (!hotelDate) throw notFound('Hotel not found');
    return { hotelDate, view, bookings: await listDesk(this.db, hotelId, view, hotelDate, q) };
  }

  async search(staff: StaffIdentity, hotelId: string, q: string) {
    requireHotel(staff, hotelId, DESK);
    return { bookings: await searchDesk(this.db, hotelId, q) };
  }

  async detail(staff: StaffIdentity, id: string) {
    await this.authorize(staff, id);
    return bookingDetail(this.db, id);
  }

  async options(staff: StaffIdentity, id: string) {
    await this.authorize(staff, id);
    return { rooms: (await roomOptions(this.db, id)) ?? [] };
  }

  async assign(staff: StaffIdentity, id: string, roomId: string) {
    const ctx = await this.authorize(staff, id);
    const r = unwrap(await assignRoom(this.deps(), { bookingId: id, roomId, actor: staff.id }));
    if (r.upgraded) await this.dirty([ctx.roomTypeId]);
    return r;
  }

  async checkIn(staff: StaffIdentity, id: string) {
    await this.authorize(staff, id);
    unwrap(await checkIn(this.deps(), { bookingId: id, actor: staff.id }));
    return { ok: true as const };
  }

  async checkOut(staff: StaffIdentity, id: string) {
    const ctx = await this.authorize(staff, id);
    const r = unwrap(await checkOut(this.deps(), { bookingId: id, actor: staff.id }));
    if (r.earlyRelease > 0) await this.dirty([ctx.roomTypeId]);
    return r;
  }

  async move(staff: StaffIdentity, id: string, roomId: string) {
    await this.authorize(staff, id);
    unwrap(await moveRoom(this.deps(), { bookingId: id, roomId, actor: staff.id }));
    return { ok: true as const };
  }

  async extend(staff: StaffIdentity, id: string, newCheckOut: string) {
    await this.authorize(staff, id);
    const r = unwrap(await extendStay(this.deps(), { bookingId: id, checkOut: newCheckOut, actor: staff.id }));
    await this.dirty([r.roomTypeId]);
    return { total: r.total, added: r.added };
  }

  async cancel(staff: StaffIdentity, id: string) {
    const ctx = await this.authorize(staff, id);
    const r = unwrap(await cancelBooking(this.deps(), { bookingId: id, actor: staff.id, hotelDate: ctx.hotelDate }));
    await this.dirty([ctx.roomTypeId]);
    return r;
  }

  async resolve(staff: StaffIdentity, id: string, roomTypeId: string, hotelId: string | undefined) {
    const ctx = await this.authorize(staff, id);
    const [target] = await this.db.$queryRaw<{ hotel_id: string }[]>`SELECT hotel_id::text FROM room_type WHERE id = ${roomTypeId}::uuid`;
    if (!target) throw notFound('Room type not found');
    if (hotelId !== undefined && hotelId !== target.hotel_id) throw notFound('Room type not found in this hotel');
    if (target.hotel_id !== ctx.hotelId) requireHotel(staff, target.hotel_id, DESK);
    const r = unwrap(await resolveOverbooking(this.deps(), { bookingId: id, roomTypeId, actor: staff.id }));
    await this.dirty([ctx.roomTypeId, roomTypeId]);
    return { hotelId: r.hotelId, roomTypeId: r.roomTypeId };
  }
}
