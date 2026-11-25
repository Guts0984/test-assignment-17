import { HttpException, Inject, Injectable } from '@nestjs/common';
import { addFolioLine, inTxResult, stornoLine, type Db } from '@hotel/db';
import { domainError, err, ERROR_STATUS, ok, type Role } from '@hotel/shared';
import type { StaffIdentity } from '../../common/auth/access';
import { hideForeignHotel } from '../../common/auth/hotel-access';
import { unwrap } from '../../common/http-error';
import { DB } from '../../infra/tokens';
import { bookingCtx } from '../frontdesk/repo/frontdesk.repo';
import { loadFolio } from './repo/folio.repo';

const DESK: readonly Role[] = ['frontdesk', 'admin'];

@Injectable()
export class FolioService {
  constructor(@Inject(DB) private readonly db: Db) {}

  private async authorize(staff: StaffIdentity, bookingId: string) {
    const ctx = await bookingCtx(this.db, bookingId);
    if (!ctx) throw new HttpException(domainError('NOT_FOUND', 'Booking not found'), ERROR_STATUS.NOT_FOUND);
    hideForeignHotel(staff, ctx.hotelId, DESK);
    return ctx;
  }

  async get(staff: StaffIdentity, bookingId: string) {
    const ctx = await this.authorize(staff, bookingId);
    return { bookingId, currency: ctx.currency, ...(await loadFolio(this.db, bookingId)) };
  }

  async add(staff: StaffIdentity, bookingId: string, input: { kind: 'charge' | 'payment' | 'refund'; category: string; amount: number; note?: string }) {
    const ctx = await this.authorize(staff, bookingId);
    unwrap(
      await inTxResult(this.db, async (tx) => {
        if (ctx.status === 'held' || ctx.status === 'expired') return err(domainError('INVALID_STATUS', 'A held or expired booking has no folio'));
        // payments and refunds can still settle a finished stay or a penalty; new charges only belong to a live stay
        if (input.kind === 'charge' && ctx.status !== 'confirmed' && ctx.status !== 'checked_in') {
          return err(domainError('INVALID_STATUS', `Charges cannot be added to a booking that is ${ctx.status}`));
        }
        await addFolioLine(tx, { bookingId, ...input, hotelDate: ctx.hotelDate, actor: staff.id });
        return ok(true);
      }),
    );
    return { bookingId, currency: ctx.currency, ...(await loadFolio(this.db, bookingId)) };
  }

  async storno(staff: StaffIdentity, bookingId: string, lineId: string) {
    const ctx = await this.authorize(staff, bookingId);
    unwrap(await inTxResult(this.db, (tx) => stornoLine(tx, { bookingId, lineId, hotelDate: ctx.hotelDate, actor: staff.id })));
    return { bookingId, currency: ctx.currency, ...(await loadFolio(this.db, bookingId)) };
  }
}
