import { addDays, type IsoDate } from './dates';
import { zonedToUtc } from './tz';

export interface CancellationPolicy {
  readonly freeDaysBefore: number;
  /** `HH:MM`, hotel local time. */
  readonly freeUntil: string;
}

export const DEFAULT_CANCELLATION_POLICY: CancellationPolicy = { freeDaysBefore: 2, freeUntil: '14:00' };

export const cancellationDeadline = (checkIn: IsoDate, policy: CancellationPolicy, tz: string): Date =>
  zonedToUtc(addDays(checkIn, -policy.freeDaysBefore), policy.freeUntil, tz);

export interface PenaltyQuote {
  readonly deadline: string;
  readonly free: boolean;
  readonly penalty: number;
}

/** Free strictly before the deadline; at or after it the penalty is the first night's price. */
export const cancellationPenalty = (input: {
  now: Date;
  checkIn: IsoDate;
  policy: CancellationPolicy;
  tz: string;
  firstNightPrice: number;
}): PenaltyQuote => {
  const deadline = cancellationDeadline(input.checkIn, input.policy, input.tz);
  const free = input.now.getTime() < deadline.getTime();
  return { deadline: deadline.toISOString(), free, penalty: free ? 0 : input.firstNightPrice };
};
