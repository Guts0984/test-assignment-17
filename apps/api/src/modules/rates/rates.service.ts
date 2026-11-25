import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Db } from '@hotel/db';
import { addDays, domainError, ERROR_STATUS, MAX_RANGE_DAYS } from '@hotel/shared';
import { markChannelDirty } from '../channel/channel-notify';
import { CLOCK, DB, ENV, QUEUE, type Clock, type EnvValue } from '../../infra/tokens';
import { applyOverbookingAllowance, applyRates, applyRestrictions, hotelToday, loadGrid, roomTypeInHotel, type RestrictionPatch } from './repo/rates.repo';

const notFound = (m: string): HttpException => new HttpException(domainError('NOT_FOUND', m), ERROR_STATUS.NOT_FOUND);

@Injectable()
export class RatesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: EnvValue,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(QUEUE) private readonly queue: Queue,
  ) {}

  private dirty = (roomTypeId: string) =>
    markChannelDirty({ db: this.db, queue: this.queue, now: this.clock.now, debounceMs: this.env.CHANNEL_DEBOUNCE_MS, attempts: this.env.JOB_ATTEMPTS }, [roomTypeId]);

  private async guard(hotelId: string, roomTypeId: string, range?: { from: string; to: string }): Promise<void> {
    if (!(await roomTypeInHotel(this.db, hotelId, roomTypeId))) throw notFound('Room type not found in this hotel');
    if (!range) return;
    // prices and restrictions are for dates that can still be sold: not the past, and not decades ahead
    const today = (await hotelToday(this.db, hotelId)) ?? '1970-01-01';
    if (range.from < today) throw new HttpException(domainError('VALIDATION_ERROR', 'Rates and restrictions cannot be changed for dates in the past', { issues: [{ path: 'from', message: 'Choose today or a later date' }] }), ERROR_STATUS.VALIDATION_ERROR);
    if (range.to > addDays(today, MAX_RANGE_DAYS)) throw new HttpException(domainError('VALIDATION_ERROR', `Rates and restrictions can be set at most ${MAX_RANGE_DAYS} days ahead`, { issues: [{ path: 'to', message: `At most ${MAX_RANGE_DAYS} days ahead` }] }), ERROR_STATUS.VALIDATION_ERROR);
  }

  async setRates(hotelId: string, input: Parameters<typeof applyRates>[1]): Promise<{ updated: number }> {
    await this.guard(hotelId, input.roomTypeId, input);
    const updated = await applyRates(this.db, input);
    await this.dirty(input.roomTypeId);
    return { updated };
  }

  async setRestrictions(hotelId: string, input: RestrictionPatch): Promise<{ updated: number }> {
    await this.guard(hotelId, input.roomTypeId, input);
    const updated = await applyRestrictions(this.db, input);
    await this.dirty(input.roomTypeId);
    return { updated };
  }

  async setOverbooking(hotelId: string, roomTypeId: string, allowance: number) {
    await this.guard(hotelId, roomTypeId);
    const today = (await hotelToday(this.db, hotelId)) ?? '1970-01-01';
    const r = await applyOverbookingAllowance(this.db, hotelId, roomTypeId, allowance, today);
    if (r.ok) await this.dirty(roomTypeId);
    return r;
  }

  async grid(hotelId: string, from: string | undefined, days: number) {
    const today = await hotelToday(this.db, hotelId);
    if (!today) throw notFound('Hotel not found');
    return loadGrid(this.db, hotelId, from ?? today, days);
  }
}
