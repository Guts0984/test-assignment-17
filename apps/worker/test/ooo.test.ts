import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeNextDate } from '@hotel/db';
import { addDays } from '@hotel/shared';
import { createFixture, openDb, PAST_TODAY, resetTestRedis, testEnv } from './helpers';

const db = openDb(testEnv());
beforeAll(resetTestRedis);
afterAll(async () => {
  await db.$disconnect();
});

describe('out-of-order periods follow the hotel date', () => {
  it('a room goes out of service when its period starts and comes back dirty when it ends, by the night audit', async () => {
    const f = await createFixture(db, { rooms: 2 });
    const rooms = await db.$queryRaw<{ id: string }[]>`SELECT id::text FROM room WHERE room_type_id = ${f.roomTypeId}::uuid ORDER BY number`;
    const [ending, starting] = rooms.map((r) => r.id);
    // room 1 is under repair for the hotel date and only that day; room 2 will be repaired on the 12th and 13th
    await db.$executeRaw`UPDATE room SET status = 'out_of_order' WHERE id = ${ending}::uuid`;
    await db.$executeRaw`INSERT INTO room_out_of_order (room_id, from_date, to_date, reason, created_by) VALUES (${ending}::uuid, ${PAST_TODAY}::date, ${addDays(PAST_TODAY, 1)}::date, 'repair', 'test')`;
    await db.$executeRaw`INSERT INTO room_out_of_order (room_id, from_date, to_date, reason, created_by) VALUES (${starting}::uuid, ${addDays(PAST_TODAY, 2)}::date, ${addDays(PAST_TODAY, 4)}::date, 'repair', 'test')`;
    const status = async (id: string | undefined): Promise<string> => (await db.$queryRaw<{ s: string }[]>`SELECT status::text s FROM room WHERE id = ${id}::uuid`)[0]?.s ?? '';
    const deps = { db, now: () => new Date() };

    expect(await closeNextDate(deps, f.hotelId)).toBe('closed'); // closes the 10th, the hotel date is now the 11th
    expect([await status(ending), await status(starting)]).toEqual(['dirty', 'clean']);
    expect(await closeNextDate(deps, f.hotelId)).toBe('closed'); // the hotel date is the 12th
    expect([await status(ending), await status(starting)]).toEqual(['dirty', 'out_of_order']);
    expect(await closeNextDate(deps, f.hotelId)).toBe('closed'); // the 13th: still under repair
    expect(await status(starting)).toBe('out_of_order');
    expect(await closeNextDate(deps, f.hotelId)).toBe('closed'); // the 14th: back, dirty and waiting for housekeeping
    expect(await status(starting)).toBe('dirty');
  });
});
