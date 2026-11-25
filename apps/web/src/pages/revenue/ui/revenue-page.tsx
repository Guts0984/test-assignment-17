'use client';

import { Suspense, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RevenueForms } from '@/features/revenue-forms';
import { AvailabilityGrid } from '@/widgets/availability-grid';
import { StaffShell } from '@/widgets/staff-shell';
import { api, call } from '@/shared/api';

const Content = ({ hotelId }: { hotelId: string }): ReactNode => {
  const hotels = useQuery({ queryKey: ['hotels'], queryFn: () => call(api.GET('/api/hotels')) });
  const grid = useQuery({ queryKey: ['grid', hotelId], queryFn: () => call(api.GET('/api/hotels/{hotelId}/grid', { params: { path: { hotelId }, query: { days: 60 } } })) });
  const currency = hotels.data?.find((h) => h.id === hotelId)?.currency ?? 'EUR';
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Revenue management</h1>
      <RevenueForms hotelId={hotelId} types={grid.data?.roomTypes ?? []} onChanged={() => void grid.refetch()} />
      <AvailabilityGrid hotelId={hotelId} currency={currency} />
    </div>
  );
};

export const RevenuePage = (): ReactNode => (
  <Suspense fallback={null}>
    <StaffShell roles={['revenue', 'admin']}>{(hotelId) => <Content key={hotelId} hotelId={hotelId} />}</StaffShell>
  </Suspense>
);
