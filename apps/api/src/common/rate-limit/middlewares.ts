import type { NextFunction, Request, Response } from 'express';
import { domainError, ERROR_STATUS, type DomainError } from '@hotel/shared';
import { clientIp } from './client-ip';
import type { CounterStore } from './store';

const reply = (res: Response, e: DomainError, retryAfterSec: number): void => {
  res.setHeader('Retry-After', String(retryAfterSec));
  res.status(ERROR_STATUS[e.code]).json(e);
};

/** General limit per IP. Fails open: if the store is down, requests pass. */
export const createGeneralLimiter =
  (store: CounterStore, perMin: number) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.path === '/api/health') return next();
    try {
      const count = await store.incr(`rl:general:${clientIp(req)}`, 60);
      if (count > perMin) {
        const wait = Math.max(1, await store.ttl(`rl:general:${clientIp(req)}`));
        return reply(res, domainError('RATE_LIMITED', 'Too many requests', { retryAfterSec: wait }), wait);
      }
    } catch {
      return next();
    }
    next();
  };

/** Channel endpoints: counted per channel key (hashed by the caller), not per IP. */
export const createChannelLimiter =
  (store: CounterStore, perMin: number, apiKeyId: (req: Request) => string) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const key = `rl:channel:${apiKeyId(req)}`;
      if ((await store.incr(key, 60)) > perMin) {
        const wait = Math.max(1, await store.ttl(key));
        return reply(res, domainError('RATE_LIMITED', 'Channel rate limit exceeded', { retryAfterSec: wait }), wait);
      }
    } catch {
      return next();
    }
    next();
  };

/** Guest manage-link lookups: only FAILED lookups (unknown token) count, per IP. */
export const guestLinkLimiter = (store: CounterStore, perMin: number) => ({
  check: async (req: Pick<Request, 'ip' | 'socket'>): Promise<DomainError | null> => {
    const key = `rl:guestlink:${clientIp(req)}`;
    if ((await store.get(key)) >= perMin) {
      return domainError('RATE_LIMITED', 'Too many failed lookups, try again later', { retryAfterSec: Math.max(1, await store.ttl(key)) });
    }
    return null;
  },
  recordMiss: async (req: Pick<Request, 'ip' | 'socket'>): Promise<void> => {
    await store.incr(`rl:guestlink:${clientIp(req)}`, 60);
  },
});
