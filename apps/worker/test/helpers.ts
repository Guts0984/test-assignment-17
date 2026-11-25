import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { createDb, checkConsistency, type Db } from '@hotel/db';
import { addDays, nightsOf } from '@hotel/shared';
import { createWorkerApp, type WorkerApp } from '../src/app';
import { parseEnv, type Env } from '../src/config/env';

/** Tests run in the past (year 2020) so they never touch work of other suites. */
export const PAST_TODAY = '2020-01-10';

export const testEnv = (overrides: Record<string, string> = {}): Env =>
  parseEnv({ ...process.env, REDIS_URL: `${process.env.TEST_REDIS_BASE ?? 'redis://127.0.0.1:56379'}/15`, RECONCILE_INTERVAL_MS: '300', CHANNEL_DEBOUNCE_MS: '0', ...overrides });

export const openDb = (env: Env): Db => createDb(env.databaseUrl);

/** Every test file starts from an empty queue database: jobs (retries, delays) left by an earlier run must not leak in. */
export const resetTestRedis = async (): Promise<void> => {
  const redis = new Redis(testEnv().REDIS_URL);
  await redis.flushdb();
  redis.disconnect();
};

export const startWorkers = (env: Env, now: () => Date, copies = 1, reconciler = false): Promise<WorkerApp[]> =>
  Promise.all(Array.from({ length: copies }, () => createWorkerApp({ env, now, reconciler, logger: false })));

export interface Fixture {
  readonly hotelId: string;
  readonly roomTypeId: string;
}

/** A fresh hotel: `rooms` rooms of one type, rates for 60 days from `today`, connected to the channel. */
export const createFixture = async (
  db: Db,
  opts: { rooms: number; timezone?: string; today?: string; connected?: boolean },
): Promise<Fixture> => {
  const today = opts.today ?? PAST_TODAY;
  const hotelId = randomUUID();
  const roomTypeId = randomUUID();
  const code = `W${hotelId.slice(0, 8)}`;
  await db.$executeRaw`
    INSERT INTO hotel (id, code, name, timezone, currency, check_in_time, check_out_time, audit_time, last_closed_date, listed)
    VALUES (${hotelId}::uuid, ${code}, ${code}, ${opts.timezone ?? 'Europe/Lisbon'}, 'EUR', '14:00', '12:00', '03:00', ${addDays(today, -1)}::date, false)`;
  await db.$executeRaw`INSERT INTO room_type (id, hotel_id, code, name, rank, max_guests) VALUES (${roomTypeId}::uuid, ${hotelId}::uuid, 'STD', 'Standard', 1, 3)`;
  for (let i = 0; i < opts.rooms; i += 1) {
    await db.$executeRaw`INSERT INTO room (id, hotel_id, room_type_id, number, status) VALUES (${randomUUID()}::uuid, ${hotelId}::uuid, ${roomTypeId}::uuid, ${`1${i}`}, 'clean')`;
  }
  const nights = nightsOf(today, addDays(today, 60));
  await db.$executeRaw`INSERT INTO rate (room_type_id, night, price) SELECT ${roomTypeId}::uuid, n, 10000 FROM unnest(${nights as string[]}::date[]) AS n`;
  if (opts.connected !== false) await db.$executeRaw`INSERT INTO channel_room_type (room_type_id) VALUES (${roomTypeId}::uuid)`;
  return { hotelId, roomTypeId };
};

/** Polls until `check` passes. No fixed sleeps. */
export const waitFor = async <T>(check: () => Promise<T | undefined | false>, what: string, timeoutMs = 30_000): Promise<T> => {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

export const assertConsistent = async (db: Db): Promise<void> => {
  const r = await db.$transaction((tx) => checkConsistency(tx));
  if (r.counterMismatches.length > 0 || r.negatives > 0 || r.folioMismatches.length > 0) throw new Error(`Inconsistent: ${JSON.stringify(r)}`);
};

export const num = async (rows: Promise<{ n: bigint }[]>): Promise<number> => Number((await rows)[0]?.n ?? 0);

export interface Received {
  readonly signature: string | undefined;
  readonly raw: string;
  readonly status: number;
}

export interface PushServer {
  readonly url: string;
  readonly received: Received[];
  readonly close: () => Promise<void>;
}

/** Tiny channel: `answer(n)` picks the status for the n-th request (1-based) and may do work first. */
export const startPushServer = async (answer: (n: number) => Promise<number>): Promise<PushServer> => {
  const { createServer } = await import('node:http');
  const received: Received[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const n = received.length + 1;
      const raw = Buffer.concat(chunks).toString('utf8');
      const signature = typeof req.headers['x-signature'] === 'string' ? req.headers['x-signature'] : undefined;
      answer(n).then((status) => {
        received.push({ signature, raw, status });
        res.statusCode = status;
        res.end('{}');
      }, () => {
        res.statusCode = 500;
        res.end();
      });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { url: `http://127.0.0.1:${port}/push`, received, close: () => new Promise((r) => server.close(() => r())) };
};
