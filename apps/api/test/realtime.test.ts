import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { addDays } from '@hotel/shared';
import { bookStay, createFixture, createStaff, loginAs, startApp, TEST_TODAY, uniqueEmail, type TestApp } from './helpers';

let a: TestApp;
let b: TestApp;
const sockets: Socket[] = [];

beforeAll(async () => {
  [a, b] = await Promise.all([startApp(), startApp()]);
});
afterAll(async () => {
  sockets.forEach((s) => s.disconnect());
  await Promise.all([a.close(), b.close()]);
});

const connect = (app: TestApp, token: string | null): Promise<Socket> =>
  new Promise((resolve, reject) => {
    const s = io(app.url, { path: '/socket.io', auth: token ? { token } : {}, transports: ['websocket'], reconnection: false });
    sockets.push(s);
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
    s.on('disconnect', () => resolve(s));
  });

const join = (s: Socket, hotelId: string): Promise<{ ok: boolean; code?: string; joined?: string[] }> => s.timeout(5000).emitWithAck('join', { hotelId });

const waitFor = (s: Socket, event: string, ms: number): Promise<number> =>
  new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setTimeout(() => reject(new Error(`no ${event} within ${ms} ms`)), ms);
    s.once(event, () => {
      clearTimeout(timer);
      resolve(Date.now() - started);
    });
  });

describe('live updates and socket permissions', () => {
  it('a booking made through copy B reaches a revenue manager connected to copy A in under a second', async () => {
    const f = await createFixture(a.db, { rooms: 3 });
    const email = uniqueEmail('rev');
    await createStaff(a.db, { email, password: 'pass-12345678', roles: [{ hotelId: f.hotelId, role: 'revenue' }] });
    const token = await loginAs(a, email, 'pass-12345678', '127.0.7.1');
    const socket = await connect(a, token);
    const joined = await join(socket, f.hotelId);
    expect(joined).toMatchObject({ ok: true });
    const changed = waitFor(socket, 'grid:changed', 1000);
    const r = await bookStay(b, f, addDays(TEST_TODAY, 4), addDays(TEST_TODAY, 6), { confirm: false });
    expect(r.holdStatus).toBeLessThan(300);
    expect(await changed).toBeLessThan(1000);
  });

  it('refuses sockets without a token, other hotels, and feeds the role may not see', async () => {
    const mine = await createFixture(a.db, { rooms: 1 });
    const other = await createFixture(a.db, { rooms: 1 });
    const email = uniqueEmail('hk');
    await createStaff(a.db, { email, password: 'pass-12345678', roles: [{ hotelId: mine.hotelId, role: 'housekeeper' }] });
    const token = await loginAs(a, email, 'pass-12345678', '127.0.7.2');

    const anonymous = await connect(a, null);
    await expect.poll(() => anonymous.connected, { timeout: 3000 }).toBe(false);

    const socket = await connect(a, token);
    expect(await join(socket, other.hotelId)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    const own = await join(socket, mine.hotelId);
    expect(own.ok).toBe(true);
    expect(own.joined).toEqual(['rooms']);
  });
});
