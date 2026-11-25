import { addDays } from '@hotel/shared';

export type StayStatus = 'checked_out' | 'checked_in' | 'confirmed' | 'cancelled' | 'no_show';
export type StayKind = 'past' | 'departing' | 'inhouse' | 'arrival' | 'future' | 'lost';

export interface Stay {
  readonly roomIndex: number;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly status: StayStatus;
  readonly kind: StayKind;
}

/** Tiny deterministic generator so the seed is reproducible. */
export const createRng = (seed: number) => {
  let s = seed >>> 0;
  const next = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  return {
    int: (min: number, max: number): number => min + Math.floor(next() * (max - min + 1)),
    chance: (p: number): boolean => next() < p,
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
  };
};

export type Rng = ReturnType<typeof createRng>;

const STAY_NIGHTS = [1, 1, 2, 2, 2, 3, 3, 4, 5] as const;

const gap = (rng: Rng): number => (rng.chance(0.35) ? rng.int(1, 2) : 0);

/**
 * One non-overlapping timeline per room for a year back and a year ahead, so capacity is never exceeded.
 * Today: rooms 0-59 have a guest leaving and a new one arriving (unassigned), rooms 60-139 are in house,
 * rooms 140-149 are free.
 */
const timelineOf = (room: number, today: string, rng: Rng, span: number): Stay[] => {
  const stays: Stay[] = [];
  let backFrom = today;
  let cursor = today;
  if (room < 60) {
    const departing = { roomIndex: room, checkIn: addDays(today, -rng.int(1, 3)), checkOut: today, status: 'checked_in', kind: 'departing' } as const;
    const out = addDays(today, rng.pick(STAY_NIGHTS));
    stays.push(departing, { roomIndex: room, checkIn: today, checkOut: out, status: 'confirmed', kind: 'arrival' });
    backFrom = departing.checkIn;
    cursor = out;
  } else if (room < 140) {
    const inIn = addDays(today, -rng.int(1, 2));
    const out = addDays(today, rng.int(1, 4));
    stays.push({ roomIndex: room, checkIn: inIn, checkOut: out, status: 'checked_in', kind: 'inhouse' });
    backFrom = inIn;
    cursor = out;
  }
  if (room >= 146) cursor = addDays(today, 5); // out of order until today + 4
  for (let end = addDays(backFrom, -gap(rng)); ; ) {
    const start = addDays(end, -rng.pick(STAY_NIGHTS));
    if (start < addDays(today, -span)) break;
    stays.push({ roomIndex: room, checkIn: start, checkOut: end, status: 'checked_out', kind: 'past' });
    end = addDays(start, -gap(rng));
  }
  for (;;) {
    const start = addDays(cursor, gap(rng));
    const end = addDays(start, rng.pick(STAY_NIGHTS));
    if (end > addDays(today, span)) break;
    stays.push({ roomIndex: room, checkIn: start, checkOut: end, status: 'confirmed', kind: 'future' });
    cursor = end;
  }
  return stays;
};

/** Stays that occupied rooms, plus bookings that never held nights (cancelled, no-show) up to `target` bookings. */
export const planHotel = (today: string, rooms: number, target: number, rng: Rng, span: number): { active: Stay[]; lost: (Stay & { roomType: number })[] } => {
  const active = Array.from({ length: rooms }, (_, r) => timelineOf(r, today, rng, span)).flat();
  const lostCount = Math.max(0, target - active.length);
  const lost = Array.from({ length: lostCount }, () => {
    const start = addDays(today, rng.int(-span, span - 5));
    const noShow = start < today && rng.chance(0.1);
    return {
      roomIndex: -1,
      roomType: rng.int(0, 4),
      checkIn: start,
      checkOut: addDays(start, rng.pick(STAY_NIGHTS)),
      status: noShow ? ('no_show' as const) : ('cancelled' as const),
      kind: 'lost' as const,
    };
  });
  return { active, lost };
};
