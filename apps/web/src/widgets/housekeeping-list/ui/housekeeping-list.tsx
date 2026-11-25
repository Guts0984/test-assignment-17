'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { api, call } from '@/shared/api';
import { FormError } from '@/shared/ui';
import { formatDate, rolesOf, toApiError, useAction, useLiveEvents, useSession } from '@/shared/lib';

const BADGE: Record<string, string> = { dirty: 'bg-red-100 text-red-800', clean: 'bg-blue-100 text-blue-800', inspected: 'bg-green-100 text-green-800', out_of_order: 'bg-slate-300 text-slate-800' };
const BIG = 'min-h-14 w-full rounded-lg px-4 text-lg font-semibold disabled:opacity-50';

/** One card per room, thumb-sized buttons, no tables: works at 375 px held in one hand. */
export const HousekeepingList = ({ hotelId }: { hotelId: string }): ReactNode => {
  const queryClient = useQueryClient();
  const session = useSession();
  const isHead = rolesOf(session).some((r) => r === 'head_housekeeper' || r === 'admin');
  const rooms = useQuery({ queryKey: ['hk', hotelId], queryFn: () => call(api.GET('/api/hotels/{hotelId}/housekeeping/rooms', { params: { path: { hotelId } } })) });
  const crew = useQuery({ queryKey: ['hk-crew', hotelId], enabled: isHead, queryFn: () => call(api.GET('/api/hotels/{hotelId}/housekeepers', { params: { path: { hotelId } } })) });
  const action = useAction();
  const [ooo, setOoo] = useState<{ id: string; from: string; to: string; reason: string } | null>(null);
  const refresh = (): Promise<void> => queryClient.invalidateQueries({ queryKey: ['hk', hotelId] });
  useLiveEvents(hotelId, ['housekeeping:changed'], () => void refresh());
  const setStatus = (id: string, status: 'clean' | 'inspected' | 'dirty') => action.run(() => api.POST('/api/rooms/{id}/status', { params: { path: { id } }, body: { status } }), refresh);
  if (rooms.error) return <FormError message={toApiError(rooms.error).message} />;
  if (!rooms.data) return <p>Loading rooms…</p>;
  return (
    <div className="space-y-3" data-testid="hk-list">
      <p className="text-sm text-slate-600">Today: {formatDate(rooms.data.hotelDate)} · {rooms.data.rooms.length} room(s)</p>
      <FormError message={action.error} />
      {rooms.data.rooms.length === 0 ? <p>No rooms assigned to you.</p> : null}
      {rooms.data.rooms.map((r) => (
        <article key={r.id} data-testid={`room-${r.number}`} className={`space-y-3 rounded-lg border bg-white p-3 shadow-sm ${r.arrivalToday ? 'border-amber-400' : 'border-slate-200'}`}>
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold">{r.number}</h2>
            <span className={`rounded-full px-3 py-1 text-sm font-medium ${BADGE[r.status] ?? ''}`}>{r.status.replace('_', ' ')}</span>
          </div>
          <p className="text-slate-600">
            {r.roomTypeName}
            {r.occupied ? ' · guest in room' : ''}
            {r.arrivalToday ? ' · ARRIVAL TODAY' : ''}
          </p>
          {r.status === 'dirty' ? (
            <button className={`${BIG} bg-slate-900 text-white`} disabled={action.busy} onClick={() => void setStatus(r.id, 'clean')}>
              Mark clean
            </button>
          ) : null}
          {isHead && r.status === 'clean' ? (
            <button className={`${BIG} bg-green-700 text-white`} disabled={action.busy} onClick={() => void setStatus(r.id, 'inspected')}>
              Inspected — ready for guests
            </button>
          ) : null}
          {isHead && (r.status === 'clean' || r.status === 'inspected') ? (
            <button className={`${BIG} border border-slate-300 bg-white`} disabled={action.busy} onClick={() => void setStatus(r.id, 'dirty')}>
              Back to dirty
            </button>
          ) : null}
          {isHead ? (
            <>
              <label className="block text-sm font-medium">
                Housekeeper
                <select
                  className="mt-1 min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 text-lg"
                  value={r.housekeeperId ?? ''}
                  onChange={(e) => void action.run(() => api.PUT('/api/rooms/{id}/housekeeper', { params: { path: { id: r.id } }, body: { housekeeperId: e.target.value || null } }), refresh)}
                >
                  <option value="">Nobody</option>
                  {crew.data?.housekeepers.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </label>
              {r.status !== 'out_of_order' ? (
                <button className={`${BIG} border border-slate-300 bg-white`} onClick={() => setOoo({ id: r.id, from: rooms.data.hotelDate, to: '', reason: '' })}>
                  Take out of service…
                </button>
              ) : null}
            </>
          ) : null}
          {ooo?.id === r.id ? (
            <form
              className="space-y-2 rounded-lg bg-slate-50 p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void action.run(() => api.POST('/api/rooms/{id}/out-of-order', { params: { path: { id: r.id } }, body: { from: ooo.from, to: ooo.to, reason: ooo.reason } }), async () => {
                  setOoo(null);
                  await refresh();
                });
              }}
            >
              {(['from', 'to'] as const).map((k) => (
                <label key={k} className="block text-sm font-medium">
                  {k === 'from' ? 'From' : 'Until (exclusive)'}
                  <input type="date" required className="mt-1 min-h-12 w-full rounded-lg border border-slate-300 px-3 text-lg" value={ooo[k]} onChange={(e) => setOoo({ ...ooo, [k]: e.target.value })} />
                </label>
              ))}
              <label className="block text-sm font-medium">
                Reason
                <input required minLength={3} className="mt-1 min-h-12 w-full rounded-lg border border-slate-300 px-3 text-lg" value={ooo.reason} onChange={(e) => setOoo({ ...ooo, reason: e.target.value })} />
              </label>
              <button className={`${BIG} bg-slate-900 text-white`} disabled={action.busy}>
                Save
              </button>
            </form>
          ) : null}
        </article>
      ))}
    </div>
  );
};
