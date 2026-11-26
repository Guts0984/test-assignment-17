import { randomUUID } from 'node:crypto';
import { hash } from 'argon2';
import { PrismaClient, type Prisma } from '@prisma/client';
import { addDays, hotelDateAt, nightsOf, weekday } from '@hotel/shared';
import { env } from './env';
import { createRng, planHotel } from './plan';
import { buildBooking, buildFolio, priceOf, type BookingRow, type FolioRow, type RoomInfo, type TypeInfo } from './rows';

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

const ROOMS = 150;
const RATE_DAYS = 730;
const CHUNK = 4000;

const root = new PrismaClient({ datasources: { db: { url: env.databaseUrl } } });
/** The client every helper uses: the connection itself, and inside `main` the one transaction the whole seed runs in. */
let db: Prisma.TransactionClient = root;

const bulk = async (sql: string, rows: readonly unknown[]): Promise<void> => {
  for (let i = 0; i < rows.length; i += CHUNK) await db.$executeRawUnsafe(sql, JSON.stringify(rows.slice(i, i + CHUNK)));
};

const NOTIFY_TRIGGERS = [
  ['booking', 'booking_notify'],
  ['inventory', 'inventory_notify'],
  ['room', 'room_notify'],
  ['folio_line', 'folio_notify'],
] as const;

const toggleNotify = async (on: boolean): Promise<void> => {
  for (const [table, trigger] of NOTIFY_TRIGGERS) {
    await db.$executeRawUnsafe(`ALTER TABLE ${table} ${on ? 'ENABLE' : 'DISABLE'} TRIGGER ${trigger}`);
  }
};

interface Counts {
  bookings: number;
  folio: number;
}

const seedHotel = async (h: (typeof HOTELS)[number], passwordHash: string, counts: Counts): Promise<void> => {
  const today = hotelDateAt(new Date(), '03:00', h.timezone);
  const hotelId = randomUUID();
  await db.$executeRaw`
    INSERT INTO hotel (id, code, name, timezone, currency, check_in_time, check_out_time, audit_time, last_closed_date)
    VALUES (${hotelId}::uuid, ${h.code}, ${h.name}, ${h.timezone}, ${h.currency}, '14:00', '12:00', '03:00', ${addDays(today, -1)}::date)`;
  const types: TypeInfo[] = TYPES.map((t) => ({ id: randomUUID(), factor: t.factor, maxGuests: t.maxGuests }));
  await bulk(
    `INSERT INTO room_type (id, hotel_id, code, name, rank, max_guests)
     SELECT x.id::uuid, '${hotelId}'::uuid, x.code, x.name, x.rank, x."maxGuests" FROM jsonb_to_recordset($1::jsonb) AS x(id text, code text, name text, rank int, "maxGuests" int)`,
    TYPES.map((t, i) => ({ id: types[i].id, code: t.code, name: t.name, rank: t.rank, maxGuests: t.maxGuests })),
  );
  const perType = ROOMS / TYPES.length;
  const rooms: (RoomInfo & { number: string; status: string; hk: number })[] = Array.from({ length: ROOMS }, (_, i) => ({
    id: randomUUID(),
    number: String(100 + i + 1 + Math.floor(i / 30) * 70),
    type: types[Math.floor(i / perType)].id,
    status: i >= 146 ? 'out_of_order' : i >= 140 ? 'dirty' : i % 7 === 0 ? 'inspected' : 'clean',
    hk: i % 3,
  }));
  const staff = [
    ['admin', 'admin'],
    ['revenue', 'revenue'],
    ['frontdesk', 'frontdesk'],
    ['head', 'head_housekeeper'],
    ['maid1', 'housekeeper'],
    ['maid2', 'housekeeper'],
    ['maid3', 'housekeeper'],
  ].map(([local, role]) => ({ id: randomUUID(), email: `${local}@${h.code.toLowerCase()}.test`, name: `${h.name} ${local}`, role }));
  await bulk(`INSERT INTO staff (id, email, password_hash, name) SELECT x.id::uuid, x.email, '${passwordHash}', x.name FROM jsonb_to_recordset($1::jsonb) AS x(id text, email text, name text)`, staff);
  await bulk(`INSERT INTO staff_role (staff_id, hotel_id, role) SELECT x.id::uuid, '${hotelId}'::uuid, x.role::"Role" FROM jsonb_to_recordset($1::jsonb) AS x(id text, role text)`, staff);
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

  const days = nightsOf(today, addDays(today, RATE_DAYS));
  const rates = types.flatMap((t) => days.map((d) => ({ t: t.id, d, p: priceOf(h.base, t.factor, d) })));
  await bulk(`INSERT INTO rate (room_type_id, night, price) SELECT x.t::uuid, x.d::date, x.p FROM jsonb_to_recordset($1::jsonb) AS x(t text, d text, p int)`, rates);
  const fridays = types.flatMap((t, i) => days.filter((d) => weekday(d) === 5).map((d) => ({ t: t.id, d, m: i <= 1 ? 2 : 1 })));
  await bulk(`INSERT INTO restriction (room_type_id, night, min_stay) SELECT x.t::uuid, x.d::date, x.m FROM jsonb_to_recordset($1::jsonb) AS x(t text, d text, m int)`, fridays);

  const rng = createRng(h.code.charCodeAt(0) * 7919);
  const plan = planHotel(today, ROOMS, env.SEED_BOOKINGS_PER_HOTEL, rng, env.SEED_HISTORY_DAYS);
  const all = [...plan.active, ...plan.lost];
  const bookings: BookingRow[] = all.map((s, i) => buildBooking(s, i, h.code, h.base, types, rooms, rng));
  await insertBookings(hotelId, h.currency, bookings);
  const folio = bookings.flatMap((b) => buildFolio(b, today, rng));
  await insertFolio(folio);
  await insertInventory(types, bookings, today);
  await seedOverbooking(hotelId, h, types, bookings, today, counts, rng);
  counts.bookings += bookings.length;
  counts.folio += folio.length;
};

