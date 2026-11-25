import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays } from '@hotel/shared';
import { client, createFixture, startApp, TEST_TODAY, type TestApp } from './helpers';

let app: TestApp;
beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => {
  await app.close();
});

describe('public hotel list', () => {
  it('lists real hotels only: a test hotel stays out of the list but can still be searched by id', async () => {
    const f = await createFixture(app.db, { rooms: 2 });
    await app.db.$executeRaw`INSERT INTO hotel (code, name, timezone, currency, check_in_time, check_out_time, audit_time, last_closed_date) VALUES ('LISTED1', 'Listed Hotel', 'Europe/Lisbon', 'EUR', '14:00', '12:00', '03:00', '2030-04-30')`;
    try {
      const list = await client(app).get<{ id: string; code: string }[]>('/api/hotels');
      expect(list.status).toBe(200);
      expect(list.body.map((h) => h.id)).not.toContain(f.hotelId);
      expect(list.body.map((h) => h.code)).toContain('LISTED1');
      const search = await client(app).get(`/api/search?hotelId=${f.hotelId}&checkIn=${addDays(TEST_TODAY, 5)}&checkOut=${addDays(TEST_TODAY, 7)}&guests=2`);
      expect(search.status).toBe(200);
    } finally {
      await app.db.$executeRaw`DELETE FROM hotel WHERE code = 'LISTED1'`;
    }
  });
});
