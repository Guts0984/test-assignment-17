/** A calendar date `YYYY-MM-DD` (hotel-local, no time zone). */
export type IsoDate = string;

const DAY_MS = 86_400_000;
const parse = (d: IsoDate): number => Date.parse(`${d}T00:00:00Z`);

/** A real calendar date: `2027-02-30` is refused (Date.parse would roll it over to March). */
export const isIsoDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parse(value)) && new Date(parse(value)).toISOString().slice(0, 10) === value;

export const addDays = (date: IsoDate, days: number): IsoDate => new Date(parse(date) + days * DAY_MS).toISOString().slice(0, 10);

export const diffDays = (from: IsoDate, to: IsoDate): number => Math.round((parse(to) - parse(from)) / DAY_MS);

/** 0 = Sunday … 6 = Saturday. */
export const weekday = (date: IsoDate): number => new Date(parse(date)).getUTCDay();

/** Nights a stay occupies: from check-in up to, not including, check-out. */
export const nightsOf = (checkIn: IsoDate, checkOut: IsoDate): readonly IsoDate[] =>
  Array.from({ length: Math.max(0, diffDays(checkIn, checkOut)) }, (_, i) => addDays(checkIn, i));
