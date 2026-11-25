import { nightsOf } from '@hotel/shared';

export interface InventoryNight {
  readonly night: string;
  readonly total: number;
  readonly ooo: number;
  readonly sold: number;
  readonly held: number;
  readonly overbooked: number;
}

/** Rooms still sellable on the tightest night. A night without an inventory row is fully free. */
export const availableRooms = (capacity: number, checkIn: string, checkOut: string, rows: readonly InventoryNight[]): number => {
  const byNight = new Map(rows.map((r) => [r.night, r]));
  const free = nightsOf(checkIn, checkOut).map((n) => {
    const r = byNight.get(n);
    return r ? r.total - r.ooo - (r.sold - r.overbooked + r.held) : capacity;
  });
  return Math.max(0, Math.min(...free));
};