const insertBookings = async (hotelId: string, currency: string, rows: readonly BookingRow[]): Promise<void> => {
  await bulk(
    `INSERT INTO booking (id, code, hotel_id, room_type_id, check_in, check_out, guests, status, source, channel_ref, channel_version, guest_name, guest_email, guest_phone, total_price, currency, penalty, token_hash)
     SELECT x.id::uuid, x.code, '${hotelId}'::uuid, x.type::uuid, x."checkIn"::date, x."checkOut"::date, x.guests, x.status::"BookingStatus",
            (CASE WHEN x.channel THEN 'channel' ELSE 'web' END)::"BookingSource", CASE WHEN x.channel THEN 'OTA-' || x.code END, CASE WHEN x.channel THEN 1 END,
            x.name, x.email, '+380501234567', x.total, '${currency}', x.penalty, md5(x.id) || md5(x.code)
     FROM jsonb_to_recordset($1::jsonb) AS x(id text, code text, type text, "checkIn" text, "checkOut" text, guests int, status text, channel boolean, name text, email text, total int, penalty int)`,
    rows,
  );
  await bulk(`INSERT INTO booking_night (booking_id, night, price) SELECT x.b::uuid, x.d::date, x.p FROM jsonb_to_recordset($1::jsonb) AS x(b text, d text, p int)`, rows.flatMap((r) => r.nights.map((n) => ({ b: r.id, d: n.d, p: n.p }))));
  await bulk(
    `INSERT INTO room_assignment (booking_id, room_id, nights) SELECT x.b::uuid, x.r::uuid, daterange(x.i::date, x.o::date) FROM jsonb_to_recordset($1::jsonb) AS x(b text, r text, i text, o text)`,
    rows.filter((r) => r.room).map((r) => ({ b: r.id, r: r.room, i: r.checkIn, o: r.checkOut })),
  );
};

const insertFolio = (rows: readonly FolioRow[]): Promise<void> =>
  bulk(
    `INSERT INTO folio_line (booking_id, kind, category, amount, idem_key, hotel_date, created_by)
     SELECT x.b::uuid, x.k::"FolioKind", x.c, x.a, x.key, x.d::date, 'seed' FROM jsonb_to_recordset($1::jsonb) AS x(b text, k text, c text, a int, key text, d text)`,
    rows,
  );

const OCCUPYING = new Set(['confirmed', 'checked_in', 'checked_out']);

/** Counters equal the journal: one aggregated journal row per (room type, night). */
const insertInventory = async (types: readonly TypeInfo[], rows: readonly BookingRow[], today: string): Promise<void> => {
  const sold = new Map<string, number>();
  for (const r of rows) {
    if (!OCCUPYING.has(r.status)) continue;
    for (const n of r.nights) sold.set(`${r.type}|${n.d}`, (sold.get(`${r.type}|${n.d}`) ?? 0) + 1);
  }
  const keys = new Set<string>(sold.keys());
  for (const t of types) for (const d of nightsOf(today, addDays(today, RATE_DAYS))) keys.add(`${t.id}|${d}`);
  const inv = [...keys].map((k) => {
    const [t, d] = k.split('|');
    return { t, d, s: sold.get(k) ?? 0, o: 0 };
  });
  await writeInventory(inv);
};

