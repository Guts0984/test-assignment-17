import { execFileSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createStaff, startApp, uniqueEmail, type TestApp } from './helpers';

let app: TestApp;
const PASSWORD = 'correct-horse-battery';

beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => {
  await app.close();
});

/** Fresh IPs per run: counters live in Redis and survive between runs. */
const ipPool = (): (() => string) => {
  const a = randomInt(1, 250);
  const b = randomInt(1, 250);
  let n = 1;
  return () => `127.${a}.${b}.${(n += 1)}`;
};

const login = (ip: string, email: string, password: string, headers?: Record<string, string>) =>
  client(app, { sourceIp: ip, headers }).post<{ code?: string; message?: string; accessToken?: string }>('/api/auth/login', { email, password });

describe('login brute force', () => {
  it('one IP, one email: blocked after the limit, even with the correct password; Retry-After is set', async () => {
    const ip = ipPool()();
    const email = uniqueEmail('one');
    await createStaff(app.db, { email, password: PASSWORD, roles: [{ hotelId: null, role: 'admin' }] });
    const statuses: number[] = [];
    for (let i = 0; i < app.env.LOGIN_MAX_FAILS_PER_IP_EMAIL; i += 1) statuses.push((await login(ip, email, 'wrong')).status);
    expect(statuses).toEqual(Array(app.env.LOGIN_MAX_FAILS_PER_IP_EMAIL).fill(401));
    const blocked = await login(ip, email, 'wrong');
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    const correct = await login(ip, email, PASSWORD);
    expect(correct.status).toBe(429);
    expect(correct.body.accessToken).toBeUndefined();
  });

  it('one IP, many emails (spraying): blocked by IP, other IPs unaffected', async () => {
    const next = ipPool();
    const x = next();
    const y = next();
    const email = uniqueEmail('victim');
    await createStaff(app.db, { email, password: PASSWORD, roles: [{ hotelId: null, role: 'admin' }] });
    const last: number[] = [];
    for (let i = 0; i < app.env.LOGIN_MAX_FAILS_PER_IP; i += 1) last.push((await login(x, uniqueEmail('spray'), 'wrong')).status);
    expect(new Set(last)).toEqual(new Set([401]));
    expect((await login(x, uniqueEmail('spray'), 'wrong')).status).toBe(429);
    expect((await login(x, email, PASSWORD)).status).toBe(429);
    // while X is blocked, Y logs in to the same account
    const other = await login(y, email, PASSWORD);
    expect(other.status).toBe(200);
    expect(other.body.accessToken).toBeTruthy();
  });

  it('a block on one account from IP X does not stop IP Y from logging in to it', async () => {
    const next = ipPool();
    const [x, y] = [next(), next()];
    const email = uniqueEmail('pair');
    await createStaff(app.db, { email, password: PASSWORD, roles: [{ hotelId: null, role: 'admin' }] });
    for (let i = 0; i < app.env.LOGIN_MAX_FAILS_PER_IP_EMAIL; i += 1) await login(x, email, 'wrong');
    expect((await login(x, email, PASSWORD)).status).toBe(429);
    expect((await login(y, email, PASSWORD)).status).toBe(200);
  });

  it('no enumeration: a wrong password and an unknown email give the same 401 body', async () => {
    const next = ipPool();
    const email = uniqueEmail('real');
    await createStaff(app.db, { email, password: PASSWORD, roles: [{ hotelId: null, role: 'admin' }] });
    const wrong = await login(next(), email, 'nope');
    const unknown = await login(next(), uniqueEmail('ghost'), 'nope');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('email is trimmed and lowercased before it is used as a key', async () => {
    const ip = ipPool()();
    const email = uniqueEmail('Case');
    await createStaff(app.db, { email: email.toLowerCase(), password: PASSWORD, roles: [{ hotelId: null, role: 'admin' }] });
    for (let i = 0; i < app.env.LOGIN_MAX_FAILS_PER_IP_EMAIL; i += 1) await login(ip, i % 2 === 0 ? email.toUpperCase() : `  ${email.toLowerCase()} `, 'wrong');
    expect((await login(ip, email.toLowerCase(), 'wrong')).status).toBe(429);
  });

  it('a successful login resets only the (ip, email) counter', async () => {
    const ip = ipPool()();
    const email = uniqueEmail('reset');
    await createStaff(app.db, { email, password: PASSWORD, roles: [{ hotelId: null, role: 'admin' }] });
    for (let i = 0; i < app.env.LOGIN_MAX_FAILS_PER_IP_EMAIL - 1; i += 1) await login(ip, email, 'wrong');
    expect((await login(ip, email, PASSWORD)).status).toBe(200);
    for (let i = 0; i < app.env.LOGIN_MAX_FAILS_PER_IP_EMAIL - 1; i += 1) expect((await login(ip, email, 'wrong')).status).toBe(401);
  });
});

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });

describe('real IP through nginx', () => {
  let proxied: TestApp;
  let nginxPort = 0;
  let containerId = '';

  beforeAll(async () => {
    proxied = await startApp({ TRUSTED_PROXY_CIDRS: '127.0.0.1/32' });
    nginxPort = await freePort();
    const dir = mkdtempSync(join(tmpdir(), 'nginx-'));
    const conf = join(dir, 'default.conf');
    writeFileSync(
      conf,
      `server {
  listen 127.0.0.1:${nginxPort};
  location / {
    proxy_pass http://127.0.0.1:${proxied.port};
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
`,
    );
    containerId = execFileSync('docker', ['run', '-d', '--rm', '--network', 'host', '-v', `${conf}:/etc/nginx/conf.d/default.conf:ro`, 'nginx:1.27']).toString().trim();
    for (let i = 0; i < 50; i += 1) {
      const ok = await client({ port: nginxPort }).get('/api/health').then((r) => r.status === 200).catch(() => false);
      if (ok) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('nginx did not start');
  });

  afterAll(async () => {
    if (containerId) execFileSync('docker', ['rm', '-f', containerId]);
    await proxied.close();
  });

  it('a spoofed X-Forwarded-For on every attempt does not avoid the block', async () => {
    const ip = ipPool()();
    const email = uniqueEmail('spoof');
    await createStaff(proxied.db, { email, password: PASSWORD, roles: [{ hotelId: null, role: 'admin' }] });
    const attempt = (password: string) =>
      client({ port: nginxPort }, { sourceIp: ip, headers: { 'x-forwarded-for': `10.${randomInt(250)}.${randomInt(250)}.${randomInt(250)}`, 'x-real-ip': `10.9.${randomInt(250)}.1` } }).post<{ code?: string }>(
        '/api/auth/login',
        { email, password },
      );
    const codes: number[] = [];
    for (let i = 0; i < proxied.env.LOGIN_MAX_FAILS_PER_IP_EMAIL; i += 1) codes.push((await attempt('wrong')).status);
    expect(codes).toEqual(Array(proxied.env.LOGIN_MAX_FAILS_PER_IP_EMAIL).fill(401));
    expect((await attempt('wrong')).status).toBe(429);
    expect((await attempt(PASSWORD)).status).toBe(429);
  });
});
