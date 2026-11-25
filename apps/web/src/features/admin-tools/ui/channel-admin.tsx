'use client';

import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useHotels } from '@/entities/hotel';
import { api, call } from '@/shared/api';
import { Button, Card, FormError } from '@/shared/ui';
import { toApiError, useAction } from '@/shared/lib';

/** Which hotels and room types the sales channel may see and sell. Saving replaces the whole list. */
export const ChannelAdmin = (): ReactNode => {
  const queryClient = useQueryClient();
  const hotels = useHotels();
  const current = useQuery({ queryKey: ['channel-types'], queryFn: () => call(api.GET('/api/admin/channel')) });
  const grids = useQueries({
    queries: (hotels.data ?? []).map((h) => ({
      queryKey: ['grid-types', h.id, 'channel'],
      queryFn: () => call(api.GET('/api/hotels/{hotelId}/grid', { params: { path: { hotelId: h.id }, query: { days: 1 } } })),
    })),
  });
  const [picked, setPicked] = useState<readonly string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const action = useAction();
  useEffect(() => {
    if (current.data && picked === null) setPicked(current.data.roomTypeIds);
  }, [current.data, picked]);
  const toggle = (id: string): void => setPicked((p) => ((p ?? []).includes(id) ? (p ?? []).filter((x) => x !== id) : [...(p ?? []), id]));
  return (
    <Card>
      <h2 className="mb-2 text-lg font-semibold">Sales channel: connected hotels and room types</h2>
      <FormError message={current.error ? toApiError(current.error).message : action.error} />
      <div className="space-y-2" data-testid="channel-types">
        {hotels.data?.map((h, i) => (
          <div key={h.id}>
            <p className="font-medium">{h.name}</p>
            <div className="flex flex-wrap gap-3">
              {grids[i]?.data?.roomTypes.map((t) => (
                <label key={t.roomTypeId} className="flex items-center gap-1">
                  <input type="checkbox" checked={(picked ?? []).includes(t.roomTypeId)} onChange={() => toggle(t.roomTypeId)} /> {t.name}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      <Button
        className="mt-3"
        disabled={action.busy || picked === null}
        onClick={() =>
          void action.run(
            () => api.PUT('/api/admin/channel', { body: { roomTypeIds: [...(picked ?? [])] } }),
            async () => {
              setSaved(true);
              await queryClient.invalidateQueries({ queryKey: ['channel-types'] });
            },
          )
        }
      >
        Save
      </Button>
      {saved ? <p role="status" className="mt-2 text-green-700">Saved.</p> : null}
    </Card>
  );
};
