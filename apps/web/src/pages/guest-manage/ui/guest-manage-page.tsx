'use client';

import type { ReactNode } from 'react';
import { BookingSummary, useManagedBooking } from '@/entities/booking';
import { ManageActions } from '@/features/manage-booking';
import { Card, FormError } from '@/shared/ui';
import { formatMoney, toApiError } from '@/shared/lib';

export const GuestManagePage = ({ token }: { token: string }): ReactNode => {
  const q = useManagedBooking(token);
  if (q.error) return <main className="mx-auto max-w-xl p-4"><FormError message={toApiError(q.error).message} /></main>;
  if (!q.data) return <main className="p-4">Loading…</main>;
  const b = q.data;
  return (
    <main className="mx-auto max-w-xl space-y-4 p-4">
      <h1 className="text-2xl font-bold">Your booking</h1>
      <Card>
        <BookingSummary booking={b} />
        {b.penalty ? <p className="mt-2 text-red-700">Penalty charged: {formatMoney(b.penalty, b.hotel.currency)}</p> : null}
      </Card>
      <ManageActions token={token} booking={b} />
    </main>
  );
};
