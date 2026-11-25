'use client';

import { Suspense, type ReactNode } from 'react';
import { useHotels } from '@/entities/hotel';
import { FrontdeskBoard } from '@/widgets/frontdesk-board';
import { StaffShell } from '@/widgets/staff-shell';

const Content = ({ hotelId }: { hotelId: string }): ReactNode => {
  const hotels = useHotels();
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">Front desk</h1>
      <FrontdeskBoard hotelId={hotelId} currency={hotels.data?.find((h) => h.id === hotelId)?.currency ?? 'EUR'} />
    </div>
  );
};

export const FrontdeskPage = (): ReactNode => (
  <Suspense fallback={null}>
    <StaffShell roles={['frontdesk', 'admin']}>{(hotelId) => <Content key={hotelId} hotelId={hotelId} />}</StaffShell>
  </Suspense>
);
