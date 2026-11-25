export interface RawTotals {
  readonly availableNights: number;
  readonly soldNights: number;
  readonly revenue: number;
}

/** Occupancy (0..1), average daily rate and revenue per available room — money in minor units. */
export const withMetrics = (t: RawTotals) => ({
  ...t,
  occupancy: t.availableNights === 0 ? 0 : Math.round((t.soldNights / t.availableNights) * 10_000) / 10_000,
  adr: t.soldNights === 0 ? 0 : Math.round(t.revenue / t.soldNights),
  revPar: t.availableNights === 0 ? 0 : Math.round(t.revenue / t.availableNights),
});
