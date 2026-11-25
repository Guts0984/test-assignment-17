'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { friendlyErrorMap } from '@hotel/shared';
import { z } from 'zod';
import { useState, type ReactNode } from 'react';

// the web app's own forms use the same plain wording as the shared schemas
z.setErrorMap(friendlyErrorMap);

export const Providers = ({ children }: { children: ReactNode }): ReactNode => {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};
