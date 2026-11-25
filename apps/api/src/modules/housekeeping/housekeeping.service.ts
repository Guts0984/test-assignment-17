import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { addOutOfOrder, removeOutOfOrder, type Db } from '@hotel/db';
import { canRoomTransition, domainError, type DomainError, type Role, type RoomActor, type RoomStatus } from '@hotel/shared';
import { hasRole, type StaffIdentity } from '../../common/auth/access';
import { hideForeignHotel, requireHotel } from '../../common/auth/hotel-access';
import { toHttp, unwrap } from '../../common/http-error';
import { CLOCK, DB, ENV, QUEUE, type Clock, type EnvValue } from '../../infra/tokens';
import { dirtyRoomTypes } from '../frontdesk/channel-dirty';
import { hotelDateOf } from '../frontdesk/repo/frontdesk.repo';
import { assignHousekeeper, changeStatus, findRoom, isHousekeeperOf, listRooms, type RoomInfo } from './repo/housekeeping.repo';

const STAFF: readonly Role[] = ['housekeeper', 'head_housekeeper', 'admin'];
const HEADS: readonly Role[] = ['head_housekeeper', 'admin'];
const fail = (e: DomainError): HttpException => toHttp(e);

@Injectable()
export class HousekeepingService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: EnvValue,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(QUEUE) private readonly queue: Queue,
  ) {}

  private async room(staff: StaffIdentity, id: string, roles: readonly Role[]): Promise<RoomInfo> {
    const room = await findRoom(this.db, id);
    if (!room) throw fail(domainError('NOT_FOUND', 'Room not found'));
    hideForeignHotel(staff, room.hotelId, roles);
    return room;
  }

  /** Who the head housekeeper can give rooms to: people with a housekeeping role in this hotel. */
  async housekeepers(staff: StaffIdentity, hotelId: string) {
    requireHotel(staff, hotelId, HEADS);
    const rows = await this.db.$queryRaw<{ id: string; name: string }[]>`
      SELECT DISTINCT s.id::text, s.name FROM staff s JOIN staff_role r ON r.staff_id = s.id
      WHERE r.hotel_id = ${hotelId}::uuid AND r.role IN ('housekeeper', 'head_housekeeper') ORDER BY s.name`;
    return { housekeepers: rows };
  }

  async rooms(staff: StaffIdentity, hotelId: string) {
    requireHotel(staff, hotelId, STAFF);
    const hotelDate = await hotelDateOf(this.db, hotelId);
    if (!hotelDate) throw fail(domainError('NOT_FOUND', 'Hotel not found'));
    const sees = hasRole(staff, hotelId, HEADS);
    return { hotelDate, rooms: await listRooms(this.db, hotelId, hotelDate, sees ? null : staff.id) };
  }

  async setStatus(staff: StaffIdentity, id: string, to: Exclude<RoomStatus, 'out_of_order'>) {
    const room = await this.room(staff, id, STAFF);
    const head = hasRole(staff, room.hotelId, HEADS);
    if (!head && room.housekeeperId !== staff.id) throw fail(domainError('FORBIDDEN', 'This room is not assigned to you'));
    const actor: RoomActor = head ? 'head_housekeeper' : 'housekeeper';
    if (!canRoomTransition(room.status, to, actor)) {
      if (canRoomTransition(room.status, to, 'head_housekeeper')) throw fail(domainError('FORBIDDEN', 'Only the head housekeeper can do this'));
      throw fail(domainError('INVALID_STATUS', `A ${room.status} room cannot become ${to}`));
    }
    if (!(await changeStatus(this.db, id, room.status, to))) throw fail(domainError('INVALID_STATUS', 'The room status has just changed, reload it'));
    return { id, status: to };
  }

  async setHousekeeper(staff: StaffIdentity, id: string, housekeeperId: string | null) {
    const room = await this.room(staff, id, HEADS);
    if (housekeeperId !== null && !(await isHousekeeperOf(this.db, housekeeperId, room.hotelId))) {
      throw fail(domainError('VALIDATION_ERROR', 'The person is not a housekeeper of this hotel'));
    }
    await assignHousekeeper(this.db, id, housekeeperId);
    return { id, status: room.status };
  }

  private dirty = (roomTypeId: string) => dirtyRoomTypes({ db: this.db, env: this.env, clock: this.clock, queue: this.queue }, [roomTypeId]);

  async outOfOrder(staff: StaffIdentity, id: string, input: { from: string; to: string; reason: string }) {
    const room = await this.room(staff, id, HEADS);
    const hotelDate = (await hotelDateOf(this.db, room.hotelId)) ?? input.from;
    const r = unwrap(await addOutOfOrder({ db: this.db, now: this.clock.now }, { roomId: id, ...input, actor: staff.id, hotelDate }));
    await this.dirty(room.roomTypeId);
    return r;
  }

  async endOutOfOrder(staff: StaffIdentity, id: string, oooId: string) {
    const room = await this.room(staff, id, HEADS);
    const hotelDate = (await hotelDateOf(this.db, room.hotelId)) ?? '1970-01-01';
    const r = unwrap(await removeOutOfOrder({ db: this.db, now: this.clock.now }, { roomId: id, oooId, actor: staff.id, hotelDate }));
    await this.dirty(room.roomTypeId);
    return { id: oooId, nights: r.nights };
  }
}

