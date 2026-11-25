import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { hash } from 'argon2';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { checkConsistency, createDb, type Db } from '@hotel/db';
import { addDays, nightsOf } from '@hotel/shared';
import { createApp } from '../src/app';
import { parseEnv, type Env } from '../src/config/env';
import { createManualClock } from '../src/infra/clock';

export const TEST_NOW = '2030-05-01T09:00:00Z';
export const TEST_TODAY = '2030-05-01';

export interface TestApp {
  readonly url: string;
  readonly port: number;
  readonly db: Db;
  readonly env: Env;
  readonly clock: ReturnType<typeof createManualClock>;
  readonly close: () => Promise<void>;
}

export const startApp = async (overrides: Record<string, string> = {}): Promise<TestApp> => {
  const env = parseEnv({ ...process.env, ...overrides, TRUSTED_PROXY_CIDRS: overrides.TRUSTED_PROXY_CIDRS ?? '' });
  const clock = createManualClock(new Date(TEST_NOW));
  const app: NestExpressApplication = await createApp({ env, clock, docs: false });
  await app.listen(0, '0.0.0.0');
  const port = (app.getHttpServer().address() as AddressInfo).port;
  const db = createDb(env.databaseUrl);
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    db,
    env,
    clock,
    close: async () => {
      await app.close();
      await db.$disconnect();
    },
  };
};

export interface Reply<T = unknown> {
  readonly status: number;
  readonly body: T;
  readonly headers: http.IncomingHttpHeaders;
}

export interface ClientOptions {
  readonly sourceIp?: string;
  readonly token?: string;
  readonly headers?: Record<string, string>;
}

/** Real HTTP. A different source IP comes from `localAddress: 127.0.0.N`. */
export const client = (app: Pick<TestApp, 'port'>, opts: ClientOptions = {}) => {
  const call = <T = unknown>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<Reply<T>> =>
    new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
      const req = http.request(
        {
          host: '127.0.0.1',
          port: app.port,
          path,
          method,
          localAddress: opts.sourceIp,
          agent: false,
          headers: {
            ...(payload === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }),
            ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
            ...opts.headers,
            ...extra,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let parsed: unknown = text;
            try {
              parsed = text ? JSON.parse(text) : null;
            } catch {
              parsed = text;
            }
            resolve({ status: res.statusCode ?? 0, body: parsed as T, headers: res.headers });
          });
        },
      );
      req.on('error', reject);
      if (payload !== undefined) req.write(payload);
      req.end();
    });
  return {
    get: <T = unknown>(path: string, h?: Record<string, string>) => call<T>('GET', path, undefined, h),
    post: <T = unknown>(path: string, body?: unknown, h?: Record<string, string>) => call<T>('POST', path, body ?? {}, h),
    put: <T = unknown>(path: string, body?: unknown) => call<T>('PUT', path, body ?? {}),
    patch: <T = unknown>(path: string, body?: unknown) => call<T>('PATCH', path, body ?? {}),
    raw: <T = unknown>(method: string, path: string, body?: string, h?: Record<string, string>) => call<T>(method, path, body, h),
  };
};

/** Fires `n` calls at the same moment. */
export const parallel = <T>(n: number, fn: (i: number) => Promise<T>): Promise<T[]> => Promise.all(Array.from({ length: n }, (_, i) => fn(i)));

export interface Fixture {
  readonly hotelId: string;
  readonly roomTypeId: string;
  readonly upperRoomTypeId: string;
  readonly roomIds: readonly string[];
  readonly upperRoomIds: readonly string[];
  readonly nights: readonly string[];
}

