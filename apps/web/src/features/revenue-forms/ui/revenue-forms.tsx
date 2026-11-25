'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { setOverbookingSchema, setRatesSchema, setRestrictionsSchema, uuid, WEEKEND_NIGHTS } from '@hotel/shared';
import type { z } from 'zod';
import { api } from '@/shared/api';
import { Button, Card, FormError, TextField } from '@/shared/ui';
import { applyFieldErrors, toApiError } from '@/shared/lib';

interface RoomTypeOption {
  readonly roomTypeId: string;
  readonly name: string;
}

const optionalNumber = (v: unknown): number | undefined => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? undefined : Number(v));

const RoomTypeSelect = ({ types, error, ...rest }: { types: readonly RoomTypeOption[]; error?: string } & React.SelectHTMLAttributes<HTMLSelectElement>): ReactNode => (
  <div className="flex flex-col gap-1">
    <label className="text-sm font-medium text-slate-700" htmlFor={rest.name}>
      Room type
    </label>
    <select id={rest.name} className="rounded border border-slate-300 px-3 py-2" {...rest}>
      <option value="">Choose…</option>
      {types.map((t) => (
        <option key={t.roomTypeId} value={t.roomTypeId}>
          {t.name}
        </option>
      ))}
    </select>
    {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
  </div>
);

export const RevenueForms = ({ hotelId, types, onChanged }: { hotelId: string; types: readonly RoomTypeOption[]; onChanged: () => void }): ReactNode => {
  const queryClient = useQueryClient();
  const [done, setDone] = useState<string | null>(null);
  const finish = (msg: string): void => {
    setDone(msg);
    onChanged();
    void queryClient.invalidateQueries({ queryKey: ['grid', hotelId] });
  };

  type Rates = z.input<typeof setRatesSchema> & { weekend?: boolean };
  const rates = useForm<Rates>({ resolver: zodResolver(setRatesSchema), defaultValues: { roomTypeId: '', from: '', to: '' } });
  const submitRates = rates.handleSubmit(async (v) => {
    const { weekend, ...rest } = v;
    const r = await api.PUT('/api/hotels/{hotelId}/rates', { params: { path: { hotelId } }, body: { ...rest, weekdays: weekend ? [...WEEKEND_NIGHTS] : undefined } });
    if (r.data) return finish(`Rates updated for ${r.data.updated} night(s)`);
    const e = toApiError(r.error);
    if (!applyFieldErrors(e, rates.setError)) rates.setError('root', { message: e.message });
  });

  type Restr = z.input<typeof setRestrictionsSchema>;
  const restr = useForm<Restr>({ resolver: zodResolver(setRestrictionsSchema), defaultValues: { roomTypeId: '', from: '', to: '' } });
  const submitRestr = restr.handleSubmit(async (v) => {
    const r = await api.PUT('/api/hotels/{hotelId}/restrictions', { params: { path: { hotelId } }, body: v });
    if (r.data) return finish(`Restrictions saved for ${r.data.updated} night(s)`);
    const e = toApiError(r.error);
    if (!applyFieldErrors(e, restr.setError)) restr.setError('root', { message: e.message });
  });

  type Over = z.input<typeof setOverbookingSchema> & { roomTypeId: string };
  const over = useForm<Over>({ resolver: zodResolver(setOverbookingSchema.extend({ roomTypeId: uuid })), defaultValues: { roomTypeId: '', allowance: 0 } });
  const submitOver = over.handleSubmit(async (v) => {
    const r = await api.PUT('/api/hotels/{hotelId}/room-types/{roomTypeId}/overbooking', { params: { path: { hotelId, roomTypeId: v.roomTypeId } }, body: { allowance: v.allowance } });
    if (r.data) return finish('Overbooking allowance saved');
    const e = toApiError(r.error);
    if (!applyFieldErrors(e, over.setError)) over.setError('root', { message: e.message });
  });

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card>
        <h3 className="mb-2 font-semibold">Prices</h3>
        <form onSubmit={submitRates} className="space-y-2" noValidate>
          <RoomTypeSelect types={types} error={rates.formState.errors.roomTypeId?.message} {...rates.register('roomTypeId')} />
          <TextField label="From" type="date" error={rates.formState.errors.from?.message} {...rates.register('from')} />
          <TextField label="To (inclusive)" type="date" error={rates.formState.errors.to?.message} {...rates.register('to')} />
          <TextField label="New price (minor units)" inputMode="numeric" error={rates.formState.errors.price?.message} {...rates.register('price', { setValueAs: optionalNumber })} />
          <TextField label="or change in %" inputMode="decimal" error={rates.formState.errors.adjustPercent?.message} {...rates.register('adjustPercent', { setValueAs: optionalNumber })} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...rates.register('weekend')} /> Fridays and Saturdays only
          </label>
          <FormError message={rates.formState.errors.root?.message ?? null} />
          <Button type="submit">Apply</Button>
        </form>
      </Card>
      <Card>
        <h3 className="mb-2 font-semibold">Restrictions</h3>
        <form onSubmit={submitRestr} className="space-y-2" noValidate>
          <RoomTypeSelect types={types} error={restr.formState.errors.roomTypeId?.message} {...restr.register('roomTypeId')} />
          <TextField label="From" type="date" error={restr.formState.errors.from?.message} {...restr.register('from')} />
          <TextField label="To (inclusive)" type="date" error={restr.formState.errors.to?.message} {...restr.register('to')} />
          <TextField label="Minimum stay (nights)" inputMode="numeric" error={restr.formState.errors.minStay?.message} {...restr.register('minStay', { setValueAs: optionalNumber })} />
          {(['closedToArrival', 'closedToDeparture', 'stopSell'] as const).map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input type="checkbox" {...restr.register(k)} /> {k === 'closedToArrival' ? 'Closed to arrival' : k === 'closedToDeparture' ? 'Closed to departure' : 'Stop sell'}
            </label>
          ))}
          <FormError message={restr.formState.errors.root?.message ?? null} />
          <Button type="submit">Save</Button>
        </form>
      </Card>
      <Card>
        <h3 className="mb-2 font-semibold">Overbooking allowance</h3>
        <form onSubmit={submitOver} className="space-y-2" noValidate>
          <RoomTypeSelect types={types} error={over.formState.errors.roomTypeId?.message} {...over.register('roomTypeId')} />
          <TextField label="Extra rooms allowed" inputMode="numeric" error={over.formState.errors.allowance?.message} {...over.register('allowance', { valueAsNumber: true })} />
          <FormError message={over.formState.errors.root?.message ?? null} />
          <Button type="submit">Save</Button>
        </form>
      </Card>
      {done ? <p role="status" className="text-green-700 lg:col-span-3">{done}</p> : null}
    </div>
  );
};
