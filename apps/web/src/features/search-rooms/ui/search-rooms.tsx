'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { searchQuerySchema } from '@hotel/shared';
import { useHotels } from '@/entities/hotel';
import { api, call } from '@/shared/api';
import { Button, Card, FormError, TextField } from '@/shared/ui';
import { formatDate, formatMoney, toApiError, useUrlParams } from '@/shared/lib';
import { z } from 'zod';

const formSchema = searchQuerySchema;
type FormValues = z.input<typeof formSchema>;

/** The whole search state lives in the URL, so reload and Back keep it. */
export const SearchRooms = (): ReactNode => {
  const router = useRouter();
  const params = useUrlParams();
  const hotels = useHotels();
  const current = {
    hotelId: params.get('hotelId') ?? '',
    checkIn: params.get('checkIn') ?? '',
    checkOut: params.get('checkOut') ?? '',
    guests: Number(params.get('guests') ?? 2),
  };
  const form = useForm<FormValues>({ resolver: zodResolver(formSchema), values: current });
  const searched = current.hotelId && current.checkIn && current.checkOut;
  const results = useQuery({
    queryKey: ['search', current],
    enabled: Boolean(searched),
    queryFn: () => call(api.GET('/api/search', { params: { query: current } })),
  });
  const hold = async (roomTypeId: string): Promise<void> => {
    const r = await api.POST('/api/holds', { body: { hotelId: current.hotelId, roomTypeId, checkIn: current.checkIn, checkOut: current.checkOut, guests: current.guests } });
    if (r.data) router.push(`/book/${r.data.token}`);
    else form.setError('root', { message: toApiError(r.error).message });
  };
  const err = results.error ? toApiError(results.error).message : null;
  return (
    <div className="space-y-6">
      <Card>
        <form
          className="grid gap-3 sm:grid-cols-5 sm:items-end"
          onSubmit={form.handleSubmit((v) => router.push(`/?${new URLSearchParams({ hotelId: v.hotelId, checkIn: v.checkIn, checkOut: v.checkOut, guests: String(v.guests) })}`))}
          noValidate
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="hotelId" className="text-sm font-medium text-slate-700">
              Hotel
            </label>
            <select id="hotelId" className="rounded border border-slate-300 px-3 py-2" {...form.register('hotelId')}>
              <option value="">Choose…</option>
              {hotels.data?.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
            {form.formState.errors.hotelId ? <p role="alert" className="text-sm text-red-600">{form.formState.errors.hotelId.message}</p> : null}
          </div>
          <TextField label="Check-in" type="date" error={form.formState.errors.checkIn?.message} {...form.register('checkIn')} />
          <TextField label="Check-out" type="date" error={form.formState.errors.checkOut?.message} {...form.register('checkOut')} />
          <TextField label="Guests" type="number" min={1} max={10} error={form.formState.errors.guests?.message} {...form.register('guests', { valueAsNumber: true })} />
          <Button type="submit">Search</Button>
        </form>
        <FormError message={form.formState.errors.root?.message ?? null} />
      </Card>
      <FormError message={err} />
      {results.data ? (
        <div className="space-y-3" data-testid="results">
          {results.data.roomTypes.length === 0 ? <p>No room types for these dates.</p> : null}
          {results.data.roomTypes.map((rt) => (
            <Card key={rt.roomTypeId}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{rt.name}</h3>
                  <p className="text-sm text-slate-600">
                    Up to {rt.maxGuests} guests · {rt.available} left
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-semibold">{formatMoney(rt.total, results.data.hotel.currency)}</p>
                  <Button data-testid={`book-${rt.name}`} disabled={rt.available < 1 || rt.violations.length > 0} onClick={() => void hold(rt.roomTypeId)}>
                    Book
                  </Button>
                </div>
              </div>
              <ul className="mt-2 text-sm text-slate-600">
                {rt.nights.map((n) => (
                  <li key={n.date}>
                    {formatDate(n.date)}: {formatMoney(n.price, results.data.hotel.currency)}
                  </li>
                ))}
              </ul>
              {rt.violations.map((v) => (
                <p key={v.code + v.date} role="alert" className="mt-2 text-sm text-red-600">
                  {v.message}
                </p>
              ))}
              {rt.available < 1 ? <p className="mt-2 text-sm text-red-600">Sold out for these dates.</p> : null}
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
};
