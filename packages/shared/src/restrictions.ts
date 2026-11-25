import { nightsOf, type IsoDate } from './dates';

export interface DayRestriction {
  readonly minStay?: number | null;
  readonly closedToArrival?: boolean;
  readonly closedToDeparture?: boolean;
  readonly stopSell?: boolean;
}

export type RestrictionCode = 'MIN_STAY' | 'CLOSED_TO_ARRIVAL' | 'CLOSED_TO_DEPARTURE' | 'STOP_SELL';

export interface RestrictionViolation {
  readonly code: RestrictionCode;
  readonly date: IsoDate;
  readonly message: string;
}

/**
 * Min stay is read from the arrival night; closed-to-arrival from check-in;
 * closed-to-departure from check-out; stop-sell from every night.
 */
export const checkRestrictions = (
  checkIn: IsoDate,
  checkOut: IsoDate,
  get: (date: IsoDate) => DayRestriction | undefined,
): readonly RestrictionViolation[] => {
  const nights = nightsOf(checkIn, checkOut);
  const arrival = get(checkIn);
  const found: RestrictionViolation[] = [];
  if (arrival?.minStay && nights.length < arrival.minStay) {
    found.push({ code: 'MIN_STAY', date: checkIn, message: `Minimum stay for arrival on ${checkIn} is ${arrival.minStay} nights` });
  }
  if (arrival?.closedToArrival) found.push({ code: 'CLOSED_TO_ARRIVAL', date: checkIn, message: `Arrival on ${checkIn} is not allowed` });
  if (get(checkOut)?.closedToDeparture) found.push({ code: 'CLOSED_TO_DEPARTURE', date: checkOut, message: `Departure on ${checkOut} is not allowed` });
  for (const night of nights) {
    if (get(night)?.stopSell) found.push({ code: 'STOP_SELL', date: night, message: `Sales are closed for ${night}` });
  }
  return found;
};
