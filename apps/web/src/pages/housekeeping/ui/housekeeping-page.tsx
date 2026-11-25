'use client';

import { Suspense, type ReactNode } from 'react';
import { HousekeepingList } from '@/widgets/housekeeping-list';
import { StaffShell } from '@/widgets/staff-shell';

export const HousekeepingPage = (): ReactNode => (
  <Suspense fallback={null}>
    <StaffShell roles={['housekeeper', 'head_housekeeper', 'admin']}>{(hotelId) => <HousekeepingList key={hotelId} hotelId={hotelId} />}</StaffShell>
  </Suspense>
);
