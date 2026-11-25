import type { BookingNightRow, BookingRow } from '@hotel/db';
import { quoteCancellation } from '@hotel/db';

export interface ViewContext {
  readonly hotelName: string;
  readonly roomTypeName: string;
}

export const toBookingView = (b: BookingRow, nights: readonly BookingNightRow[], ctx: ViewContext, now: Date) => {
  const quote = quoteCancellation(b, nights, now);
  return {
    code: b.code,
    status: b.status as 'held' | 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled' | 'no_show' | 'expired',
    hotel: { id: b.hotel_id, name: ctx.hotelName, timezone: b.timezone, currency: b.currency },
    roomType: { id: b.room_type_id, name: ctx.roomTypeName },
    checkIn: b.check_in,
    checkOut: b.check_out,
    guests: b.guests,
    guestName: b.guest_name,
    total: b.total_price,
    nights: nights.map((n) => ({ date: n.night, price: n.price })),
    holdExpiresAt: b.hold_expires_at ? b.hold_expires_at.toISOString() : null,
    serverNow: now.toISOString(),
    cancellation: { deadline: quote.deadline, free: quote.free, penalty: quote.penalty },
    penalty: b.penalty,
  };
};
