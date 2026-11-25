'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createHotelSchema } from '@hotel/shared';
import type { z } from 'zod';
import { api } from '@/shared/api';
import { Button, Card, FormError, TextField } from '@/shared/ui';
import { applyFieldErrors, toApiError } from '@/shared/lib';

type Values = z.input<typeof createHotelSchema>;

export const HotelAdmin = (): ReactNode => {
  const queryClient = useQueryClient();
  const [created, setCreated] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(createHotelSchema),
    defaultValues: { code: '', name: '', timezone: 'Europe/Kyiv', currency: 'UAH', checkInTime: '14:00', checkOutTime: '12:00', auditTime: '03:00', cancelFreeDays: 2, cancelFreeUntil: '14:00' },
  });
  const submit = form.handleSubmit(async (v) => {
    const r = await api.POST('/api/admin/hotels', { body: v as Required<Values> });
    if (r.data) {
      setCreated(`Created ${r.data.name}`);
      form.reset();
      return queryClient.invalidateQueries({ queryKey: ['hotels'] });
    }
    const e = toApiError(r.error);
    if (!applyFieldErrors(e, form.setError)) form.setError('root', { message: e.message });
  });
  const f = form.formState.errors;
  return (
    <Card>
      <h2 className="mb-2 text-lg font-semibold">New hotel</h2>
      <form onSubmit={submit} className="grid gap-2 sm:grid-cols-4 sm:items-end" noValidate>
        <TextField label="Code" error={f.code?.message} {...form.register('code')} />
        <TextField label="Name" error={f.name?.message} {...form.register('name')} />
        <TextField label="Time zone" error={f.timezone?.message} {...form.register('timezone')} />
        <div className="flex flex-col gap-1">
          <label htmlFor="currency" className="text-sm font-medium">Currency</label>
          <select id="currency" className="rounded border border-slate-300 px-3 py-2" {...form.register('currency')}>
            {['UAH', 'PLN', 'EUR'].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <TextField label="Check-in from" error={f.checkInTime?.message} {...form.register('checkInTime')} />
        <TextField label="Check-out until" error={f.checkOutTime?.message} {...form.register('checkOutTime')} />
        <TextField label="Night audit at" error={f.auditTime?.message} {...form.register('auditTime')} />
        <TextField label="Free cancel, days before" type="number" error={f.cancelFreeDays?.message} {...form.register('cancelFreeDays', { valueAsNumber: true })} />
        <TextField label="Free cancel until" error={f.cancelFreeUntil?.message} {...form.register('cancelFreeUntil')} />
        <Button type="submit" disabled={form.formState.isSubmitting}>Create hotel</Button>
      </form>
      <FormError message={f.root?.message ?? null} />
      {created ? <p role="status" className="mt-2 text-green-700">{created}</p> : null}
    </Card>
  );
};
