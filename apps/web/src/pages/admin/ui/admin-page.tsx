'use client';

import { Suspense, type ReactNode } from 'react';
import { ChannelAdmin, FailedJobs, HotelAdmin, StaffAdmin } from '@/features/admin-tools';
import { StaffShell } from '@/widgets/staff-shell';

export const AdminPage = (): ReactNode => (
  <Suspense fallback={null}>
    <StaffShell roles={['admin']}>
      {() => (
        <div className="space-y-4">
          <h1 className="text-2xl font-bold">Chain administration</h1>
          <FailedJobs />
          <HotelAdmin />
          <StaffAdmin />
          <ChannelAdmin />
        </div>
      )}
    </StaffShell>
  </Suspense>
);
