'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Suspense, type ReactNode } from 'react';
import { DeskActions } from '@/features/frontdesk-actions';
import { FolioPanel } from '@/features/folio-panel';
import { StaffShell } from '@/widgets/staff-shell';
import { api, call } from '@/shared/api';
import { Card, FormError } from '@/shared/ui';
import { formatDate, formatMoney, toApiError, useLiveEvents } from '@/shared/lib';

const Content = ({ bookingId }: { bookingId: string }): ReactNode => {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['booking', bookingId], queryFn: () => call(api.GET('/api/bookings/{id}', { params: { path: { id: bookingId } } })) });
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['booking', bookingId] });
    void queryClient.invalidateQueries({ queryKey: ['folio', bookingId] });
    void queryClient.invalidateQueries({ queryKey: ['room-options', bookingId] });
  };
  useLiveEvents(q.data?.hotelId ?? '', ['frontdesk:changed'], refresh);
  if (q.error) return <FormError message={toApiError(q.error).message} />;
  if (!q.data) return <p>Loading…</p>;
  const b = q.data;
  return (
    <div className="space-y-3">
      <Link href="/staff/frontdesk" className="text-sm underline">← Back to the lists</Link>
      <Card>
        <h1 className="text-xl font-bold">
          {b.code} · <span data-testid="status">{b.status}</span>
        </h1>
        <p>
          {b.guestName ?? 'Guest'} · {b.guestEmail ?? ''} · {b.guests} guest(s) · {b.roomTypeName}
        </p>
        <p>
          {formatDate(b.checkIn)} → {formatDate(b.checkOut)} · total {formatMoney(b.total, b.currency)}
        </p>
        {b.penalty ? <p className="text-red-700">Penalty: {formatMoney(b.penalty, b.currency)}</p> : null}
      </Card>
      <DeskActions booking={b} onChanged={refresh} />
      <FolioPanel bookingId={b.id} onChanged={refresh} />
    </div>
  );
};

export const BookingDeskPage = ({ bookingId }: { bookingId: string }): ReactNode => (
  <Suspense fallback={null}>
    <StaffShell roles={['frontdesk', 'admin']}>{() => <Content bookingId={bookingId} />}</StaffShell>
  </Suspense>
);
