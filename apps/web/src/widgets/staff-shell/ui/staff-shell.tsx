'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useStaffHotels } from '@/entities/hotel';
import { api } from '@/shared/api';
import { clearSession, useUrlParams } from '@/shared/lib';

const LINKS = [
  { href: '/staff/revenue', label: 'Revenue', roles: ['revenue', 'admin'] },
  { href: '/staff/reports', label: 'Report', roles: ['revenue', 'admin'] },
  { href: '/staff/frontdesk', label: 'Front desk', roles: ['frontdesk', 'admin'] },
  { href: '/staff/housekeeping', label: 'Housekeeping', roles: ['housekeeper', 'head_housekeeper', 'admin'] },
  { href: '/staff/admin', label: 'Admin', roles: ['admin'] },
];

/** Auth gate + navigation + hotel switcher (the hotel is kept in the URL). */
export const StaffShell = ({ roles, children }: { roles: readonly string[]; children: (hotelId: string) => ReactNode }): ReactNode => {
  const router = useRouter();
  const params = useUrlParams();
  const { session, hotels, roles: mine, loading } = useStaffHotels(roles);
  useEffect(() => {
    if (!session) router.replace('/staff/login');
  }, [session, router]);
  if (!session) return null;
  const hotelId = params.get('hotel') ?? hotels[0]?.id ?? '';
  const setHotel = (id: string): void => router.push(`?hotel=${id}`);
  return (
    <div className="mx-auto max-w-6xl p-3">
      <header className="mb-3 flex flex-wrap items-center gap-3 border-b border-slate-200 pb-2">
        <nav className="flex flex-wrap gap-3">
          {LINKS.filter((l) => l.roles.some((r) => mine.includes(r))).map((l) => (
            <Link key={l.href} href={l.href} className="font-medium underline-offset-4 hover:underline">
              {l.label}
            </Link>
          ))}
        </nav>
        <select aria-label="Hotel" className="ml-auto min-h-11 rounded border border-slate-300 px-3 text-base" value={hotelId} onChange={(e) => setHotel(e.target.value)}>
          {hotels.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
        <button
          className="min-h-11 rounded border border-slate-300 px-3 text-base"
          onClick={() => {
            // the server revokes the token; the screen does not wait for the answer
            void api.POST('/api/auth/logout').finally(() => {
              clearSession();
              router.replace('/staff/login');
            });
          }}
        >
          Sign out ({session.staff.name})
        </button>
      </header>
      {loading ? <p>Loading…</p> : hotelId ? children(hotelId) : <p>No hotel available for your role.</p>}
    </div>
  );
};
