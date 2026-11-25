import { randomUUID } from 'node:crypto';
import { hash } from 'argon2';
import { PrismaClient } from '@prisma/client';
import { WEEKEND_NIGHTS, addDays, applyRateChange, hotelDateAt, nightsOf, weekday } from '@hotel/shared';
import { env } from './env';
import { createRng, planStays, type Stay } from './plan';

const HOTELS = [
  { code: 'KYIV', name: 'Hotel Kyiv', timezone: 'Europe/Kyiv', currency: 'UAH', base: 280_000 },
  { code: 'WAW', name: 'Hotel Warsaw', timezone: 'Europe/Warsaw', currency: 'PLN', base: 45_000 },
  { code: 'LIS', name: 'Hotel Lisbon', timezone: 'Europe/Lisbon', currency: 'EUR', base: 11_000 },
] as const;

const TYPES = [
  { code: 'STD', name: 'Standard', rank: 1, maxGuests: 2, factor: 1.0 },
  { code: 'CMF', name: 'Comfort', rank: 2, maxGuests: 3, factor: 1.25 },
  { code: 'SUP', name: 'Superior', rank: 3, maxGuests: 3, factor: 1.5 },
  { code: 'FAM', name: 'Family', rank: 4, maxGuests: 5, factor: 1.8 },
  { code: 'STE', name: 'Suite', rank: 5, maxGuests: 4, factor: 2.6 },
] as const;

const ROOMS_PER_HOTEL = 150;
const CHUNK = 1500;

const db = new PrismaClient({ datasources: { db: { url: env.databaseUrl } } });

const bulk = async (sql: string, rows: readonly unknown[]): Promise<void> => {
  for (let i = 0; i < rows.length; i += CHUNK) await db.$executeRawUnsafe(sql, JSON.stringify(rows.slice(i, i + CHUNK)));
};

const seedHotel = async (h: (typeof HOTELS)[number], passwordHash: string): Promise<void> => {
  const now = new Date();
  const today = hotelDateAt(now, '03:00', h.timezone);
  const hotelId = randomUUID();
  await db.$executeRaw`
    INSERT INTO hotel (id, code, name, timezone, currency, check_in_time, check_out_time, audit_time, last_closed_date)
    VALUES (${hotelId}::uuid, ${h.code}, ${h.name}, ${h.timezone}, ${h.currency}, '14:00', '12:00', '03:00', ${addDays(today, -1)}::date)`;

  const types = TYPES.map((t) => ({ ...t, id: randomUUID() }));
  await bulk(
    `INSERT INTO room_type (id, hotel_id, code, name, rank, max_guests)
     SELECT x.id::uuid, '${hotelId}'::uuid, x.code, x.name, x.rank, x."maxGuests" FROM jsonb_to_recordset($1::jsonb) AS x(id text, code text, name text, rank int, "maxGuests" int)`,
    types,
  );
  const perType = ROOMS_PER_HOTEL / TYPES.length;
  const rooms = Array.from({ length: ROOMS_PER_HOTEL }, (_, i) => ({
    id: randomUUID(),
    number: String(100 + i + 1 + Math.floor(i / 30) * 70),
    type: types[Math.floor(i / perType)].id,
    status: i >= 146 ? 'out_of_order' : i >= 140 ? 'dirty' : i % 7 === 0 ? 'inspected' : 'clean',
    hk: i % 3,
  }));

  const staff = [
    { email: `admin@${h.code.toLowerCase()}.test`, name: `${h.name} admin`, role: 'admin' },
    { email: `revenue@${h.code.toLowerCase()}.test`, name: `${h.name} revenue`, role: 'revenue' },
    { email: `frontdesk@${h.code.toLowerCase()}.test`, name: `${h.name} front desk`, role: 'frontdesk' },
    { email: `head@${h.code.toLowerCase()}.test`, name: `${h.name} head housekeeper`, role: 'head_housekeeper' },
    ...[0, 1, 2].map((n) => ({ email: `maid${n + 1}@${h.code.toLowerCase()}.test`, name: `${h.name} housekeeper ${n + 1}`, role: 'housekeeper' })),
  ].map((s) => ({ ...s, id: randomUUID() }));
  await bulk(
    `INSERT INTO staff (id, email, password_hash, name) SELECT x.id::uuid, x.email, '${passwordHash}', x.name FROM jsonb_to_recordset($1::jsonb) AS x(id text, email text, name text)`,
    staff,
  );
  await bulk(
    `INSERT INTO staff_role (staff_id, hotel_id, role) SELECT x.id::uuid, '${hotelId}'::uuid, x.role::"Role" FROM jsonb_to_recordset($1::jsonb) AS x(id text, role text)`,
    staff,
  );
  const maids = staff.filter((s) => s.role === 'housekeeper');
  await bulk(
    `INSERT INTO room (id, hotel_id, room_type_id, number, status, housekeeper_id)
     SELECT x.id::uuid, '${hotelId}'::uuid, x.type::uuid, x.number, x.status::"RoomStatus", (ARRAY[${maids.map((m) => `'${m.id}'`).join(',')}]::uuid[])[x.hk + 1]
     FROM jsonb_to_recordset($1::jsonb) AS x(id text, number text, type text, status text, hk int)`,
    rooms,
  );
  await db.$executeRaw`INSERT INTO channel_room_type (room_type_id) SELECT id FROM room_type WHERE hotel_id = ${hotelId}::uuid AND code <> 'STE'`;
  await db.$executeRaw`
    INSERT INTO room_out_of_order (room_id, from_date, to_date, reason, created_by)
    SELECT id, ${today}::date, ${addDays(today, 4)}::date, 'Repair', 'seed' FROM room WHERE hotel_id = ${hotelId}::uuid AND status = 'out_of_order'`;

  // rates and restrictions: 90 days ahead, +15 % on Friday and Saturday nights
  const days = nightsOf(today, addDays(today, 90));
  const rates = types.flatMap((t) =>
    days.map((d) => ({ t: t.id, d, p: applyRateChange(d, Math.round(h.base * t.factor), { adjustPercent: 15, weekdays: WEEKEND_NIGHTS }) ?? 0 })),
  );
  await bulk(`INSERT INTO rate (room_type_id, night, price) SELECT x.t::uuid, x.d::date, x.p FROM jsonb_to_recordset($1::jsonb) AS x(t text, d text, p int)`, rates);
  const restrictions = types.flatMap((t) => days.filter((d) => weekday(d) === 5).map((d) => ({ t: t.id, d, m: t.rank <= 2 ? 2 : 1 })));
  await bulk(`INSERT INTO restriction (room_type_id, night, min_stay) SELECT x.t::uuid, x.d::date, x.m FROM jsonb_to_recordset($1::jsonb) AS x(t text, d text, m int)`, restrictions);

  const rng = createRng(h.code.charCodeAt(0) * 7919);
  const stays = planStays(today, ROOMS_PER_HOTEL, rng);
  await seedBookings(hotelId, h, types, rooms, stays, today, rates);
};