/** A fresh hotel per test: Lisbon, `rooms` rooms of one type plus one higher-class room, rates for 60 days. */
export const createFixture = async (db: Db, opts: { rooms: number; timezone?: string; auditTime?: string; today?: string } = { rooms: 5 }): Promise<Fixture> => {
  const today = opts.today ?? TEST_TODAY;
  const hotelId = randomUUID();
  const roomTypeId = randomUUID();
  const upperRoomTypeId = randomUUID();
  const code = `T${hotelId.slice(0, 8)}`;
  await db.$executeRaw`
    INSERT INTO hotel (id, code, name, timezone, currency, check_in_time, check_out_time, audit_time, last_closed_date)
    VALUES (${hotelId}::uuid, ${code}, ${`Test ${code}`}, ${opts.timezone ?? 'Europe/Lisbon'}, 'EUR', '14:00', '12:00', ${opts.auditTime ?? '03:00'}, ${addDays(today, -1)}::date)`;
  await db.$executeRaw`INSERT INTO room_type (id, hotel_id, code, name, rank, max_guests) VALUES (${roomTypeId}::uuid, ${hotelId}::uuid, 'STD', 'Standard', 1, 3)`;
  await db.$executeRaw`INSERT INTO room_type (id, hotel_id, code, name, rank, max_guests) VALUES (${upperRoomTypeId}::uuid, ${hotelId}::uuid, 'SUP', 'Superior', 2, 3)`;
  const roomIds = Array.from({ length: opts.rooms }, () => randomUUID());
  const upperRoomIds = [randomUUID(), randomUUID()];
  for (const [i, id] of roomIds.entries()) {
    await db.$executeRaw`INSERT INTO room (id, hotel_id, room_type_id, number, status) VALUES (${id}::uuid, ${hotelId}::uuid, ${roomTypeId}::uuid, ${`1${String(i).padStart(2, '0')}`}, 'clean')`;
  }
  for (const [i, id] of upperRoomIds.entries()) {
    await db.$executeRaw`INSERT INTO room (id, hotel_id, room_type_id, number, status) VALUES (${id}::uuid, ${hotelId}::uuid, ${upperRoomTypeId}::uuid, ${`2${String(i).padStart(2, '0')}`}, 'clean')`;
  }
  const nights = nightsOf(today, addDays(today, 60));
  for (const t of [roomTypeId, upperRoomTypeId]) {
    await db.$executeRaw`INSERT INTO rate (room_type_id, night, price) SELECT ${t}::uuid, n, ${t === roomTypeId ? 10_000 : 15_000} FROM unnest(${nights as string[]}::date[]) AS n`;
  }
  await db.$executeRaw`INSERT INTO channel_room_type (room_type_id) VALUES (${roomTypeId}::uuid)`;
  return { hotelId, roomTypeId, upperRoomTypeId, roomIds, upperRoomIds, nights };
};

export const createStaff = async (db: Db, input: { email: string; password: string; roles: { hotelId: string | null; role: string }[] }): Promise<string> => {
  const id = randomUUID();
  await db.$executeRaw`INSERT INTO staff (id, email, password_hash, name) VALUES (${id}::uuid, ${input.email}, ${await hash(input.password)}, ${input.email})`;
  for (const r of input.roles) {
    await db.$executeRaw`INSERT INTO staff_role (staff_id, hotel_id, role) VALUES (${id}::uuid, ${r.hotelId}::uuid, ${r.role}::"Role")`;
  }
  return id;
};

export const loginAs = async (app: TestApp, email: string, password: string, sourceIp = '127.0.0.9'): Promise<string> => {
  const r = await client(app, { sourceIp }).post<{ accessToken: string }>('/api/auth/login', { email, password });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status}`);
  return r.body.accessToken;
};

/** Inventory counters equal the journal sums and are never negative; every storno reverses its line. */
export const assertConsistent = async (db: Db): Promise<void> => {
  const report = await db.$transaction((tx) => checkConsistency(tx));
  if (report.counterMismatches.length > 0 || report.negatives > 0 || report.folioMismatches.length > 0) {
    throw new Error(`Inconsistent: ${JSON.stringify(report)}`);
  }
};

export const uniqueEmail = (prefix: string): string => `${prefix}-${randomUUID().slice(0, 8)}@test.local`;

export interface Booked {
  readonly token: string;
  readonly code: string;
  readonly id: string;
}

export interface BookResult {
  readonly holdStatus: number;
  readonly confirmStatus: number | null;
  readonly booked: Booked | null;
  readonly errorCode: string | null;
}

/** Guest flow over real HTTP: hold, then confirm. */
export const bookStay = async (
  app: TestApp,
  f: Pick<Fixture, 'hotelId' | 'roomTypeId'>,
  checkIn: string,
  checkOut: string,
  opts: { confirm?: boolean; sourceIp?: string } = {},
): Promise<BookResult> => {
  const c = client(app, { sourceIp: opts.sourceIp });
  const hold = await c.post<{ token: string; bookingCode: string; code?: string }>('/api/holds', { hotelId: f.hotelId, roomTypeId: f.roomTypeId, checkIn, checkOut, guests: 2 });
  if (hold.status !== 200 && hold.status !== 201) {
    return { holdStatus: hold.status, confirmStatus: null, booked: null, errorCode: (hold.body as { code?: string }).code ?? null };
  }
  const [row] = await app.db.$queryRaw<{ id: string }[]>`SELECT id::text FROM booking WHERE code = ${hold.body.bookingCode}`;
  const booked = { token: hold.body.token, code: hold.body.bookingCode, id: row.id };
  if (opts.confirm === false) return { holdStatus: hold.status, confirmStatus: null, booked, errorCode: null };
  const conf = await c.post<{ code?: string }>(`/api/holds/${hold.body.token}/confirm`, { guestName: 'Test Guest', guestEmail: 'guest@test.local', guestPhone: '+351 912 345 678' });
  return { holdStatus: hold.status, confirmStatus: conf.status, booked, errorCode: conf.status === 200 ? null : (conf.body as { code?: string }).code ?? null };
};
