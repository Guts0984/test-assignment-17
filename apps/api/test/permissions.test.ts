import { randomInt, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newToken } from '@hotel/db';
import { addDays } from '@hotel/shared';
import { createApp } from '../src/app';
import { parseEnv } from '../src/config/env';
import { client, createFixture, startApp, TEST_TODAY, type TestApp } from './helpers';
import { confirmedBooking, freshIp, makeStaff } from './staff-helpers';

let app: TestApp;
let docsPort = 0;
let closeDocs = async (): Promise<void> => undefined;
beforeAll(async () => {
  app = await startApp({ RATE_LIMIT_GLOBAL_PER_MIN: '100000' });
  const nest = await createApp({ env: parseEnv({ ...process.env, RATE_LIMIT_GLOBAL_PER_MIN: '100000', TRUSTED_PROXY_CIDRS: '' }), docs: true });
  await nest.listen(0, '0.0.0.0');
  docsPort = (nest.getHttpServer().address() as AddressInfo).port;
  closeDocs = () => nest.close();
});
afterAll(async () => {
  await closeDocs();
  await app.close();
});

const PUBLIC = [/^\/api\/auth\/login$/, /^\/api\/health/, /^\/api\/channel\//, /^\/api\/hotels$/, /^\/api\/search$/, /^\/api\/holds/, /^\/api\/manage\//];
const isErrorShape = (b: unknown): boolean => typeof b === 'object' && b !== null && typeof (b as { code?: unknown }).code === 'string' && typeof (b as { message?: unknown }).message === 'string';

describe('route sweep', () => {
  it('every protected route: no token gives 401, a token with the wrong role gives 403', async () => {
    const doc = (await client({ port: docsPort }).get<{ paths: Record<string, Record<string, unknown>> }>('/docs-json')).body;
    const routes = Object.entries(doc.paths).flatMap(([path, ops]) => Object.keys(ops).map((method) => ({ path, method: method.toUpperCase() })));
    const protectedRoutes = routes.filter((r) => !PUBLIC.some((p) => p.test(r.path)));
    expect(protectedRoutes.length).toBeGreaterThan(25);
    const none = await makeStaff(app, []);
    const hotelId = randomUUID();
    const housekeeper = await makeStaff(app, [{ hotelId, role: 'housekeeper' }]);
    const ip = () => `127.${randomInt(1, 250)}.${randomInt(1, 250)}.${randomInt(1, 250)}`;
    const anon = client(app, { sourceIp: ip() });
    const withToken = (t: string) => client(app, { token: t, sourceIp: ip() });
    for (const r of protectedRoutes) {
      const url = r.path.replace(/\{[^}]+\}/g, () => randomUUID());
      const noToken = await anon.raw(r.method, url, r.method === 'GET' || r.method === 'DELETE' ? undefined : '{}');
      expect([r.method, r.path, noToken.status]).toEqual([r.method, r.path, 401]);
      expect(isErrorShape(noToken.body)).toBe(true);
      const empty = await withToken(none.token).raw(r.method, url, r.method === 'GET' || r.method === 'DELETE' ? undefined : '{}');
      if (r.path !== '/api/auth/me' && r.path !== '/api/auth/logout') expect([r.method, r.path, empty.status]).toEqual([r.method, r.path, 403]);
      if (/^\/api\/(admin|bookings)/.test(r.path)) {
        const hk = await withToken(housekeeper.token).raw(r.method, url, r.method === 'GET' ? undefined : '{}');
        expect([r.method, r.path, hk.status]).toEqual([r.method, r.path, 403]);
      }
    }
  });
});

