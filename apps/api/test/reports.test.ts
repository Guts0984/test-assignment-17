import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, type Report } from '@hotel/shared';
import { bookStay, client, createFixture, createStaff, loginAs, startApp, TEST_TODAY, uniqueEmail, type TestApp } from './helpers';

let app: TestApp;
beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => {
  await app.close();
});

describe('revenue report', () => {
  it('occupancy, ADR, RevPAR and cancellations by channel for a period and a room-type filter', async () => {
    const f = await createFixture(app.db, { rooms: 5 });
    const from = addDays(TEST_TODAY, 1);
    const to = addDays(from, 2);
    const a = await bookStay(app, f, from, to);
    const b = await bookStay(app, f, from, to);
    expect(a.confirmStatus).toBe(200);
    expect(b.confirmStatus).toBe(200);
    const email = uniqueEmail('rev');
    await createStaff(app.db, { email, password: 'pass-12345678', roles: [{ hotelId: f.hotelId, role: 'revenue' }] });
    const token = await loginAs(app, email, 'pass-12345678', '127.0.8.1');
    const c = client(app, { token });
    const url = `/api/hotels/${f.hotelId}/reports/revenue?from=${from}&to=${to}&roomTypeId=${f.roomTypeId}`;

    const r1 = (await c.get<Report>(url)).body;
    expect(r1.total).toMatchObject({ availableNights: 10, soldNights: 4, revenue: 40_000, occupancy: 0.4, adr: 10_000, revPar: 4_000 });

    const cancelled = await client(app).post(`/api/manage/${a.booked?.token}/cancel`);
    expect(cancelled.status).toBe(200);
    const r2 = (await c.get<Report>(url)).body;
    expect(r2.total).toMatchObject({ soldNights: 2, revenue: 20_000 });
    expect(r2.bySource).toEqual([{ source: 'web', bookings: 2, cancelled: 1, noShows: 0, soldNights: 2, revenue: 20_000 }]);

    const channelOnly = (await c.get<Report>(`${url}&source=channel`)).body;
    expect(channelOnly.total.soldNights).toBe(0);
  });

  it('rejects a period that ends before it starts and another hotel', async () => {
    const mine = await createFixture(app.db, { rooms: 1 });
    const other = await createFixture(app.db, { rooms: 1 });
    const email = uniqueEmail('rev2');
    await createStaff(app.db, { email, password: 'pass-12345678', roles: [{ hotelId: mine.hotelId, role: 'revenue' }] });
    const c = client(app, { token: await loginAs(app, email, 'pass-12345678', '127.0.8.2') });
    const bad = await c.get<{ code: string }>(`/api/hotels/${mine.hotelId}/reports/revenue?from=2030-06-10&to=2030-06-01`);
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('VALIDATION_ERROR');
    expect((await c.get(`/api/hotels/${other.hotelId}/reports/revenue?from=2030-06-01&to=2030-06-10`)).status).toBe(403);
  });
});
