'use client';

import { Suspense, type ReactNode } from 'react';
import { ReportView } from '@/features/report-filters';
import { StaffShell } from '@/widgets/staff-shell';

export const ReportsPage = (): ReactNode => (
  <Suspense fallback={null}>
    <StaffShell roles={['revenue', 'admin']}>
      {(hotelId) => (
        <div className="space-y-3">
          <h1 className="text-2xl font-bold">Revenue report</h1>
          <ReportView key={hotelId} hotelId={hotelId} />
        </div>
      )}
    </StaffShell>
  </Suspense>
);
