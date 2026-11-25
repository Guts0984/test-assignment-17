import type { Clock } from './tokens';

export const systemClock: Clock = { now: () => new Date() };

/** A clock tests can move. */
export const createManualClock = (start: Date): Clock & { set: (iso: string) => void } => {
  let current = start;
  return { now: () => current, set: (iso: string) => void (current = new Date(iso)) };
};
