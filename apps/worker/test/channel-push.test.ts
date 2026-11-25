import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { confirmHold, createHold } from '@hotel/db';
import { addDays, channelPushSchema } from '@hotel/shared';
import { verifySignature } from '@hotel/shared/dist/hmac';
import { jobOptions } from '../src/infra/deps';
import { createFixture, num, openDb, PAST_TODAY, resetTestRedis, startPushServer, startWorkers, testEnv, waitFor } from './helpers';

const db = openDb(testEnv());
beforeAll(resetTestRedis);
afterAll(async () => {
  await db.$disconnect();
});

describe('channel push', () => {
  it('retries after a 500, versions only grow, signature is valid, payload is the CURRENT availability', async () => {
    const f = await createFixture(db, { rooms: 5 });
    const now = (): Date => new Date();
    const book = async (night: number): Promise<void> => {
      const h = await createHold({ db, now, holdMinutes: 10 }, { hotelId: f.hotelId, roomTypeId: f.roomTypeId, checkIn: addDays(PAST_TODAY, night), checkOut: addDays(PAST_TODAY, night + 1), guests: 2 });
      if (!h.ok) throw new Error(h.error.message);
      await confirmHold({ db, now, holdMinutes: 10, manageUrl: (t) => t }, h.value.token, { guestName: 'G', guestEmail: 'g@test.local', guestPhone: '1' });
    };
    await book(2);
    const server = await startPushServer(async (n) => {
      if (n === 1) {
        await book(3);
        return 500;
      }
      return 200;
    });
    const env = testEnv({ CHANNEL_PUSH_URL: server.url, CHANNEL_PUSH_DAYS: '10', CHANNEL_PUSH_TIMEOUT_MS: '2000' });
    const [w] = await startWorkers(env, now, 1);
    if (!w) throw new Error('no worker');
    try {
      await db.$executeRaw`INSERT INTO channel_dirty (room_type_id, dirty_at) VALUES (${f.roomTypeId}::uuid, now())`;
      await w.deps.queues.channelPush.add('push', { roomTypeId: f.roomTypeId }, jobOptions(env, `push-${f.roomTypeId}`));
      await waitFor(async () => server.received.some((r) => r.status === 200), 'a delivered push');
      await waitFor(async () => (await num(db.$queryRaw`SELECT count(*) n FROM channel_dirty WHERE room_type_id = ${f.roomTypeId}::uuid`)) === 0, 'dirty cleared');
      const pushes = server.received.map((r) => ({ status: r.status, sigOk: verifySignature(env.CHANNEL_HMAC_SECRET, r.raw, r.signature), body: channelPushSchema.parse(JSON.parse(r.raw)) }));
      expect(pushes.map((p) => p.status)).toEqual([500, 200]);
      expect(pushes.every((p) => p.sigOk)).toBe(true);
      const [first, second] = pushes;
      expect(second && first && second.body.version > first.body.version).toBe(true);
      const avail = (night: number): number | undefined => second?.body.nights.find((n) => n.night === addDays(PAST_TODAY, night))?.available;
      expect(second?.body.nights).toHaveLength(10);
      expect([avail(1), avail(2), avail(3)]).toEqual([5, 4, 4]);
      expect(first?.body.nights.find((n) => n.night === addDays(PAST_TODAY, 3))?.available).toBe(5);
      expect(second?.body.nights[0]?.price).toBe(10000);
      expect(verifySignature(env.CHANNEL_HMAC_SECRET, server.received[1]?.raw ?? '', 'bad')).toBe(false);
    } finally {
      await w.close();
      await server.close();
    }
  });
});
