import { domainError, err, ok, type DomainError, type Result } from '@hotel/shared';
import { checkLoginBlock, markLoginTrusted, normalizeEmail, recordLoginFailure, resetLoginCounter, type LoginLimits } from '../../../common/rate-limit/login-limiter';
import type { CounterStore } from '../../../common/rate-limit/store';
import type { StaffIdentity, StaffRoleGrant } from '../../../common/auth/access';
import type { StaffRecord } from '../repo/staff.repo';

export interface LoginDeps {
  readonly store: CounterStore;
  readonly limits: LoginLimits;
  readonly findStaff: (email: string) => Promise<StaffRecord | null>;
  readonly verify: (hash: string, password: string) => Promise<boolean>;
  /** Hash of a random password: unknown emails are verified against it, so timing does not leak existence. */
  readonly dummyHash: () => Promise<string>;
  readonly sign: (staff: StaffIdentity) => string;
}

export interface LoginSuccess {
  readonly accessToken: string;
  readonly staff: { id: string; email: string; name: string; roles: StaffRoleGrant[] };
}

const invalid = (): DomainError => domainError('INVALID_CREDENTIALS', 'Invalid email or password');

/**
 * 1. check the block (before the password, so a blocked client gets 429 even with the right password)
 * 2. verify the password (always, even for unknown emails)
 * 3. failure: count on ip+email, ip and email; the same 401 for every kind of failure
 */
export const createLoginFlow = (deps: LoginDeps) => ({
  login: async (input: { ip: string; email: string; password: string }): Promise<Result<LoginSuccess, DomainError>> => {
    const email = normalizeEmail(input.email);
    const blocked = await checkLoginBlock(deps.store, input.ip, email);
    if (!blocked.ok) return blocked;
    const staff = await deps.findStaff(email);
    const valid = await deps.verify(staff?.passwordHash ?? (await deps.dummyHash()), input.password);
    if (!staff || !valid) {
      await recordLoginFailure(deps.store, deps.limits, input.ip, email);
      return err(invalid());
    }
    await resetLoginCounter(deps.store, input.ip, email);
    await markLoginTrusted(deps.store, input.ip, email);
    const identity: StaffIdentity = { id: staff.id, name: staff.name, roles: staff.roles };
    return ok({ accessToken: deps.sign(identity), staff: { id: staff.id, email: staff.email, name: staff.name, roles: [...staff.roles] } });
  },
});
