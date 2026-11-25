import { domainError, err, ok, type DomainError, type Result } from '@hotel/shared';
import type { CounterStore } from './store';

export interface LoginLimits {
  readonly maxPerIpEmail: number;
  readonly maxPerIp: number;
  readonly maxPerEmail: number;
  readonly windowSec: number;
  readonly blockSec: number;
}

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const keysOf = (ip: string, email: string) =>
  [
    { id: `ipe:${ip}:${email}`, max: (l: LoginLimits) => l.maxPerIpEmail },
    { id: `ip:${ip}`, max: (l: LoginLimits) => l.maxPerIp },
    { id: `email:${email}`, max: (l: LoginLimits) => l.maxPerEmail },
  ] as const;

const counter = (id: string): string => `login:fail:${id}`;
const block = (id: string): string => `login:block:${id}`;

export const rateLimited = (retryAfterSec: number): DomainError =>
  domainError('RATE_LIMITED', 'Too many failed attempts, try again later', { retryAfterSec });

/** Returns RATE_LIMITED while any of the three keys is blocked: checked before the password. */
export const checkLoginBlock = async (store: CounterStore, ip: string, rawEmail: string): Promise<Result<true, DomainError>> => {
  const email = normalizeEmail(rawEmail);
  const ttls = await Promise.all(keysOf(ip, email).map((k) => store.ttl(block(k.id))));
  const longest = Math.max(0, ...ttls);
  return longest > 0 ? err(rateLimited(longest)) : ok(true);
};

/** Counts a failure on all three keys and starts a block on every key that reached its limit. */
export const recordLoginFailure = async (store: CounterStore, limits: LoginLimits, ip: string, rawEmail: string): Promise<void> => {
  const email = normalizeEmail(rawEmail);
  await Promise.all(
    keysOf(ip, email).map(async (k) => {
      const count = await store.incr(counter(k.id), limits.windowSec);
      if (count >= k.max(limits)) await store.setFlag(block(k.id), limits.blockSec);
    }),
  );
};

/** A successful login resets only the (ip, email) counter. */
export const resetLoginCounter = (store: CounterStore, ip: string, rawEmail: string): Promise<void> =>
  store.del(counter(`ipe:${ip}:${normalizeEmail(rawEmail)}`));
