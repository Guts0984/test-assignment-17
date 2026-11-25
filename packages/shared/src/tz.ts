import { addDays, type IsoDate } from './dates';

const formatters = new Map<string, Intl.DateTimeFormat>();

const formatter = (tz: string): Intl.DateTimeFormat => {
  const cached = formatters.get(tz);
  if (cached) return cached;
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  formatters.set(tz, f);
  return f;
};

/** Wall-clock time of `instantMs` in `tz`, expressed as if it were UTC milliseconds. */
const wallMs = (instantMs: number, tz: string): number => {
  const p: Record<string, number> = {};
  for (const part of formatter(tz).formatToParts(new Date(instantMs))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
};

export const tzOffsetMs = (instant: Date, tz: string): number => {
  const ms = instant.getTime() - instant.getMilliseconds();
  return wallMs(ms, tz) - ms;
};

export const localDate = (instant: Date, tz: string): IsoDate => new Date(wallMs(instant.getTime(), tz)).toISOString().slice(0, 10);

/**
 * Hotel-local date + `HH:MM` to a UTC instant.
 * Ambiguous wall time (fall-back): the FIRST occurrence.
 * Non-existent wall time (spring-forward gap): shifted forward by the gap.
 */
export const zonedToUtc = (date: IsoDate, time: string, tz: string): Date => {
  const [h, m] = time.split(':').map(Number);
  const wall = Date.parse(`${date}T00:00:00Z`) + (h * 60 + m) * 60_000;
  const offsets = new Set([-86_400_000, 0, 86_400_000].map((d) => tzOffsetMs(new Date(wall + d), tz)));
  const matches = [...offsets]
    .map((o) => wall - o)
    .filter((t) => wallMs(t, tz) === wall)
    .sort((a, b) => a - b);
  if (matches.length > 0) return new Date(matches[0]);
  return new Date(wall - tzOffsetMs(new Date(wall - 86_400_000), tz));
};

/** The moment the night audit closes `hotelDate`: audit time on the next calendar day. */
export const auditInstant = (hotelDate: IsoDate, auditTime: string, tz: string): Date => zonedToUtc(addDays(hotelDate, 1), auditTime, tz);

/** Hotel date of an instant: before the audit time it is still the previous day. */
export const hotelDateAt = (instant: Date, auditTime: string, tz: string): IsoDate => {
  const local = localDate(instant, tz);
  return instant.getTime() < zonedToUtc(local, auditTime, tz).getTime() ? addDays(local, -1) : local;
};
