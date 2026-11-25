'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { api, call } from '@/shared/api';
import { Card, FormError } from '@/shared/ui';
import { formatDate, formatMoney, toApiError, useLiveEvents, useUrlParams } from '@/shared/lib';

const VIEWS = ['arrivals', 'departures', 'inhouse', 'overbooked'] as const;
type View = (typeof VIEWS)[number];
const LABEL: Record<View, string> = { arrivals: 'Arrivals', departures: 'Departures', inhouse: 'In house', overbooked: 'Overbooked' };

/** Today's lists by the hotel's date, plus search by code, surname or e-mail. State is in the URL. */
export const FrontdeskBoard = ({ hotelId, currency }: { hotelId: string; currency: string }): ReactNode => {
  const router = useRouter();
  const params = useUrlParams();
  const queryClient = useQueryClient();
  const view = (VIEWS.find((v) => v === params.get('view')) ?? 'arrivals') as View;
  const q = params.get('q') ?? '';
  const [draft, setDraft] = useState(q);
  const go = (next: Record<string, string>): void => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    router.push(`?${p}`);
  };
  const list = useQuery({
    queryKey: ['frontdesk', hotelId, view, q],
    queryFn: () => (q ? call(api.GET('/api/hotels/{hotelId}/bookings/search', { params: { path: { hotelId }, query: { q } } })).then((r) => ({ hotelDate: '', view: 'search', bookings: r.bookings })) : call(api.GET('/api/hotels/{hotelId}/frontdesk', { params: { path: { hotelId }, query: { view } } }))),
  });
  useLiveEvents(hotelId, ['frontdesk:changed'], () => void queryClient.invalidateQueries({ queryKey: ['frontdesk', hotelId] }));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {VIEWS.map((v) => (
          <button key={v} data-testid={`tab-${v}`} onClick={() => go({ view: v, q: '' })} className={`rounded px-3 py-1 ${!q && view === v ? 'bg-slate-900 text-white' : 'border border-slate-300'}`}>
            {LABEL[v]}
          </button>
        ))}
        <form
          className="ml-auto flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            go({ q: draft.trim() });
          }}
        >
          <input aria-label="Search" placeholder="Code, surname or e-mail" className="rounded border border-slate-300 px-3 py-1" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button className="rounded border border-slate-300 px-3 py-1">Search</button>
        </form>
      </div>
      {list.data && list.data.hotelDate ? <p className="text-sm text-slate-600" data-testid="hotel-date">Hotel date (server): {formatDate(list.data.hotelDate)}</p> : null}
      <FormError message={list.error ? toApiError(list.error).message : null} />
      <Card className="overflow-x-auto p-0">
        <table className="min-w-full text-sm" data-testid="desk-table">
          <thead className="bg-slate-100 text-left">
            <tr>
              <th className="p-2">Booking</th>
              <th className="p-2">Guest</th>
              <th className="p-2">Stay</th>
              <th className="p-2">Room</th>
              <th className="p-2">Status</th>
              <th className="p-2 text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.bookings.map((b) => (
              <tr key={b.bookingId} className="border-t border-slate-100">
                <td className="p-2">
                  <Link className="font-medium underline" href={`/staff/frontdesk/booking/${b.bookingId}?hotel=${hotelId}`}>
                    {b.code}
                  </Link>
                  {b.overbooking ? <span className="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-800">overbooked</span> : null}
                </td>
                <td className="p-2">{b.guestName ?? '—'}</td>
                <td className="p-2">
                  {formatDate(b.checkIn)} → {formatDate(b.checkOut)}
                </td>
                <td className="p-2">{b.roomNumber ?? `— (${b.roomTypeName})`}</td>
                <td className="p-2">{b.status}</td>
                <td className="p-2 text-right">{formatMoney(b.balance, currency)}</td>
              </tr>
            ))}
            {list.data && list.data.bookings.length === 0 ? (
              <tr>
                <td className="p-3 text-slate-600" colSpan={6}>
                  Nothing here.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>
    </div>
  );
};
