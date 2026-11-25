'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { api, call } from '@/shared/api';
import { formatDate, formatMoney, toApiError, useLiveEvents } from '@/shared/lib';
import { FormError } from '@/shared/ui';

export const gridKey = (hotelId: string) => ['grid', hotelId] as const;

/** 60 nights × room types: sold, free, price and restrictions. Other users' changes arrive live. */
export const AvailabilityGrid = ({ hotelId, currency }: { hotelId: string; currency: string }): ReactNode => {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: gridKey(hotelId), queryFn: () => call(api.GET('/api/hotels/{hotelId}/grid', { params: { path: { hotelId }, query: { days: 60 } } })) });
  useLiveEvents(hotelId, ['grid:changed'], () => void queryClient.invalidateQueries({ queryKey: gridKey(hotelId) }));
  if (q.error) return <FormError message={toApiError(q.error).message} />;
  if (!q.data) return <p>Loading grid…</p>;
  const types = q.data.roomTypes;
  const dates = types[0]?.nights.map((n) => n.date) ?? [];
  return (
    <div className="overflow-x-auto" data-testid="grid">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 bg-slate-100 p-2 text-left">Night</th>
            {types.map((t) => (
              <th key={t.roomTypeId} className="bg-slate-100 p-2 text-left">
                {t.name}
                {t.overbookingAllowance > 0 ? <span className="ml-1 text-xs text-amber-700">+{t.overbookingAllowance} overbooking</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dates.map((date, i) => (
            <tr key={date} className="border-t border-slate-200">
              <th className="sticky left-0 whitespace-nowrap bg-white p-2 text-left font-normal">{formatDate(date)}</th>
              {types.map((t) => {
                const n = t.nights[i];
                const flags = [n.minStay ? `min ${n.minStay}` : null, n.closedToArrival ? 'CTA' : null, n.closedToDeparture ? 'CTD' : null, n.stopSell ? 'STOP' : null].filter(Boolean);
                return (
                  <td key={t.roomTypeId} className={`p-2 align-top ${n.free <= 0 ? 'bg-red-50' : ''}`} data-testid={`cell-${t.name}-${date}`}>
                    <div>
                      sold {n.sold}
                      {n.held ? ` (+${n.held} held)` : ''} · free <strong>{n.free}</strong>
                    </div>
                    <div className="text-slate-600">{n.price === null ? 'no rate' : formatMoney(n.price, currency)}</div>
                    {flags.length > 0 ? <div className="text-xs text-red-700">{flags.join(' · ')}</div> : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
