import type { Redis } from 'ioredis';

/** Atomic counters and flags with expiry. Used by every limiter. */
export interface CounterStore {
  /** Adds one; the window starts at the first hit. Returns the new count. */
  readonly incr: (key: string, windowSec: number) => Promise<number>;
  readonly get: (key: string) => Promise<number>;
  /** Marks the key as set for `ttlSec` seconds. */
  readonly setFlag: (key: string, ttlSec: number) => Promise<void>;
  /** Seconds left on a flag (0 if it is not set). */
  readonly ttl: (key: string) => Promise<number>;
  readonly del: (key: string) => Promise<void>;
  /** Takes one back (never below zero). */
  readonly decr: (key: string) => Promise<void>;
}

const INCR_LUA = `local c = redis.call('INCR', KEYS[1]); if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end; return c`;

export const createRedisStore = (redis: Redis): CounterStore => ({
  incr: async (key, windowSec) => Number(await redis.eval(INCR_LUA, 1, key, String(windowSec))),
  get: async (key) => Number((await redis.get(key)) ?? 0),
  setFlag: async (key, ttlSec) => void (await redis.set(key, '1', 'EX', ttlSec)),
  ttl: async (key) => Math.max(0, await redis.ttl(key)),
  del: async (key) => void (await redis.del(key)),
  decr: async (key) => void (await redis.eval("local c = redis.call('GET', KEYS[1]); if c and tonumber(c) > 0 then return redis.call('DECR', KEYS[1]) end; return 0", 1, key)),
});

interface Entry {
  count: number;
  expiresAt: number;
}

/** Per-process store, used when Redis is unreachable. */
export const createMemoryStore = (now: () => Date): CounterStore => {
  const entries = new Map<string, Entry>();
  const live = (key: string): Entry | undefined => {
    const e = entries.get(key);
    if (e && e.expiresAt <= now().getTime()) {
      entries.delete(key);
      return undefined;
    }
    return e;
  };
  return {
    incr: async (key, windowSec) => {
      const e = live(key);
      const next = { count: (e?.count ?? 0) + 1, expiresAt: e?.expiresAt ?? now().getTime() + windowSec * 1000 };
      entries.set(key, next);
      return next.count;
    },
    get: async (key) => live(key)?.count ?? 0,
    setFlag: async (key, ttlSec) => void entries.set(key, { count: 1, expiresAt: now().getTime() + ttlSec * 1000 }),
    ttl: async (key) => {
      const e = live(key);
      return e ? Math.max(1, Math.ceil((e.expiresAt - now().getTime()) / 1000)) : 0;
    },
    del: async (key) => void entries.delete(key),
    decr: async (key) => {
      const e = live(key);
      if (e && e.count > 0) entries.set(key, { ...e, count: e.count - 1 });
    },
  };
};

/** Uses the primary store; when it throws, the same call is answered by the fallback so limits keep working. */
export const createFallbackStore = (primary: CounterStore, fallback: CounterStore, onFallback: (e: unknown) => void): CounterStore => {
  const guarded =
    <A extends unknown[], R>(pick: (s: CounterStore) => (...a: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      try {
        return await pick(primary)(...args);
      } catch (e) {
        onFallback(e);
        return pick(fallback)(...args);
      }
    };
  return {
    incr: guarded((s) => s.incr),
    get: guarded((s) => s.get),
    setFlag: guarded((s) => s.setFlag),
    ttl: guarded((s) => s.ttl),
    del: guarded((s) => s.del),
    decr: guarded((s) => s.decr),
  };
};
