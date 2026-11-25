'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { changeBookingSchema } from '@hotel/shared';
import type { z } from 'zod';
import { managedBookingKey } from '@/entities/booking';
import { api, type components } from '@/shared/api';
import { Button, Card, FormError, TextField } from '@/shared/ui';
import { applyFieldErrors, formatInstant, formatMoney, toApiError } from '@/shared/lib';

type BookingView = components['schemas']['BookingViewDto'];
type Values = z.input<typeof changeBookingSchema>;

export const ManageActions = ({ token, booking }: { token: string; booking: BookingView }): ReactNode => {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(changeBookingSchema), values: { checkIn: booking.checkIn, checkOut: booking.checkOut, guests: booking.guests } });
  const refresh = (): Promise<void> => queryClient.invalidateQueries({ queryKey: managedBookingKey(token) });
  const change = form.handleSubmit(async (values) => {
    const r = await api.PATCH('/api/manage/{token}', { params: { path: { token } }, body: values });
    if (r.data) return refresh();
    const e = toApiError(r.error);
    if (!applyFieldErrors(e, form.setError)) form.setError('root', { message: e.message });
  });
  const cancel = async (): Promise<void> => {
    const r = await api.POST('/api/manage/{token}/cancel', { params: { path: { token } } });
    if (r.data) {
      setConfirming(false);
      return refresh();
    }
    setCancelError(toApiError(r.error).message);
  };
  if (booking.status !== 'confirmed') return null;
  const c = booking.cancellation;
  return (
    <div className="space-y-4">
      <Card>
        <h3 className="mb-2 font-semibold">Change dates or guests</h3>
        <form onSubmit={change} className="grid gap-3 sm:grid-cols-4 sm:items-end" noValidate>
          <TextField label="Check-in" type="date" error={form.formState.errors.checkIn?.message} {...form.register('checkIn')} />
          <TextField label="Check-out" type="date" error={form.formState.errors.checkOut?.message} {...form.register('checkOut')} />
          <TextField label="Guests" type="number" min={1} error={form.formState.errors.guests?.message} {...form.register('guests', { valueAsNumber: true })} />
          <Button type="submit" disabled={form.formState.isSubmitting}>
            Change
          </Button>
        </form>
        <div className="mt-2">
          <FormError message={form.formState.errors.root?.message ?? null} />
        </div>
      </Card>
      <Card>
        <h3 className="mb-2 font-semibold">Cancel</h3>
        <p data-testid="cancel-preview" className={c.free ? 'text-green-700' : 'text-red-700'}>
          {c.free
            ? `Free cancellation until ${formatInstant(c.deadline, booking.hotel.timezone)}.`
            : `The free period ended ${formatInstant(c.deadline, booking.hotel.timezone)}. Cancelling now costs ${formatMoney(c.penalty, booking.hotel.currency)} (the first night).`}
        </p>
        {confirming ? (
          <div className="mt-3 flex gap-2">
            <Button variant="danger" data-testid="confirm-cancel" onClick={() => void cancel()}>
              Yes, cancel{c.free ? '' : ` and pay ${formatMoney(c.penalty, booking.hotel.currency)}`}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Keep booking
            </Button>
          </div>
        ) : (
          <Button className="mt-3" variant="danger" data-testid="cancel" onClick={() => setConfirming(true)}>
            Cancel booking
          </Button>
        )}
        <div className="mt-2">
          <FormError message={cancelError} />
        </div>
      </Card>
    </div>
  );
};
