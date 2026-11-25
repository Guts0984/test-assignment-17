import { describe, expect, it } from 'vitest';
import { withMetrics } from './metrics';

describe('report metrics', () => {
  it('computes occupancy, ADR and RevPAR', () => {
    expect(withMetrics({ availableNights: 200, soldNights: 150, revenue: 1_500_000 })).toEqual({
      availableNights: 200, soldNights: 150, revenue: 1_500_000, occupancy: 0.75, adr: 10_000, revPar: 7_500,
    });
  });

  it('does not divide by zero', () => {
    expect(withMetrics({ availableNights: 0, soldNights: 0, revenue: 0 })).toMatchObject({ occupancy: 0, adr: 0, revPar: 0 });
  });
});
