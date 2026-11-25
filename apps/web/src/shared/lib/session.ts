import { useSyncExternalStore } from 'react';

const KEY = 'hotel.session';

export interface StaffSession {
  readonly accessToken: string;
  readonly staff: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly roles: readonly { hotelId: string | null; role: string }[];
  };
}

const listeners = new Set<() => void>();
let cached: { raw: string | null; value: StaffSession | null } = { raw: null, value: null };

const read = (): StaffSession | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === cached.raw) return cached.value;
    cached = { raw, value: raw ? (JSON.parse(raw) as StaffSession) : null };
    return cached.value;
  } catch {
    return null;
  }
};

export const readToken = (): string | null => read()?.accessToken ?? null;

export const saveSession = (s: StaffSession): void => {
  window.localStorage.setItem(KEY, JSON.stringify(s));
  listeners.forEach((l) => l());
};

export const clearSession = (): void => {
  window.localStorage.removeItem(KEY);
  listeners.forEach((l) => l());
};

export const useSession = (): StaffSession | null =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => null,
  );

export const rolesOf = (s: StaffSession | null): string[] => (s ? s.staff.roles.map((r) => r.role) : []);
