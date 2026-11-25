import { randomUUID } from 'node:crypto';
import { WEEKEND_NIGHTS, applyRateChange, nightsOf } from '@hotel/shared';
import type { Rng, Stay } from './plan';

export interface TypeInfo {
  readonly id: string;
  readonly factor: number;
  readonly maxGuests: number;
}

export interface RoomInfo {
  readonly id: string;
  readonly type: string;
}

const FIRST = ['Olena', 'Ivan', 'Anna', 'Piotr', 'Maria', 'João', 'Sofia', 'Marek', 'Ines', 'Taras', 'Ewa', 'Pedro'] as const;
const LAST = ['Koval', 'Nowak', 'Silva', 'Shevchenko', 'Wiśniewski', 'Costa', 'Bondar', 'Kowalski', 'Ferreira', 'Melnyk'] as const;

export interface BookingRow {
  readonly id: string;
  readonly code: string;
  readonly type: string;
  readonly room: string | null;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly status: Stay['status'];
  readonly channel: boolean;
  readonly guests: number;
  readonly name: string;
  readonly email: string;
  readonly total: number;
  readonly penalty: number | null;
  readonly nights: { d: string; p: number }[];
  readonly kind: Stay['kind'];
}

export interface FolioRow {
  b: string;
  k: 'charge' | 'payment';
  c: string;
  a: number;
  key: string;
  d: string;
}

/** Nightly price of a room type on a date, with +15 % on Friday and Saturday nights. */
export const priceOf = (base: number, factor: number, date: string): number =>
  applyRateChange(date, Math.round(base * factor), { adjustPercent: 15, weekdays: WEEKEND_NIGHTS }) ?? Math.round(base * factor);

export const buildBooking = (
  stay: Stay & { roomType?: number },
  index: number,
  hotelCode: string,
  base: number,
  types: readonly TypeInfo[],
  rooms: readonly RoomInfo[],
  rng: Rng,
): BookingRow => {
  const room = stay.roomIndex >= 0 ? rooms[stay.roomIndex] : null;
  const type = room ? (types.find((t) => t.id === room.type) ?? types[0]) : types[stay.roomType ?? 0];
  const nights = nightsOf(stay.checkIn, stay.checkOut).map((d) => ({ d, p: priceOf(base, type.factor, d) }));
  const first = rng.pick(FIRST);
  const last = rng.pick(LAST);
  const guests = Math.min(type.maxGuests, stay.kind === 'inhouse' || stay.kind === 'departing' ? rng.pick([1, 1, 2, 2, 2] as const) : rng.pick([1, 2, 2, 3, 4] as const));
  const assigned = stay.kind === 'past' || stay.kind === 'departing' || stay.kind === 'inhouse';
  const total = nights.reduce((s, n) => s + n.p, 0);
  const lateCancel = stay.status === 'cancelled' && rng.chance(0.25);
  return {
    id: randomUUID(),
    code: `SD-${hotelCode}-${String(index).padStart(6, '0')}`,
    type: type.id,
    room: room && assigned ? room.id : null,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    status: stay.status,
    channel: rng.chance(0.3),
    guests,
    name: `${first} ${last}`,
    email: `${first}.${last}${index}@example.test`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''),
    total,
    penalty: stay.status === 'no_show' || lateCancel ? (nights[0]?.p ?? 0) : null,
    nights,
    kind: stay.kind,
  };
};

const EXTRAS = ['minibar', 'service', 'service', 'minibar', 'service'] as const;

/** Room nights up to today, minibar/service extras, and payments that clear finished stays. */
export const buildFolio = (b: BookingRow, today: string, rng: Rng): FolioRow[] => {
  if (b.kind === 'lost') {
    return b.penalty ? [{ b: b.id, k: 'charge', c: 'penalty', a: b.penalty, key: `penalty:${b.id}`, d: b.checkIn }] : [];
  }
  if (b.status === 'confirmed') return [];
  const lines: FolioRow[] = b.nights
    .filter((n) => n.d < today)
    .map((n) => ({ b: b.id, k: 'charge', c: 'room', a: n.p, key: `night:${b.id}:${n.d}`, d: n.d }));
  const finished = b.status === 'checked_out' || b.kind === 'departing';
  const extras = b.kind === 'inhouse' ? rng.int(0, 3) : rng.int(6, 21);
  for (let i = 0; i < extras; i += 1) {
    lines.push({ b: b.id, k: 'charge', c: rng.pick(EXTRAS), a: rng.int(5, 120) * 100, key: `ext:${b.id}:${i}`, d: b.nights[Math.min(i, b.nights.length - 1)]?.d ?? b.checkIn });
  }
  const due = lines.reduce((s, l) => s + l.a, 0);
  if (finished) {
    const parts = rng.int(1, 3);
    let left = due;
    for (let i = 0; i < parts; i += 1) {
      const pay = i === parts - 1 ? left : Math.floor(left / (parts - i));
      lines.push({ b: b.id, k: 'payment', c: i % 2 === 0 ? 'card' : 'cash', a: -pay, key: `pay:${b.id}:${i}`, d: b.checkOut });
      left -= pay;
    }
  } else if (due > 0) {
    lines.push({ b: b.id, k: 'payment', c: 'card', a: -Math.floor(due / 2), key: `pay:${b.id}:0`, d: b.checkIn });
  }
  return lines;
};
