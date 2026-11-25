import { HttpException, Inject, Injectable } from '@nestjs/common';
import { hash } from 'argon2';
import type { Queue } from 'bullmq';
import type { Db } from '@hotel/db';
import { domainError, ERROR_STATUS } from '@hotel/shared';
import type { StaffIdentity } from '../../common/auth/access';
import { toHttp, unwrap } from '../../common/http-error';
import { CLOCK, DB, ENV, QUEUE, type Clock, type EnvValue } from '../../infra/tokens';
import { dirtyRoomTypes } from '../frontdesk/channel-dirty';
import * as repo from './repo/admin.repo';

/** The whole /admin area is for chain-wide administrators (a grant with no hotel). */
export const requireChainAdmin = (staff: StaffIdentity): void => {
  if (!staff.roles.some((g) => g.role === 'admin' && g.hotelId === null)) {
    throw new HttpException(domainError('FORBIDDEN', 'Only a chain administrator can do this'), ERROR_STATUS.FORBIDDEN);
  }
};

@Injectable()
export class AdminService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: EnvValue,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(QUEUE) private readonly queue: Queue,
  ) {}

  createHotel(staff: StaffIdentity, body: Parameters<typeof repo.createHotel>[1]) {
    requireChainAdmin(staff);
    return repo.createHotel(this.db, body, this.clock.now()).then(unwrap);
  }

  async updateHotel(staff: StaffIdentity, id: string, body: Partial<repo.HotelInput>) {
    requireChainAdmin(staff);
    const h = await repo.updateHotel(this.db, id, body);
    if (!h) throw toHttp(domainError('NOT_FOUND', 'Hotel not found'));
    return h;
  }

  createRoomType(staff: StaffIdentity, hotelId: string, body: Parameters<typeof repo.createRoomType>[2]) {
    requireChainAdmin(staff);
    return repo.createRoomType(this.db, hotelId, body).then(unwrap);
  }

  createRoom(staff: StaffIdentity, hotelId: string, body: { roomTypeId: string; number: string }) {
    requireChainAdmin(staff);
    return repo.createRoom(this.db, hotelId, body).then(unwrap);
  }

  async listStaff(staff: StaffIdentity) {
    requireChainAdmin(staff);
    return { staff: await repo.listStaff(this.db) };
  }

  async createStaff(staff: StaffIdentity, body: { email: string; name: string; password: string; roles: readonly repo.Grant[] }) {
    requireChainAdmin(staff);
    const bad = await repo.validateGrants(this.db, body.roles);
    if (bad) throw toHttp(bad);
    return unwrap(await repo.createStaff(this.db, { email: body.email, name: body.name, passwordHash: await hash(body.password), roles: body.roles }));
  }

  async updateStaff(staff: StaffIdentity, id: string, body: { name?: string; password?: string; roles?: readonly repo.Grant[] }) {
    requireChainAdmin(staff);
    const bad = body.roles ? await repo.validateGrants(this.db, body.roles) : null;
    if (bad) throw toHttp(bad);
    const s = await repo.updateStaff(this.db, id, { name: body.name, roles: body.roles, passwordHash: body.password ? await hash(body.password) : undefined });
    if (!s) throw toHttp(domainError('NOT_FOUND', 'Staff member not found'));
    return s;
  }

  async getChannel(staff: StaffIdentity) {
    requireChainAdmin(staff);
    const rows = await this.db.channelRoomType.findMany({ select: { roomTypeId: true } });
    return { roomTypeIds: rows.map((r) => r.roomTypeId) };
  }

  async setChannel(staff: StaffIdentity, roomTypeIds: readonly string[]) {
    requireChainAdmin(staff);
    const ids = unwrap(await repo.replaceChannelTypes(this.db, roomTypeIds));
    await dirtyRoomTypes({ db: this.db, env: this.env, clock: this.clock, queue: this.queue }, ids);
    return { roomTypeIds: ids };
  }
}
