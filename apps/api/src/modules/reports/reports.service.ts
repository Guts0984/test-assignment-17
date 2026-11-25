import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { Db } from '@hotel/db';
import { domainError, ERROR_STATUS, type Report } from '@hotel/shared';
import { DB } from '../../infra/tokens';
import { withMetrics } from './domain/metrics';
import { loadBySource, loadByRoomType, type ReportFilter } from './repo/reports.repo';

@Injectable()
export class ReportsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async revenue(f: ReportFilter): Promise<Report> {
    const hotel = await this.db.hotel.findUnique({ where: { id: f.hotelId }, select: { currency: true } });
    if (!hotel) throw new HttpException(domainError('NOT_FOUND', 'Hotel not found'), ERROR_STATUS.NOT_FOUND);
    const [types, sources] = await Promise.all([loadByRoomType(this.db, f), loadBySource(this.db, f)]);
    const rows = types.map((t) => ({ roomTypeId: t.roomTypeId, name: t.name, ...withMetrics({ availableNights: Number(t.available), soldNights: Number(t.sold), revenue: Number(t.revenue) }) }));
    const total = withMetrics({
      availableNights: rows.reduce((s, r) => s + r.availableNights, 0),
      soldNights: rows.reduce((s, r) => s + r.soldNights, 0),
      revenue: rows.reduce((s, r) => s + r.revenue, 0),
    });
    return {
      from: f.from, to: f.to, currency: hotel.currency, total, byRoomType: rows,
      bySource: sources.map((s) => ({ source: s.source, bookings: Number(s.bookings), cancelled: Number(s.cancelled), noShows: Number(s.noShows), soldNights: Number(s.soldNights), revenue: Number(s.revenue) })),
    };
  }
}