describe('IDOR', () => {
  it('staff of hotel A cannot read or change anything of hotel B', async () => {
    const a = await createFixture(app.db, { rooms: 2 });
    const b = await createFixture(app.db, { rooms: 2 });
    const deskA = await makeStaff(app, [{ hotelId: a.hotelId, role: 'frontdesk' }, { hotelId: a.hotelId, role: 'head_housekeeper' }]);
    const booking = await confirmedBooking(app, b, TEST_TODAY, addDays(TEST_TODAY, 2));
    const room = b.roomIds[0];
    const calls = [
      deskA.api.get(`/api/bookings/${booking}`),
      deskA.api.get(`/api/bookings/${booking}/room-options`),
      deskA.api.get(`/api/bookings/${booking}/folio`),
      deskA.api.post(`/api/bookings/${booking}/folio`, { kind: 'charge', category: 'service', amount: 100 }),
      deskA.api.post(`/api/bookings/${booking}/assign-room`, { roomId: room }),
      deskA.api.post(`/api/bookings/${booking}/check-in`),
      deskA.api.post(`/api/bookings/${booking}/cancel`),
      deskA.api.post(`/api/rooms/${room}/status`, { status: 'dirty' }),
      deskA.api.post(`/api/rooms/${room}/out-of-order`, { from: TEST_TODAY, to: addDays(TEST_TODAY, 1), reason: 'Sneaky' }),
    ];
    for (const r of await Promise.all(calls)) {
      expect([403, 404]).toContain(r.status);
      expect(isErrorShape(r.body)).toBe(true);
    }
    for (const path of [`/api/hotels/${b.hotelId}/frontdesk?view=arrivals`, `/api/hotels/${b.hotelId}/housekeeping/rooms`, `/api/hotels/${b.hotelId}/bookings/search?q=test`]) {
      expect((await deskA.api.get(path)).status).toBe(403);
    }
    const [row] = await app.db.$queryRaw<{ status: string; n: bigint; r: string }[]>`
      SELECT b.status::text, (SELECT count(*) FROM folio_line WHERE booking_id = b.id) n, (SELECT status::text FROM room WHERE id = ${room}::uuid) r FROM booking b WHERE b.id = ${booking}::uuid`;
    expect([row.status, Number(row.n), row.r]).toEqual(['confirmed', 0, 'clean']);
    expect((await app.db.$queryRaw<{ n: bigint }[]>`SELECT count(*) n FROM room_out_of_order WHERE room_id = ${room}::uuid`)[0].n).toBe(0n);
  });

  it('a housekeeper cannot read or change another housekeeper\'s room', async () => {
    const f = await createFixture(app.db, { rooms: 2 });
    const hk1 = await makeStaff(app, [{ hotelId: f.hotelId, role: 'housekeeper' }]);
    const hk2 = await makeStaff(app, [{ hotelId: f.hotelId, role: 'housekeeper' }]);
    await app.db.$executeRaw`UPDATE room SET housekeeper_id = ${hk2.id}::uuid, status = 'dirty' WHERE id = ${f.roomIds[0]}::uuid`;
    const list = await hk1.api.get<{ rooms: unknown[] }>(`/api/hotels/${f.hotelId}/housekeeping/rooms`);
    expect(list.body.rooms).toEqual([]);
    const r = await hk1.api.post(`/api/rooms/${f.roomIds[0]}/status`, { status: 'clean' });
    expect(r.status).toBe(403);
    expect((await app.db.$queryRaw<{ s: string }[]>`SELECT status::text s FROM room WHERE id = ${f.roomIds[0]}::uuid`)[0].s).toBe('dirty');
  });

  it('a random guest token gives 404, and the guest-link limiter answers 429 after the allowed misses', async () => {
    const ip = `127.${randomInt(1, 250)}.${randomInt(1, 250)}.7`;
    const c = client(app, { sourceIp: ip });
    const first = await c.get<{ code: string }>(`/api/manage/${newToken()}`);
    expect([first.status, first.body.code]).toEqual([404, 'NOT_FOUND']);
    for (let i = 1; i < app.env.GUEST_LINK_LOOKUPS_PER_MIN; i += 1) expect((await c.get(`/api/manage/${newToken()}`)).status).toBe(404);
    const limited = await c.get<{ code: string }>(`/api/manage/${newToken()}`);
    expect([limited.status, limited.body.code]).toEqual([429, 'RATE_LIMITED']);
    expect(limited.headers['retry-after']).toBeDefined();
  });
});

describe('bad input', () => {
  it('gets the shared error format, never a bare 500', async () => {
    const f = await createFixture(app.db, { rooms: 1 });
    const admin = await makeStaff(app, [{ hotelId: null, role: 'admin' }]);
    const id = await confirmedBooking(app, f, TEST_TODAY, addDays(TEST_TODAY, 2));
    const guest = client(app, { sourceIp: freshIp() });
    const stay = { hotelId: f.hotelId, roomTypeId: f.roomTypeId, guests: 2 };
    const cases = [
      guest.post('/api/holds', { ...stay, checkIn: addDays(TEST_TODAY, 5), checkOut: addDays(TEST_TODAY, 3) }),
      guest.post('/api/holds', { ...stay, guests: -1, checkIn: addDays(TEST_TODAY, 5), checkOut: addDays(TEST_TODAY, 7) }),
      guest.raw('POST', '/api/holds', '{"hotelId": '),
      admin.api.raw('POST', `/api/bookings/${id}/extend`, '{nope'),
      admin.api.post(`/api/bookings/${id}/extend`, { checkOut: 'tomorrow' }),
      admin.api.post(`/api/bookings/${id}/folio`, { kind: 'gift', category: 'x', amount: 1.5 }),
      admin.api.get('/api/bookings/not-a-uuid'),
      admin.api.get(`/api/hotels/${f.hotelId}/frontdesk?view=everything`),
      admin.api.post(`/api/bookings/${id}/assign-room`, { roomId: randomUUID() }),
      admin.api.post(`/api/rooms/${f.roomIds[0]}/out-of-order`, { from: addDays(TEST_TODAY, 5), to: addDays(TEST_TODAY, 4), reason: 'x' }),
    ];
    for (const r of await Promise.all(cases)) {
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
      expect(isErrorShape(r.body)).toBe(true);
    }
    expect((await guest.raw('POST', '/api/holds', '{"hotelId": ')).body).toMatchObject({ code: 'MALFORMED_JSON' });
  });
});
