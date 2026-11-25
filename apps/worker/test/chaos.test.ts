import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { confirmHold, createHold } from '@hotel/db';
import { addDays, hotelDateAt } from '@hotel/shared';
import { createStub } from '../../channel-stub/src/server';
import { createFixture, openDb, resetTestRedis, startWorkers, testEnv, waitFor } from './helpers';

const db = openDb(testEnv());
beforeAll(resetTestRedis);
afterAll(async () => {
  await db.$disconnect();
});

interface StubState {
  stats: { failedOnPurpose: number };
  roomTypes: { roomTypeId: string; version: number; nights: { night: string; available: number }[] }[];
}

describe('channel in chaos mode (every 5th push fails with 500, every 10th hangs)', () => {
  it('every change reaches the channel after retries, versions never go backwards, nothing stale stays', async () => {
    // real time: the reconciler also audits hotels that are behind the clock, so the hotel must not be
    const today = hotelDateAt(new Date(), '03:00', 'Europe/Lisbon');
    const f = await createFixture(db, { rooms: 6, today });
    const base = testEnv();
    const stub = createStub({ port: 0, targets: [], apiKey: 'unused', hmacSecret: base.CHANNEL_HMAC_SECRET, chaos: true, hangMs: 1500 });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
    const env = testEnv({ CHANNEL_PUSH_URL: `${url}/push`, CHANNEL_PUSH_DAYS: '16', CHANNEL_PUSH_TIMEOUT_MS: '700', CHANNEL_DEBOUNCE_MS: '0' });
    const [worker] = await startWorkers(env, () => new Date(), 1, true);
    if (!worker) throw new Error('no worker');
    const state = async (): Promise<StubState> => (await fetch(`${url}/state`)).json() as Promise<StubState>;
    const seen: number[] = [];
    try {
      const now = (): Date => new Date();
      for (let i = 0; i < 14; i += 1) {
        const h = await createHold({ db, now, holdMinutes: 10 }, { hotelId: f.hotelId, roomTypeId: f.roomTypeId, checkIn: addDays(today, 1 + (i % 12)), checkOut: addDays(today, 2 + (i % 12)), guests: 2 });
        if (!h.ok) throw new Error(h.error.message);
        await confirmHold({ db, now, holdMinutes: 10, manageUrl: (t) => t }, h.value.token, { guestName: 'G', guestEmail: 'g@test.local', guestPhone: '1' });
        await db.$executeRaw`INSERT INTO channel_dirty (room_type_id, dirty_at) VALUES (${f.roomTypeId}::uuid, now()) ON CONFLICT (room_type_id) DO UPDATE SET dirty_at = now()`;
        const v = (await state()).roomTypes.find((r) => r.roomTypeId === f.roomTypeId)?.version;
        if (v !== undefined) seen.push(v);
        await new Promise((r) => setTimeout(r, 120));
      }
      const current = async (): Promise<Map<string, number>> =>
        new Map((await db.$queryRaw<{ night: string; free: number }[]>`
          SELECT night::text, (total - ooo - (sold - overbooked + held))::int AS free FROM inventory WHERE room_type_id = ${f.roomTypeId}::uuid`).map((r) => [r.night, r.free]));
      await waitFor(async () => {
        const s = await state();
        const v = s.roomTypes.find((r) => r.roomTypeId === f.roomTypeId);
        if (!v) return false;
        seen.push(v.version);
        const want = await current();
        return [...want].every(([night, free]) => v.nights.find((n) => n.night === night)?.available === free);
      }, 'the channel to show the current availability');
      expect((await state()).stats.failedOnPurpose).toBeGreaterThanOrEqual(1);
      expect(seen.every((v, i) => i === 0 || v >= (seen[i - 1] ?? 0))).toBe(true);
    } finally {
      await worker.close();
      await new Promise((r) => stub.close(r));
    }
  });
});
