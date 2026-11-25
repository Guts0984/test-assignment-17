import { closeDueDates } from '@hotel/db';
import type { WorkerDeps } from '../infra/deps';

export interface NightAuditData {
  readonly hotelId: string;
}

/** Closes every due hotel date one by one, in order. The db function serializes copies and is exactly-once per date. */
export const runNightAudit = (deps: Pick<WorkerDeps, 'db' | 'now'>, data: NightAuditData): Promise<number> => closeDueDates(deps, data.hotelId);
