import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:8088';
const STUB = process.env.E2E_STUB_URL ?? 'http://localhost:54000';
export const PASSWORD = 'demo-pass-123';

export interface Reply<T> {
  readonly status: number;
  readonly body: T;
}

export const http = async <T = unknown>(method: string, url: string, opts: { token?: string; body?: unknown } = {}): Promise<Reply<T>> => {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
};

export const api = <T = unknown>(method: string, path: string, token: string, body?: unknown): Promise<Reply<T>> => http<T>(method, `${BASE}${path}`, { token, body });

export const login = async (email: string, password = PASSWORD): Promise<string> => {
  const r = await http<{ accessToken: string }>('POST', `${BASE}/api/auth/login`, { body: { email, password } });
  if (r.status !== 200) throw new Error(`login ${email}: ${r.status}`);
  return r.body.accessToken;
};

export const addDays = (iso: string, n: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export interface World {
  readonly adminToken: string;
  readonly hotelId: string;
  readonly hotelName: string;
  readonly today: string;
  readonly standard: { id: string; rooms: { id: string; number: string }[] };
  readonly upper: { id: string; rooms: { id: string; number: string }[] };
}

/** A fresh Lisbon hotel for one test: one standard type, one higher type, rates for 40 days, connected to the channel. */
export const createWorld = async (opts: { auditTime: string; standardRooms: number; upperRooms?: number; label: string }): Promise<World> => {
  const adminToken = await login('chain-admin@hotels.test');
  const code = `E${randomUUID().slice(0, 7).toUpperCase()}`;
  const hotel = await api<{ id: string; name: string }>('POST', '/api/admin/hotels', adminToken, {
    code, name: `E2E ${opts.label} ${code}`, timezone: 'Europe/Lisbon', currency: 'EUR', checkInTime: '14:00', checkOutTime: '12:00', auditTime: opts.auditTime, cancelFreeDays: 2, cancelFreeUntil: '14:00',
  });
  if (hotel.status >= 300) throw new Error(`hotel: ${JSON.stringify(hotel.body)}`);
  const hotelId = hotel.body.id;
  const type = async (typeCode: string, rank: number, rooms: number, prefix: string) => {
    const t = await api<{ id: string }>('POST', `/api/admin/hotels/${hotelId}/room-types`, adminToken, { code: typeCode, name: typeCode === 'STD' ? 'Standard' : 'Superior', rank, maxGuests: 3 });
    const made: { id: string; number: string }[] = [];
    for (let i = 0; i < rooms; i += 1) {
      const number = `${prefix}${i + 1}`;
      const r = await api<{ id: string }>('POST', `/api/admin/hotels/${hotelId}/rooms`, adminToken, { roomTypeId: t.body.id, number });
      made.push({ id: r.body.id, number });
    }
    return { id: t.body.id, rooms: made };
  };
  const standard = await type('STD', 1, opts.standardRooms, '1');
  const upper = await type('SUP', 2, opts.upperRooms ?? 0, '2');
  const grid = await api<{ from: string }>('GET', `/api/hotels/${hotelId}/grid?days=1`, adminToken);
  const today = grid.body.from;
  for (const [t, price] of [[standard.id, 10_000], [upper.id, 15_000]] as const) {
    await api('PUT', `/api/hotels/${hotelId}/rates`, adminToken, { roomTypeId: t, from: today, to: addDays(today, 40), price });
  }
  const current = await api<{ roomTypeIds: string[] }>('GET', '/api/admin/channel', adminToken);
  await api('PUT', '/api/admin/channel', adminToken, { roomTypeIds: [...new Set([...current.body.roomTypeIds, standard.id])] });
  return { adminToken, hotelId, hotelName: hotel.body.name, today, standard, upper };
};

/** Book through the public API: hold, then confirm. Returns the manage token and the booking id. */
export const bookViaApi = async (w: World, roomTypeId: string, checkIn: string, checkOut: string, email = 'e2e@example.test'): Promise<{ token: string; code: string }> => {
  const hold = await http<{ token: string; bookingCode: string }>('POST', `${BASE}/api/holds`, { body: { hotelId: w.hotelId, roomTypeId, checkIn, checkOut, guests: 2 } });
  if (hold.status >= 300) throw new Error(`hold: ${JSON.stringify(hold.body)}`);
  const conf = await http('POST', `${BASE}/api/holds/${hold.body.token}/confirm`, { body: { guestName: 'E2E Guest', guestEmail: email, guestPhone: '+351 912 345 678' } });
  if (conf.status !== 200) throw new Error(`confirm: ${JSON.stringify(conf.body)}`);
  return { token: hold.body.token, code: hold.body.bookingCode };
};

export const bookingIdByCode = async (w: World, code: string): Promise<string> => {
  const r = await api<{ bookings: { bookingId: string }[] }>('GET', `/api/hotels/${w.hotelId}/bookings/search?q=${code}`, w.adminToken);
  return r.body.bookings[0].bookingId;
};

export const uiLogin = async (page: Page, email: string): Promise<void> => {
  await page.goto('/staff/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/staff\/(revenue|frontdesk|housekeeping|admin)/);
};

export const stubState = async (): Promise<{ roomTypes: { roomTypeId: string; version: number; nights: { night: string; available: number }[] }[] }> =>
  (await http<{ roomTypes: { roomTypeId: string; version: number; nights: { night: string; available: number }[] }[] }>('GET', `${STUB}/state`)).body;

export const stubSend = (body: unknown): Promise<Reply<unknown>> => http('POST', `${STUB}/send`, { body });

export const workerLog = (sinceMinutes: number): string => execSync(`docker compose logs worker --since ${sinceMinutes}m 2>&1`, { cwd: resolve(process.cwd(), '../..'), encoding: 'utf8' });

/** HH:MM in the e2e hotels' time zone (Europe/Lisbon) about `minutes` from now, for a hotel whose audit should run soon. */
export const auditSoon = (minutes: number): string =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Lisbon', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(Date.now() + minutes * 60_000));
