import { randomUUID } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EMAIL_QUEUE } from '@hotel/shared';
import { createFixture, startApp, uniqueEmail, type TestApp } from './helpers';
import { makeStaff } from './staff-helpers';

let app: TestApp;
beforeAll(async () => {
  app = await startApp({ RATE_LIMIT_GLOBAL_PER_MIN: '100000' });
});
afterAll(async () => {
  await app.close();
});

const hotelBody = (code: string) => ({
  code, name: 'New Hotel', timezone: 'Europe/Kyiv', currency: 'UAH', checkInTime: '14:00', checkOutTime: '12:00', auditTime: '03:00', cancelFreeDays: 2, cancelFreeUntil: '14:00',
});

interface Failed { jobs: { queue: string; id: string; failedReason: string }[] }

describe('admin', () => {
  it('a failed job is listed for the admin and can be retried', async () => {
    const admin = await makeStaff(app, [{ hotelId: null, role: 'admin' }]);
    const connection = new Redis(app.env.REDIS_URL, { maxRetriesPerRequest: null });
    const queue = new Queue(EMAIL_QUEUE, { connection });
    let attempts = 0;
    const worker = new Worker(
      EMAIL_QUEUE,
      async (job) => {
        if (job.data.marker !== marker) return;
        attempts += 1;
        if (attempts === 1) throw new Error('smtp down');
      },
      { connection },
    );
    const marker = randomUUID();
    try {
      const job = await queue.add('send', { marker }, { attempts: 1, removeOnFail: false });
      const ours = () => admin.api.get<Failed>('/api/admin/jobs/failed').then((r) => r.body.jobs.find((j) => j.id === job.id && j.queue === EMAIL_QUEUE));
      await vi.waitFor(async () => expect(await ours()).toMatchObject({ failedReason: 'smtp down' }), { timeout: 15_000, interval: 100 });
      const retry = await admin.api.post(`/api/admin/jobs/${EMAIL_QUEUE}/${job.id}/retry`);
      expect(retry.status).toBe(200);
      await vi.waitFor(async () => expect(await ours()).toBeUndefined(), { timeout: 15_000, interval: 100 });
      expect(attempts).toBe(2);
      const again = await admin.api.post<{ code: string }>(`/api/admin/jobs/${EMAIL_QUEUE}/${job.id}/retry`);
      expect(again.status).toBeGreaterThanOrEqual(404);
      expect((await admin.api.post(`/api/admin/jobs/nope/1/retry`)).status).toBe(404);
      const hotelAdmin = await makeStaff(app, [{ hotelId: randomUUID(), role: 'admin' }]);
      expect((await hotelAdmin.api.get('/api/admin/jobs/failed')).status).toBe(403);
    } finally {
      await worker.close();
      await queue.obliterate({ force: true }).catch(() => undefined);
      await queue.close();
      connection.disconnect();
    }
  });

  it('creates a hotel with yesterday as the last closed date and rejects bad input with field errors', async () => {
    const admin = await makeStaff(app, [{ hotelId: null, role: 'admin' }]);
    const code = `N${randomUUID().slice(0, 8)}`;
    const ok = await admin.api.post<{ id: string; lastClosedDate: string }>('/api/admin/hotels', hotelBody(code));
    expect(ok.status).toBe(201);
    expect(ok.body.lastClosedDate).toBe('2030-04-30');
    const dup = await admin.api.post<{ code: string }>('/api/admin/hotels', hotelBody(code));
    expect([dup.status, dup.body.code]).toEqual([409, 'CONFLICT']);
    const bad = await admin.api.post<{ code: string; details: { issues: { path: string }[] } }>('/api/admin/hotels', { ...hotelBody('X'), timezone: 'Mars/Base', currency: 'USD', auditTime: '25:00' });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('VALIDATION_ERROR');
    expect(bad.body.details.issues.map((i) => i.path).sort()).toEqual(['auditTime', 'code', 'currency', 'timezone']);
    const upd = await admin.api.put<{ checkInTime: string }>(`/api/admin/hotels/${ok.body.id}`, { checkInTime: '15:00' });
    expect(upd.body.checkInTime).toBe('15:00');
    const type = await admin.api.post<{ id: string }>(`/api/admin/hotels/${ok.body.id}/room-types`, { code: 'STD', name: 'Standard', rank: 1, maxGuests: 2 });
    expect(type.status).toBe(201);
    const room = await admin.api.post(`/api/admin/hotels/${ok.body.id}/rooms`, { roomTypeId: type.body.id, number: '101' });
    expect(room.status).toBe(201);
    expect((await admin.api.post(`/api/admin/hotels/${ok.body.id}/rooms`, { roomTypeId: type.body.id, number: '101' })).status).toBe(409);
  });

  it('manages staff with per-hotel roles and replaces the channel room types', async () => {
    const admin = await makeStaff(app, [{ hotelId: null, role: 'admin' }]);
    const f = await createFixture(app.db, { rooms: 1 });
    const email = uniqueEmail('Mixed.Case').toUpperCase();
    const created = await admin.api.post<{ id: string; email: string }>('/api/admin/staff', { email, name: 'Front Desk', password: 'a-long-password', roles: [{ hotelId: f.hotelId, role: 'frontdesk' }] });
    expect([created.status, created.body.email]).toEqual([201, email.toLowerCase()]);
    const [row] = await app.db.$queryRaw<{ password_hash: string }[]>`SELECT password_hash FROM staff WHERE id = ${created.body.id}::uuid`;
    expect(row.password_hash.startsWith('$argon2id$')).toBe(true);
    expect((await admin.api.post('/api/admin/staff', { email: email.toLowerCase(), name: 'Dup', password: 'a-long-password', roles: [] })).status).toBe(409);
    expect((await admin.api.post('/api/admin/staff', { email: 'x@y.zz', name: 'Bad', password: 'a-long-password', roles: [{ hotelId: null, role: 'frontdesk' }] })).status).toBe(400);
    const upd = await admin.api.put<{ roles: { role: string }[] }>(`/api/admin/staff/${created.body.id}`, { roles: [{ hotelId: f.hotelId, role: 'housekeeper' }] });
    expect(upd.body.roles).toEqual([{ hotelId: f.hotelId, role: 'housekeeper' }]);
    expect((await admin.api.get<{ staff: { id: string }[] }>('/api/admin/staff')).body.staff.map((s) => s.id)).toContain(created.body.id);
    const ch = await admin.api.put<{ roomTypeIds: string[] }>('/api/admin/channel', { roomTypeIds: [f.roomTypeId, f.upperRoomTypeId] });
    expect(ch.body.roomTypeIds).toHaveLength(2);
    const stored = await app.db.$queryRaw<{ room_type_id: string }[]>`SELECT room_type_id::text FROM channel_room_type`;
    expect(stored.map((s) => s.room_type_id).sort()).toEqual([f.roomTypeId, f.upperRoomTypeId].sort());
    expect((await admin.api.put('/api/admin/channel', { roomTypeIds: [randomUUID()] })).status).toBe(400);
  });
});
