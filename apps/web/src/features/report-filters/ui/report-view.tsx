'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { reportQuerySchema } from '@hotel/shared';
import type { z } from 'zod';
import { api, call } from '@/shared/api';
import { Button, Card, FormError, TextField } from '@/shared/ui';
import { formatMoney, toApiError, useUrlParams } from '@/shared/lib';

type Values = z.input<typeof reportQuerySchema>;

const pct = (v: number): string => `${(v * 100).toFixed(1)} %`;

/** Period and filters live in the URL, so reload, Back and shared links reproduce the same report. */
export const ReportView = ({ hotelId }: { hotelId: string }): ReactNode => {
  const router = useRouter();
  const params = useUrlParams();
  const applied = { from: params.get('from') ?? '', to: params.get('to') ?? '', roomTypeId: params.get('roomTypeId') ?? undefined, source: (params.get('source') as 'web' | 'channel' | null) ?? undefined };
  const form = useForm<Values>({ resolver: zodResolver(reportQuerySchema), values: { from: applied.from, to: applied.to, roomTypeId: applied.roomTypeId ?? undefined, source: applied.source ?? undefined } });
  const ready = Boolean(applied.from && applied.to);
  const report = useQuery({
    queryKey: ['report', hotelId, applied],
    enabled: ready,
    queryFn: () => call(api.GET('/api/hotels/{hotelId}/reports/revenue', { params: { path: { hotelId }, query: { from: applied.from, to: applied.to, roomTypeId: applied.roomTypeId, source: applied.source } } })),
  });
  const types = useQuery({ queryKey: ['grid-types', hotelId], queryFn: () => call(api.GET('/api/hotels/{hotelId}/grid', { params: { path: { hotelId }, query: { days: 1 } } })) });
  const submit = form.handleSubmit((v) => {
    const p = new URLSearchParams(params.toString());
    p.set('from', v.from);
    p.set('to', v.to);
    for (const k of ['roomTypeId', 'source'] as const) {
      const value = v[k];
      if (value) p.set(k, value);
      else p.delete(k);
    }
    router.push(`?${p}`);
  });
  const d = report.data;
  const money = (n: number): string => formatMoney(n, d?.currency ?? 'EUR');
  return (
    <div className="space-y-4">
      <Card>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-5 sm:items-end" noValidate>
          <TextField label="From" type="date" error={form.formState.errors.from?.message} {...form.register('from')} />
          <TextField label="To (exclusive)" type="date" error={form.formState.errors.to?.message} {...form.register('to')} />
          <div className="flex flex-col gap-1">
            <label htmlFor="rt" className="text-sm font-medium">Room type</label>
            <select id="rt" className="rounded border border-slate-300 px-3 py-2" {...form.register('roomTypeId', { setValueAs: (v) => v || undefined })}>
              <option value="">All</option>
              {types.data?.roomTypes.map((t) => (
                <option key={t.roomTypeId} value={t.roomTypeId}>{t.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="src" className="text-sm font-medium">Channel</label>
            <select id="src" className="rounded border border-slate-300 px-3 py-2" {...form.register('source', { setValueAs: (v) => v || undefined })}>
              <option value="">All</option>
              <option value="web">Website</option>
              <option value="channel">Sales channel</option>
            </select>
          </div>
          <Button type="submit">Show</Button>
        </form>
      </Card>
      <FormError message={report.error ? toApiError(report.error).message : null} />
      {d ? (
        <>
          <div className="grid gap-3 sm:grid-cols-4" data-testid="report-total">
            {[
              ['Occupancy', pct(d.total.occupancy)],
              ['Average nightly rate', money(d.total.adr)],
              ['Revenue per available room', money(d.total.revPar)],
              ['Room revenue', money(d.total.revenue)],
            ].map(([label, value]) => (
              <Card key={label}>
                <p className="text-sm text-slate-600">{label}</p>
                <p className="text-xl font-semibold">{value}</p>
              </Card>
            ))}
          </div>
          <Card className="overflow-x-auto">
            <h3 className="mb-2 font-semibold">Cancellations and no-shows by channel</h3>
            <table className="min-w-full text-sm">
              <thead className="text-left"><tr><th className="p-1">Channel</th><th className="p-1">Bookings</th><th className="p-1">Cancelled</th><th className="p-1">No-shows</th><th className="p-1 text-right">Revenue</th></tr></thead>
              <tbody>
                {d.bySource.map((s) => (
                  <tr key={s.source} className="border-t border-slate-100">
                    <td className="p-1">{s.source === 'web' ? 'Website' : 'Sales channel'}</td>
                    <td className="p-1">{s.bookings}</td>
                    <td className="p-1">{s.cancelled} ({s.bookings ? pct(s.cancelled / s.bookings) : '0 %'})</td>
                    <td className="p-1">{s.noShows} ({s.bookings ? pct(s.noShows / s.bookings) : '0 %'})</td>
                    <td className="p-1 text-right">{money(s.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card className="overflow-x-auto">
            <h3 className="mb-2 font-semibold">By room type</h3>
            <table className="min-w-full text-sm">
              <thead className="text-left"><tr><th className="p-1">Room type</th><th className="p-1">Occupancy</th><th className="p-1">Avg rate</th><th className="p-1">RevPAR</th><th className="p-1 text-right">Revenue</th></tr></thead>
              <tbody>
                {d.byRoomType.map((t) => (
                  <tr key={t.roomTypeId} className="border-t border-slate-100">
                    <td className="p-1">{t.name}</td>
                    <td className="p-1">{pct(t.occupancy)}</td>
                    <td className="p-1">{money(t.adr)}</td>
                    <td className="p-1">{money(t.revPar)}</td>
                    <td className="p-1 text-right">{money(t.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      ) : null}
    </div>
  );
};
