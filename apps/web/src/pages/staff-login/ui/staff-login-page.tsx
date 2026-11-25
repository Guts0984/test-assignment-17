'use client';

import type { ReactNode } from 'react';
import { LoginForm } from '@/features/staff-login';
import { Card } from '@/shared/ui';

export const StaffLoginPage = (): ReactNode => (
  <main className="mx-auto max-w-sm space-y-4 p-4">
    <h1 className="text-2xl font-bold">Staff sign in</h1>
    <Card>
      <LoginForm />
    </Card>
  </main>
);
