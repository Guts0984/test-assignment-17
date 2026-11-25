import type { ReactNode } from 'react';
import { formatDate, formatMoney } from '@/shared/lib';
import type { components } from '@/shared/api';

type BookingView = components['schemas']['BookingViewDto'];

export const BookingSummary = ({ booking }: { booking: BookingView }): ReactNode => (
  <div className="space-y-2" data-testid="booking-summary">
    <h2 className="text-lg font-semibold">
      {booking.hotel.name} · {booking.roomType.name}
    </h2>
    <p data-testid="booking-code">
      Booking <strong>{booking.code}</strong> · <span data-testid="booking-status">{booking.status}</span>
    </p>
    <p>
      {formatDate(booking.checkIn)} → {formatDate(booking.checkOut)} · {booking.guests} guest(s)
    </p>
    <ul className="text-sm text-slate-600">
      {booking.nights.map((n) => (
        <li key={n.date}>
          {formatDate(n.date)}: {formatMoney(n.price, booking.hotel.currency)}
        </li>
      ))}
    </ul>
    <p className="font-medium">Total: {formatMoney(booking.total, booking.hotel.currency)}</p>
  </div>
);
