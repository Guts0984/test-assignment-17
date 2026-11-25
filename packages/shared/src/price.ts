import { weekday, type IsoDate } from './dates';

/** Friday and Saturday nights. */
export const WEEKEND_NIGHTS: readonly number[] = [5, 6];

export interface RateChange {
  /** Absolute price in minor units. */
  readonly price?: number;
  /** Percentage on the current price, e.g. 15 for +15 %. */
  readonly adjustPercent?: number;
  /** Apply only to these weekdays (0 = Sunday). */
  readonly weekdays?: readonly number[];
}

export const applyRateChange = (date: IsoDate, current: number | undefined, change: RateChange): number | undefined => {
  if (change.weekdays && change.weekdays.length > 0 && !change.weekdays.includes(weekday(date))) return current;
  if (change.price !== undefined) return change.price;
  if (change.adjustPercent !== undefined && current !== undefined) return Math.round((current * (100 + change.adjustPercent)) / 100);
  return current;
};

export interface NightPrice {
  readonly date: IsoDate;
  readonly price: number;
}

export interface StayQuote {
  readonly nights: readonly NightPrice[];
  readonly total: number;
}

/** Sum of nightly prices; `null` if any night has no rate (not sellable). */
export const quoteStay = (nights: readonly IsoDate[], priceOf: (date: IsoDate) => number | undefined): StayQuote | null => {
  const priced: NightPrice[] = [];
  for (const date of nights) {
    const price = priceOf(date);
    if (price === undefined) return null;
    priced.push({ date, price });
  }
  return { nights: priced, total: priced.reduce((s, n) => s + n.price, 0) };
};
