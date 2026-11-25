'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { BookingSummary, useManagedBooking } from '@/entities/booking';
import { ConfirmForm } from '@/features/confirm-booking';
import { Card, FormError } from '@/shared/ui';
import { toApiError, useServerCountdown } from '@/shared/lib';

const clock = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export const GuestBookingPage = ({ token }: { token: string }): ReactNode => {
  const q = useManagedBooking(token);
  const left = useServerCountdown(q.data?.holdExpiresAt ?? null, q.data?.serverNow);
  if (q.error) return <main className="mx-auto max-w-xl p-4"><FormError message={toApiError(q.error).message} /></main>;
  if (!q.data) return <main className="p-4">Loading…</main>;
  const b = q.data;
  const expired = b.status === 'expired' || (b.status === 'held' && left === 0);
  return (
    <main className="mx-auto max-w-xl space-y-4 p-4">
      <Card>
        <BookingSummary booking={b} />
      </Card>
      {b.status === 'held' ? (
        <Card>
          <p className="mb-3 text-lg" data-testid="countdown">
            {expired ? 'The hold has expired.' : `Room held for ${left === null ? '…' : clock(left)}`}
          </p>
          {expired ? <Link className="underline" href="/">Search again</Link> : <ConfirmForm token={token} disabled={expired} />}
        </Card>
      ) : (
        <Card>
          <p>This booking is {b.status}. <Link className="underline" href={`/manage/${token}`}>Manage it</Link></p>
        </Card>
      )}
    </main>
  );
};
