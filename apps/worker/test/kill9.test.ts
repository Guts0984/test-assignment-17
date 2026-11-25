import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { addDays, hotelDateAt, nightsOf } from '@hotel/shared';
import type { Db } from '@hotel/db';
import { createFixture, openDb, testEnv } from './helpers';

const env = testEnv({ RECONCILE_INTERVAL_MS: '200' });
const children: ChildProcess[] = [];
let db: Db;

beforeAll(async () => {
  db = openDb(env);
  const redis = new Redis(env.REDIS_URL);
  await redis.flushdb();
  redis.disconnect();
});

afterAll(async () => {
  for (const c of children) c.kill('SIGKILL');
  await db.$disconnect();
});

/** A real worker process (the built app), so that SIGKILL really kills it in the middle of its work. */
const spawnWorker = (): ChildProcess => {
  const child = spawn('node', [resolve(__dirname, '../dist/main.js')], {
    cwd: resolve(__dirname, '..'),
    env: { ...process.env, REDIS_URL: env.REDIS_URL, RECONCILE_INTERVAL_MS: '200', LOG_LEVEL: 'error' },
    stdio: 'ignore',
  });
  children.push(child);
  return child;
};

const count = async (sql: Promise<{ n: bigint }[]>): Promise<number> => Number((await sql)[0].n);

describe('kill -9 of a worker in the middle of the night audit', () => {
  it('the rest is finished by another worker: every date once, in order, no double charges', async () => {
    const now = new Date();
    const realToday = hotelDateAt(now, '03:00', 'Europe/Lisbon');
    const start = addDays(realToday, -12);
    const f = await createFixture(db, { rooms: 3, today: start });
    const stays = Array.from({ length: 6 }, () => randomUUID());
    for (const id of stays) {
      await db.$executeRaw`
        INSERT INTO booking (id, code, hotel_id, room_type_id, check_in, check_out, guests, status, source, guest_name, guest_email, total_price, currency, token_hash)
        VALUES (${id}::uuid, ${`K9-${id.slice(0, 8)}`}, ${f.hotelId}::uuid, ${f.roomTypeId}::uuid, ${start}::date, ${addDays(start, 30)}::date, 2, 'checked_in', 'web', 'Long Stay', 'k9@test.local', 300000, 'EUR', ${id})`;
      await db.$executeRaw`INSERT INTO booking_night (booking_id, night, price) SELECT ${id}::uuid, n, 10000 FROM unnest(${nightsOf(start, addDays(start, 30)) as string[]}::date[]) AS n`;
    }
    // Other test files leave hotels dated in 2020 behind. A real worker would also catch those up (thousands of
    // dates), which says nothing about this test, so every other hotel in the test database is brought up to date first.
    await db.$executeRaw`UPDATE hotel SET last_closed_date = ${addDays(realToday, -1)}::date WHERE id <> ${f.hotelId}::uuid AND last_closed_date < ${addDays(realToday, -1)}::date`;
    const expectedDates = 12; // start .. realToday - 1, as the audit of each date is due 03:00 the next day
    const closed = (): Promise<number> => count(db.$queryRaw`SELECT count(*) n FROM night_audit WHERE hotel_id = ${f.hotelId}::uuid`);

    const first = spawnWorker();
    await expect.poll(closed, { timeout: 60_000, interval: 50 }).toBeGreaterThanOrEqual(3);
    first.kill('SIGKILL');
    const atKill = await closed();
    expect(atKill).toBeLessThan(expectedDates);

    spawnWorker();
    await expect.poll(closed, { timeout: 90_000, interval: 200 }).toBe(expectedDates);

    const dates = await db.$queryRaw<{ hotel_date: string }[]>`SELECT hotel_date::text FROM night_audit WHERE hotel_id = ${f.hotelId}::uuid ORDER BY closed_at, hotel_date`;
    expect(dates.map((d) => d.hotel_date)).toEqual(nightsOf(start, addDays(start, expectedDates)));
    expect(await count(db.$queryRaw`SELECT count(*) n FROM folio_line WHERE booking_id = ANY(${stays}::uuid[]) AND category = 'room'`)).toBe(expectedDates * stays.length);
    expect(await count(db.$queryRaw`SELECT count(*) n FROM (SELECT idem_key FROM folio_line WHERE booking_id = ANY(${stays}::uuid[]) GROUP BY idem_key HAVING count(*) > 1) d`)).toBe(0);
    const [h] = await db.$queryRaw<{ last: string }[]>`SELECT last_closed_date::text AS last FROM hotel WHERE id = ${f.hotelId}::uuid`;
    expect(h.last).toBe(addDays(realToday, -1));
  });
});
