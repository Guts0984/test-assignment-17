import type { ReactNode } from 'react';
import '../src/app/globals.css';
import { Providers } from '@/app';

export const metadata = { title: 'Hotel chain' };

const RootLayout = ({ children }: { children: ReactNode }): ReactNode => (
  <html lang="en">
    <body>
      <Providers>{children}</Providers>
    </body>
  </html>
);

export default RootLayout;