const seedBookings = async (
  hotelId: string,
  h: (typeof HOTELS)[number],
  types: readonly { id: string }[],
  rooms: readonly { id: string; type: string }[],
  stays: readonly Stay[],
  today: string,
  rates: readonly { t: string; d: string; p: number }[],
): Promise<void> => {
  const price = new Map(rates.map((r) => [`${r.t}|${r.d}`, r.p]));
  const priceOf = (type: string, d: string, i: number): number => price.get(`${type}|${d}`) ?? Math.round(h.base * (1 + (i % 5) / 5));
  const rows = stays.map((s, i) => {
    const room = rooms[s.roomIndex];
    const nights = nightsOf(s.checkIn, s.checkOut).map((d) => ({ d, p: priceOf(room.type, d, i) }));
    const status = s.kind === 'past' ? 'checked_out' : s.kind === 'departing' || s.kind === 'inhouse' ? 'checked_in' : 'confirmed';
    const channel = i % 4 === 0;
    return {
      id: randomUUID(), code: `SD-${h.code}-${String(i).padStart(5, '0')}`, type: room.type, room: room.id, s, nights, status, channel,
      total: nights.reduce((a, n) => a + n.p, 0), name: `Guest ${i}`, email: `guest${i}@example.test`,
      assigned: s.kind !== 'arrival' && s.kind !== 'future',
    };
  });
  await bulk(
    `INSERT INTO booking (id, code, hotel_id, room_type_id, check_in, check_out, guests, status, source, channel_ref, channel_version, guest_name, guest_email, guest_phone, total_price, currency, token_hash)
     SELECT x.id::uuid, x.code, '${hotelId}'::uuid, x.type::uuid, x."checkIn"::date, x."checkOut"::date, 2, x.status::"BookingStatus", (CASE WHEN x.channel THEN 'channel' ELSE 'web' END)::"BookingSource",
            CASE WHEN x.channel THEN 'OTA-' || x.code END, CASE WHEN x.channel THEN 1 END, x.name, x.email, '+380501234567', x.total, '${h.currency}', md5(x.id) || md5(x.code)
     FROM jsonb_to_recordset($1::jsonb) AS x(id text, code text, type text, "checkIn" text, "checkOut" text, status text, channel boolean, name text, email text, total int)`,
    rows.map((r) => ({ id: r.id, code: r.code, type: r.type, checkIn: r.s.checkIn, checkOut: r.s.checkOut, status: r.status, channel: r.channel, name: r.name, email: r.email, total: r.total })),
  );
  await bulk(
    `INSERT INTO booking_night (booking_id, night, price) SELECT x.b::uuid, x.d::date, x.p FROM jsonb_to_recordset($1::jsonb) AS x(b text, d text, p int)`,
    rows.flatMap((r) => r.nights.map((n) => ({ b: r.id, d: n.d, p: n.p }))),
  );
  await bulk(
    `INSERT INTO room_assignment (booking_id, room_id, nights) SELECT x.b::uuid, x.r::uuid, daterange(x.i::date, x.o::date) FROM jsonb_to_recordset($1::jsonb) AS x(b text, r text, i text, o text)`,
    rows.filter((r) => r.assigned).map((r) => ({ b: r.id, r: r.room, i: r.s.checkIn, o: r.s.checkOut })),
  );

  // folio: room nights already closed by the audit, plus payments for finished stays
  const lines = rows.flatMap((r) =>
    r.status === 'confirmed' ? [] : r.nights.filter((n) => n.d < today).map((n) => ({ b: r.id, k: 'charge', a: n.p, key: `night:${r.id}:${n.d}`, d: n.d })),
  );
  const pays = rows.filter((r) => r.status === 'checked_out' || r.s.kind === 'departing').map((r) => ({ b: r.id, k: 'payment', a: -r.total, key: `pay:${r.id}`, d: addDays(today, -1) }));
  await bulk(
    `INSERT INTO folio_line (booking_id, kind, category, amount, idem_key, hotel_date, created_by)
     SELECT x.b::uuid, x.k::"FolioKind", CASE WHEN x.k = 'charge' THEN 'room' ELSE 'card' END, x.a, x.key, x.d::date, 'seed' FROM jsonb_to_recordset($1::jsonb) AS x(b text, k text, a int, key text, d text)`,
    [...lines, ...pays],
  );

  // inventory counters and one aggregated journal row per (type, night)
  const sold = new Map<string, number>();
  for (const r of rows) for (const n of r.nights) sold.set(`${r.type}|${n.d}`, (sold.get(`${r.type}|${n.d}`) ?? 0) + 1);
  const keys = new Set<string>([...sold.keys(), ...types.flatMap((t) => nightsOf(today, addDays(today, 90)).map((d) => `${t.id}|${d}`))]);
  const inv = [...keys].map((k) => {
    const [t, d] = k.split('|');
    return { t, d, s: sold.get(k) ?? 0 };
  });
  await bulk(
    `INSERT INTO inventory (room_type_id, night, total, ooo, sold)
     SELECT x.t::uuid, x.d::date, (SELECT count(*) FROM room WHERE room_type_id = x.t::uuid)::int,
            (SELECT count(*) FROM room_out_of_order o JOIN room r ON r.id = o.room_id WHERE r.room_type_id = x.t::uuid AND x.d::date >= o.from_date AND x.d::date < o.to_date)::int, x.s
     FROM jsonb_to_recordset($1::jsonb) AS x(t text, d text, s int)`,
    inv,
  );
  await bulk(
    `INSERT INTO inventory_journal (room_type_id, night, d_sold, reason, actor) SELECT x.t::uuid, x.d::date, x.s, 'seed', 'seed' FROM jsonb_to_recordset($1::jsonb) AS x(t text, d text, s int) WHERE x.s > 0`,
    inv,
  );
};

const main = async (): Promise<void> => {
  const [{ n }] = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) n FROM hotel`;
  if (Number(n) > 0) {
    console.error('seed: database already has data, skipping');
    return;
  }
  const passwordHash = await hash(env.SEED_PASSWORD);
  for (const h of HOTELS) await seedHotel(h, passwordHash);
  const adminId = randomUUID();
  await db.$executeRaw`INSERT INTO staff (id, email, password_hash, name) VALUES (${adminId}::uuid, 'chain-admin@hotels.test', ${passwordHash}, 'Chain admin')`;
  await db.$executeRaw`INSERT INTO staff_role (staff_id, hotel_id, role) VALUES (${adminId}::uuid, NULL, 'admin')`;
  console.error('seed: done');
};

main()
  .catch((e: unknown) => {
    console.error('seed failed', e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
