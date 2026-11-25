import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CANCELLATION_POLICY,
  WEEKEND_NIGHTS,
  addDays,
  applyRateChange,
  auditInstant,
  cancellationPenalty,
  checkRestrictions,
  hotelDateAt,
  nightsOf,
  quoteStay,
  weekday,
  zonedToUtc,
} from '../src';

describe('cancellation in Lisbon', () => {
  // Arrival 2026-07-15: free until 14:00 local on 2026-07-13. Lisbon is UTC+1 in July.
  const base = { checkIn: '2026-07-15', policy: DEFAULT_CANCELLATION_POLICY, tz: 'Europe/Lisbon', firstNightPrice: 12_000 };

  it('13:59 two days before arrival is free', () => {
    expect(cancellationPenalty({ ...base, now: new Date('2026-07-13T12:59:00Z') })).toMatchObject({ free: true, penalty: 0, deadline: '2026-07-13T13:00:00.000Z' });
  });

  it('14:01 two days before arrival charges the first night', () => {
    expect(cancellationPenalty({ ...base, now: new Date('2026-07-13T13:01:00Z') })).toMatchObject({ free: false, penalty: 12_000 });
  });

  it('in winter Lisbon is UTC+0', () => {
    const q = cancellationPenalty({ ...base, checkIn: '2026-01-15', now: new Date('2026-01-13T13:59:00Z') });
    expect(q.free).toBe(true);
    expect(q.deadline).toBe('2026-01-13T14:00:00.000Z');
  });
});

describe('min stay', () => {
  const friday = '2026-06-05';
  const get = (d: string) => (d === friday ? { minStay: 3 } : undefined);

  it('Fri–Sun is rejected when a Friday arrival needs 3 nights', () => {
    expect(weekday(friday)).toBe(5);
    expect(checkRestrictions(friday, addDays(friday, 2), get).map((x) => x.code)).toEqual(['MIN_STAY']);
  });

  it('Thu–Sun passes (min stay is read from the arrival night)', () => {
    expect(checkRestrictions(addDays(friday, -1), addDays(friday, 2), get)).toEqual([]);
  });

  it('stop-sell on any night, closed-to-arrival and closed-to-departure on their dates', () => {
    const v = checkRestrictions('2026-06-01', '2026-06-04', (d) =>
      d === '2026-06-02' ? { stopSell: true } : d === '2026-06-04' ? { closedToDeparture: true } : d === '2026-06-01' ? { closedToArrival: true } : undefined,
    );
    expect(v.map((x) => x.code).sort()).toEqual(['CLOSED_TO_ARRIVAL', 'CLOSED_TO_DEPARTURE', 'STOP_SELL']);
  });
});

describe('Kyiv DST', () => {
  const tz = 'Europe/Kyiv';

  it('spring forward 2026-03-29: 03:00 does not exist, audit runs at 04:00 EEST = 01:00Z', () => {
    expect(auditInstant('2026-03-28', '03:00', tz).toISOString()).toBe('2026-03-29T01:00:00.000Z');
    expect(hotelDateAt(new Date('2026-03-29T00:59:00Z'), '03:00', tz)).toBe('2026-03-28');
    expect(hotelDateAt(new Date('2026-03-29T01:00:00Z'), '03:00', tz)).toBe('2026-03-29');
    expect(auditInstant('2026-03-29', '03:00', tz).toISOString()).toBe('2026-03-30T00:00:00.000Z');
  });

  it('fall back 2026-10-25: 03:00 happens twice, audit runs at the first (EEST, 00:00Z)', () => {
    expect(auditInstant('2026-10-24', '03:00', tz).toISOString()).toBe('2026-10-25T00:00:00.000Z');
    expect(hotelDateAt(new Date('2026-10-24T23:59:00Z'), '03:00', tz)).toBe('2026-10-24');
    expect(hotelDateAt(new Date('2026-10-25T00:00:00Z'), '03:00', tz)).toBe('2026-10-25');
    expect(hotelDateAt(new Date('2026-10-25T01:30:00Z'), '03:00', tz)).toBe('2026-10-25');
    expect(auditInstant('2026-10-25', '03:00', tz).toISOString()).toBe('2026-10-26T01:00:00.000Z');
  });

  it('a regular day', () => {
    expect(zonedToUtc('2026-06-01', '14:00', tz).toISOString()).toBe('2026-06-01T11:00:00.000Z');
  });
});

describe('price', () => {
  it('sums nightly prices with a weekend +15 %', () => {
    const nights = nightsOf('2026-06-04', '2026-06-08'); // Thu Fri Sat Sun
    const rates = new Map(nights.map((d) => [d, applyRateChange(d, 320_000, { adjustPercent: 15, weekdays: WEEKEND_NIGHTS })]));
    const q = quoteStay(nights, (d) => rates.get(d));
    expect(q?.nights.map((n) => n.price)).toEqual([320_000, 368_000, 368_000, 320_000]);
    expect(q?.total).toBe(1_376_000);
  });

  it('a night without a rate is not sellable', () => {
    expect(quoteStay(['2026-06-01'], () => undefined)).toBeNull();
  });
});
