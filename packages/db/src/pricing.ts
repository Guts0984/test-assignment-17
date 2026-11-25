import { checkRestrictions, nightsOf, quoteStay, domainError, err, ok, type DayRestriction, type DomainError, type NightPrice, type Result } from '@hotel/shared';
import type { Tx } from './client';

/** Reads rates and restrictions for the stay and applies the shared rules. */
export const quoteAndCheck = async (
  tx: Tx,
  input: { roomTypeId: string; checkIn: string; checkOut: string; enforceRestrictions?: boolean },
): Promise<Result<{ nights: readonly NightPrice[]; total: number }, DomainError>> => {
  const nights = nightsOf(input.checkIn, input.checkOut);
  const dates = [...nights, input.checkOut];
  const rates = await tx.$queryRaw<{ night: string; price: number }[]>`
    SELECT night::text, price FROM rate WHERE room_type_id = ${input.roomTypeId}::uuid AND night = ANY(${nights as string[]}::date[])`;
  const rs = await tx.$queryRaw<{ night: string; min_stay: number | null; cta: boolean; ctd: boolean; stop: boolean }[]>`
    SELECT night::text, min_stay, closed_to_arrival AS cta, closed_to_departure AS ctd, stop_sell AS stop
    FROM restriction WHERE room_type_id = ${input.roomTypeId}::uuid AND night = ANY(${dates as string[]}::date[])`;
  const byNight = new Map<string, DayRestriction>(
    rs.map((r) => [r.night, { minStay: r.min_stay, closedToArrival: r.cta, closedToDeparture: r.ctd, stopSell: r.stop }]),
  );
  const violations = input.enforceRestrictions === false ? [] : checkRestrictions(input.checkIn, input.checkOut, (d) => byNight.get(d));
  if (violations.length > 0) {
    return err(domainError('RESTRICTION_VIOLATED', violations.map((v) => v.message).join('; '), violations));
  }
  const priceMap = new Map(rates.map((r) => [r.night, r.price]));
  const quote = quoteStay(nights, (d) => priceMap.get(d));
  if (!quote) return err(domainError('NO_AVAILABILITY', 'No rates for some of the nights'));
  return ok(quote);
};
