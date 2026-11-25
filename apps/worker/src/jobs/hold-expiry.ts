import { expireHold } from '@hotel/db';
import type { WorkerDeps } from '../infra/deps';

export interface HoldExpiryData {
  readonly bookingId: string;
}

/** Idempotent: only the caller whose conditional UPDATE wins releases the nights. */
export const runHoldExpiry = (deps: Pick<WorkerDeps, 'db' | 'now'>, data: HoldExpiryData): Promise<boolean> => expireHold(deps, data.bookingId);
