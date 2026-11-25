'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { folioLineInputSchema } from '@hotel/shared';
import { z } from 'zod';
import { api, call } from '@/shared/api';
import { Button, Card, FormError, TextField } from '@/shared/ui';
import { applyFieldErrors, formatMoney, toApiError, useAction } from '@/shared/lib';

const formSchema = folioLineInputSchema.extend({ amount: z.coerce.number({ invalid_type_error: 'Enter an amount' }).positive('Enter an amount greater than zero').max(1_000_000) });
type Values = z.input<typeof formSchema>;
const key = (id: string) => ['folio', id] as const;

/** The guest's account: lines are never edited, mistakes are reversed by a storno line. */
export const FolioPanel = ({ bookingId, onChanged }: { bookingId: string; onChanged: () => void }): ReactNode => {
  const queryClient = useQueryClient();
  const folio = useQuery({ queryKey: key(bookingId), queryFn: () => call(api.GET('/api/bookings/{id}/folio', { params: { path: { id: bookingId } } })) });
  const action = useAction();
  const form = useForm<Values>({ resolver: zodResolver(formSchema), defaultValues: { kind: 'charge', category: 'minibar', amount: undefined, note: '' } });
  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: key(bookingId) });
    onChanged();
  };
  const add = form.handleSubmit(async (v) => {
    const r = await api.POST('/api/bookings/{id}/folio', { params: { path: { id: bookingId } }, body: { ...v, amount: Math.round(Number(v.amount) * 100), note: v.note || undefined } });
    if (r.data) {
      form.reset({ kind: v.kind, category: v.category, amount: undefined, note: '' });
      return refresh();
    }
    const e = toApiError(r.error);
    if (!applyFieldErrors(e, form.setError)) form.setError('root', { message: e.message });
  });
  if (!folio.data) return <Card>Loading account…</Card>;
  const f = folio.data;
  return (
    <Card>
      <div className="flex items-baseline justify-between">
        <h3 className="font-semibold">Guest account</h3>
        <p data-testid="balance" className={f.balance === 0 ? 'text-green-700' : 'text-red-700'}>
          Balance {formatMoney(f.balance, f.currency)}
        </p>
      </div>
      <ul className="my-2 max-h-72 divide-y divide-slate-100 overflow-auto text-sm">
        {f.lines.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-2 py-1">
            <span>
              {l.hotelDate} · {l.kind} · {l.category}
              {l.note ? ` · ${l.note}` : ''}
              {l.stornoOfId ? ' (reversal)' : ''}
            </span>
            <span className="flex items-center gap-2">
              {formatMoney(l.amount, f.currency)}
              {l.kind !== 'storno' && !f.lines.some((x) => x.stornoOfId === l.id) ? (
                <button className="text-xs underline" onClick={() => void action.run(() => api.POST('/api/bookings/{id}/folio/{lineId}/storno', { params: { path: { id: bookingId, lineId: l.id } } }), refresh)}>
                  storno
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      <FormError message={action.error} />
      <form onSubmit={add} className="mt-2 grid gap-2 sm:grid-cols-5 sm:items-end" noValidate>
        <div className="flex flex-col gap-1">
          <label htmlFor="kind" className="text-sm font-medium">Type</label>
          <select id="kind" className="rounded border border-slate-300 px-2 py-2" {...form.register('kind')}>
            <option value="charge">Charge</option>
            <option value="payment">Payment</option>
            <option value="refund">Refund</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="category" className="text-sm font-medium">Category</label>
          <select id="category" className="rounded border border-slate-300 px-2 py-2" {...form.register('category')}>
            {['room', 'minibar', 'service', 'penalty', 'cash', 'card'].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <TextField label={`Amount (${f.currency})`} inputMode="decimal" error={form.formState.errors.amount?.message} {...form.register('amount')} />
        <TextField label="Note" error={form.formState.errors.note?.message} {...form.register('note')} />
        <Button type="submit" disabled={form.formState.isSubmitting}>Add</Button>
      </form>
      <FormError message={form.formState.errors.root?.message ?? null} />
    </Card>
  );
};
