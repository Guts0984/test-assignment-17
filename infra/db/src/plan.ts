import { addDays } from '@hotel/shared';

export interface Stay {
  readonly roomIndex: number;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly kind: 'past' | 'departing' | 'inhouse' | 'arrival' | 'future';
}

/** Tiny deterministic generator so the seed is reproducible. */
export const createRng = (seed: number) => {
  let s = seed >>> 0;
  const next = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  return { int: (min: number, max: number): number => min + Math.floor(next() * (max - min + 1)), chance: (p: number): boolean => next() < p };
};

type Rng = ReturnType<typeof createRng>;

/**
 * One non-overlapping timeline per room, so capacity is never exceeded:
 *  rooms 0-49   leave today, and a new guest arrives today (unassigned);
 *  rooms 50-139 are in house today and stay on;
 *  rooms 140-149 are free today.
 */
export const planStays = (today: string, rooms: number, rng: Rng): Stay[] => {
  const stays: Stay[] = [];
  const horizon = addDays(today, 85);
  for (let r = 0; r < rooms; r += 1) {
    let cursor = today;
    if (r < 50) {
      stays.push({ roomIndex: r, checkIn: addDays(today, -rng.int(1, 3)), checkOut: today, kind: 'departing' });
      const out = addDays(today, rng.int(1, 4));
      stays.push({ roomIndex: r, checkIn: today, checkOut: out, kind: 'arrival' });
      cursor = out;
    } else if (r < 140) {
      const out = addDays(today, rng.int(1, 4));
      stays.push({ roomIndex: r, checkIn: addDays(today, -rng.int(1, 2)), checkOut: out, kind: 'inhouse' });
      cursor = out;
    }
    stays.push({ roomIndex: r, checkIn: addDays(today, -rng.int(7, 12)), checkOut: addDays(today, -rng.int(4, 6)), kind: 'past' });
    for (;;) {
      const start = addDays(cursor, rng.int(0, 6));
      const end = addDays(start, rng.int(1, 5));
      if (end > horizon || !rng.chance(0.55)) break;
      stays.push({ roomIndex: r, checkIn: start, checkOut: end, kind: 'future' });
      cursor = end;
    }
  }
  return stays;
};