const writeInventory = async (inv: readonly { t: string; d: string; s: number; o: number }[]): Promise<void> => {
  await bulk(
    `INSERT INTO inventory (room_type_id, night, total, ooo, sold, overbooked)
     SELECT x.t::uuid, x.d::date, (SELECT count(*) FROM room WHERE room_type_id = x.t::uuid)::int,
            (SELECT count(*) FROM room_out_of_order o JOIN room r ON r.id = o.room_id WHERE r.room_type_id = x.t::uuid AND x.d::date >= o.from_date AND x.d::date < o.to_date)::int, x.s, x.o
     FROM jsonb_to_recordset($1::jsonb) AS x(t text, d text, s int, o int)`,
    inv,
  );
  await bulk(
    `INSERT INTO inventory_journal (room_type_id, night, d_sold, d_overbooked, reason, actor) SELECT x.t::uuid, x.d::date, x.s, x.o, 'seed', 'seed' FROM jsonb_to_recordset($1::jsonb) AS x(t text, d text, s int, o int) WHERE x.s > 0`,
    inv,
  );
};

/**
 * A few channel bookings accepted over the limit: the room type is first filled on the night, then extra
 * channel bookings are accepted and flagged as overbooking, so the front desk has something to resolve.
 */
const seedOverbooking = async (hotelId: string, h: (typeof HOTELS)[number], types: readonly TypeInfo[], rows: readonly BookingRow[], today: string, counts: Counts, rng: ReturnType<typeof createRng>): Promise<void> => {
  const night = addDays(today, 6);
  const type = types[2];
  const soldNow = rows.filter((r) => r.type === type.id && OCCUPYING.has(r.status) && r.nights.some((n) => n.d === night)).length;
  const [{ rooms, ooo }] = await db.$queryRaw<{ rooms: number; ooo: number }[]>`
    SELECT (SELECT count(*) FROM room WHERE room_type_id = ${type.id}::uuid)::int AS rooms, ooo FROM inventory WHERE room_type_id = ${type.id}::uuid AND night = ${night}::date`;
  const fill = Math.max(0, rooms - ooo - soldNow);
  const extra = 3;
  const price = priceOf(h.base, type.factor, night);
  const made = Array.from({ length: fill + extra }, (_, i): BookingRow => ({
    id: randomUUID(), code: `SD-${h.code}-OV${String(i).padStart(3, '0')}`, type: type.id, room: null, checkIn: night, checkOut: addDays(night, 1), status: 'confirmed',
    channel: true, guests: 2, name: `Overbooked Guest ${i}`, email: `ov${i}.${h.code.toLowerCase()}@example.test`, total: price, penalty: null, nights: [{ d: night, p: price }], kind: 'future',
  }));
  void rng;
  await insertBookings(hotelId, h.currency, made);
  await db.$executeRaw`UPDATE booking SET overbooking = true WHERE hotel_id = ${hotelId}::uuid AND code LIKE ${`SD-${h.code}-OV%`} AND code >= ${`SD-${h.code}-OV${String(fill).padStart(3, '0')}`}`;
  await db.$executeRaw`UPDATE booking_night SET overbooked = true WHERE booking_id IN (SELECT id FROM booking WHERE hotel_id = ${hotelId}::uuid AND overbooking)`;
  await db.$executeRaw`UPDATE inventory SET sold = sold + ${fill + extra}, overbooked = ${extra} WHERE room_type_id = ${type.id}::uuid AND night = ${night}::date`;
  await db.$executeRaw`INSERT INTO inventory_journal (room_type_id, night, d_sold, d_overbooked, reason, actor) VALUES (${type.id}::uuid, ${night}::date, ${fill + extra}, ${extra}, 'seed', 'seed')`;
  counts.bookings += made.length;
};

/**
 * All or nothing: the whole seed is ONE transaction, so a crash or a restart in the middle leaves an empty database
 * (the next start seeds again) instead of one hotel without the chain administrator. A lock makes two starts wait for each other.
 */
const main = async (): Promise<void> => {
  await root.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(727001)`;
      const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) n FROM hotel`;
      if (Number(n) > 0) {
        console.error('seed: database already has data, skipping');
        return;
      }
      db = tx;
      const started = Date.now();
      const passwordHash = await hash(env.SEED_PASSWORD);
      const counts: Counts = { bookings: 0, folio: 0 };
      await toggleNotify(false);
      for (const h of HOTELS) {
        await seedHotel(h, passwordHash, counts);
        console.error(`seed: ${h.code} done (${Math.round((Date.now() - started) / 1000)}s)`);
      }
      await toggleNotify(true);
      const adminId = randomUUID();
      await db.$executeRaw`INSERT INTO staff (id, email, password_hash, name) VALUES (${adminId}::uuid, 'chain-admin@hotels.test', ${passwordHash}, 'Chain admin')`;
      await db.$executeRaw`INSERT INTO staff_role (staff_id, hotel_id, role) VALUES (${adminId}::uuid, NULL, 'admin')`;
      await db.$executeRawUnsafe('ANALYZE');
      console.error(`seed: done, ${counts.bookings} bookings, ${counts.folio} folio lines in ${Math.round((Date.now() - started) / 1000)}s`);
    },
    { timeout: 3_600_000, maxWait: 600_000 },
  );
};

main()
  .catch((e: unknown) => {
    console.error('seed failed', e);
    process.exitCode = 1;
  })
  .finally(() => root.$disconnect());
