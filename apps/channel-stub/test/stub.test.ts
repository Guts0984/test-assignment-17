import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signBody } from '@hotel/shared/dist/hmac';
import { createStub } from '../src/server';

const SECRET = 'test-hmac-secret';
let server: ReturnType<typeof createStub>;
let base = '';

beforeAll(async () => {
  server = createStub({ port: 0, targets: [], apiKey: 'k', hmacSecret: SECRET, chaos: false, hangMs: 100 });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

const push = (version: number, available: number, signature?: string): Promise<{ status: number; body: unknown }> => {
  const body = JSON.stringify({
    version,
    roomTypeId: '11111111-1111-4111-8111-111111111111',
    hotelId: '22222222-2222-4222-8222-222222222222',
    sentAt: '2030-05-01T09:00:00.000Z',
    nights: [{ night: '2030-05-02', available, price: 10000, stopSell: false }],
  });
  return fetch(`${base}/push`, { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-signature': signature ?? signBody(SECRET, body) } }).then(async (r) => ({ status: r.status, body: await r.json() }));
};

describe('channel stub', () => {
  it('rejects a bad signature, ignores a version that is not newer, shows the current availability', async () => {
    expect((await push(1, 5, 'bad')).status).toBe(401);
    expect((await push(2, 5)).body).toEqual({ ok: true });
    expect((await push(2, 1)).body).toEqual({ ignored: true });
    expect((await push(1, 1)).body).toEqual({ ignored: true });
    const state = (await (await fetch(`${base}/state`)).json()) as { roomTypes: { version: number; nights: { available: number }[] }[] };
    expect(state.roomTypes[0]).toMatchObject({ version: 2, nights: [{ available: 5 }] });
  });

  it('the event stream tells the page the moment a push is accepted', async () => {
    const got = new Promise<number>((resolve, reject) => {
      const started = Date.now();
      const req = http.get(`${base}/events`, (res) => {
        res.on('data', (chunk: Buffer) => {
          if (chunk.toString().includes('changed')) {
            req.destroy();
            resolve(Date.now() - started);
          }
        });
      });
      req.on('error', (e) => (e.message.includes('aborted') || e.message.includes('socket hang up') ? undefined : reject(e)));
      setTimeout(() => void push(3, 4), 200).unref();
    });
    expect(await got).toBeLessThan(2000);
  });
});
