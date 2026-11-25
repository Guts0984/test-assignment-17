import type { Role } from '@hotel/shared';

export type ChangeKind = 'grid' | 'desk' | 'rooms';

/** What each kind of change is called on the wire, and which roles may listen to it. */
export const CHANGE_FEEDS: Readonly<Record<ChangeKind, { event: string; roles: readonly Role[] }>> = {
  grid: { event: 'grid:changed', roles: ['revenue', 'admin', 'frontdesk'] },
  desk: { event: 'frontdesk:changed', roles: ['frontdesk', 'admin'] },
  rooms: { event: 'housekeeping:changed', roles: ['housekeeper', 'head_housekeeper', 'admin', 'frontdesk'] },
};

export const roomName = (hotelId: string, kind: ChangeKind): string => `hotel:${hotelId}:${kind}`;

export const isChangeKind = (v: unknown): v is ChangeKind => v === 'grid' || v === 'desk' || v === 'rooms';

/** Batches bursts: at most one emit per key per `ms`, and the last change in a burst is never lost. */
export const createThrottle = (ms: number, now: () => number) => {
  const last = new Map<string, number>();
  const pending = new Map<string, NodeJS.Timeout>();
  return (key: string, fire: () => void): void => {
    if (pending.has(key)) return;
    const wait = Math.max(0, (last.get(key) ?? 0) + ms - now());
    pending.set(
      key,
      setTimeout(() => {
        pending.delete(key);
        last.set(key, now());
        fire();
      }, wait),
    );
  };
};
