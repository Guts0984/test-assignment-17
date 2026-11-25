'use client';

import { Suspense, type ReactNode } from 'react';
import { SearchRooms } from '@/features/search-rooms';

export const GuestSearchPage = (): ReactNode => (
  <main className="mx-auto max-w-4xl space-y-4 p-4">
    <h1 className="text-2xl font-bold">Book a room</h1>
    <Suspense fallback={null}>
      <SearchRooms />
    </Suspense>
  </main>
);
