'use client';

import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { api, call, type components } from '@/shared/api';
import { Button, Card, FormError } from '@/shared/ui';
import { formatDate, useAction } from '@/shared/lib';

type Booking = components['schemas']['BookingDetailDto'];

/** Everything the front desk does to one booking. Errors from the API are shown as they are. */
export const DeskActions = ({ booking, onChanged }: { booking: Booking; onChanged: () => void }): ReactNode => {
  const action = useAction();
  const [extendTo, setExtendTo] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const id = booking.id;
  const live = booking.status === 'confirmed' || booking.status === 'checked_in';
  const options = useQuery({
    queryKey: ['room-options', id, booking.status],
    enabled: live,
    queryFn: () => call(api.GET('/api/bookings/{id}/room-options', { params: { path: { id } } })),
  });
  const grid = useQuery({
    queryKey: ['grid-types', booking.hotelId],
    enabled: booking.overbooking,
    queryFn: () => call(api.GET('/api/hotels/{hotelId}/grid', { params: { path: { hotelId: booking.hotelId }, query: { days: 1 } } })),
  });
  const done = (): void => onChanged();
  const pick = (roomId: string): Promise<{ data?: unknown; error?: unknown }> =>
    booking.status === 'checked_in'
      ? api.POST('/api/bookings/{id}/move-room', { params: { path: { id } }, body: { roomId } })
      : api.POST('/api/bookings/{id}/assign-room', { params: { path: { id } }, body: { roomId } });
  const assigned = booking.rooms.at(-1);
  const upgrades = options.data?.rooms.filter((r) => r.upgrade) ?? [];
  return (
    <Card>
      <h3 className="mb-2 font-semibold">Actions</h3>
      <FormError message={action.error} />
      {booking.overbooking ? (
        <div className="my-2 rounded border border-amber-300 bg-amber-50 p-3" data-testid="overbooking-notice">
          <p className="font-medium text-amber-800">Overbooked: the channel sold a night that was already sold out.</p>
          {upgrades.length > 0 ? <p className="text-sm">A free upgrade is available: pick a higher-class room below. It also moves the sale to that room type.</p> : <p className="text-sm">No free higher-class room right now.</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            {grid.data?.roomTypes.map((t) => (
              <Button key={t.roomTypeId} variant="ghost" disabled={action.busy || t.roomTypeId === booking.roomTypeId} onClick={() => void action.run(() => api.POST('/api/bookings/{id}/resolve-overbooking', { params: { path: { id } }, body: { roomTypeId: t.roomTypeId } }), done)}>
                Move to {t.name}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
      {live ? (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">Room {assigned ? `${assigned.number}` : '— not assigned'}{booking.status === 'checked_in' ? ' · pick a room below to move the guest' : ''}</p>
            <div className="mt-1 flex flex-wrap gap-2" data-testid="room-options">
              {options.data?.rooms.map((r) => (
                <Button key={r.roomId} variant="ghost" data-testid={`room-${r.number}`} disabled={action.busy} onClick={() => void action.run(() => pick(r.roomId), done)}>
                  {r.number} · {r.roomTypeName} · {r.status}
                  {r.upgrade ? ' · free upgrade' : ''}
                </Button>
              ))}
              {options.data && options.data.rooms.length === 0 ? <span className="text-sm text-slate-600">No free rooms for these nights.</span> : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {booking.status === 'confirmed' ? (
              <Button data-testid="check-in" disabled={action.busy} onClick={() => void action.run(() => api.POST('/api/bookings/{id}/check-in', { params: { path: { id } } }), done)}>
                Check in
              </Button>
            ) : (
              <Button data-testid="check-out" disabled={action.busy} onClick={() => void action.run(() => api.POST('/api/bookings/{id}/check-out', { params: { path: { id } } }), done)}>
                Check out
              </Button>
            )}
            {booking.status === 'confirmed' ? (
              confirmCancel ? (
                <>
                  <Button variant="danger" data-testid="confirm-cancel" disabled={action.busy} onClick={() => void action.run(() => api.POST('/api/bookings/{id}/cancel', { params: { path: { id } } }), done)}>
                    Yes, cancel (hotel policy penalty applies)
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmCancel(false)}>Keep</Button>
                </>
              ) : (
                <Button variant="danger" onClick={() => setConfirmCancel(true)}>Cancel booking</Button>
              )
            ) : null}
          </div>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void action.run(() => api.POST('/api/bookings/{id}/extend', { params: { path: { id } }, body: { checkOut: extendTo } }), done);
            }}
          >
            <label className="flex flex-col gap-1 text-sm font-medium">
              Extend stay to (now {formatDate(booking.checkOut)})
              <input type="date" className="rounded border border-slate-300 px-3 py-2 font-normal" value={extendTo} onChange={(e) => setExtendTo(e.target.value)} />
            </label>
            <Button type="submit" variant="ghost" disabled={action.busy || !extendTo}>Extend</Button>
          </form>
        </div>
      ) : (
        <p className="text-sm text-slate-600">This booking is {booking.status}; nothing to do.</p>
      )}
    </Card>
  );
};
