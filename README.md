# Hotel chain booking

Guests book rooms on the site, a sales channel (OTA) sends bookings too, revenue managers set prices, the front desk checks guests in and out, housekeepers clean, and every night each hotel runs a night audit. PostgreSQL is the source of truth; losing Redis loses nothing.

Spec: [ASSIGNMENT.md](ASSIGNMENT.md). Engineering rules: [CLAUDE.md](CLAUDE.md). Plan and assumptions: [plan.md](plan.md).

## Run

```bash
cp .env.example .env && docker compose up --build
```

No other manual step. The first start applies the migrations and loads the seed (about 80 seconds: 300,022 bookings, 1,020,124 folio lines).

| What | Where |
| --- | --- |
| Site and staff screens | http://localhost:8088 (nginx → web) |
| Swagger | http://localhost:8088/docs |
| Channel stub (page with live availability, send buttons) | http://localhost:54000 |
| Mailpit (inbox of every email the system sends) | http://localhost:58025 |
| Postgres / Redis (local tests only) | 127.0.0.1:55432 / 127.0.0.1:56379 |

The two api copies expose no host ports; every request reaches them through nginx.

### Logins (password `demo-pass-123` for all)

| Role | Email (per hotel: `kyiv`, `waw`, `lis`) |
| --- | --- |
| Chain administrator (all hotels) | `chain-admin@hotels.test` |
| Hotel administrator | `admin@<hotel>.test` (cannot use `/api/admin/*`, which is chain-wide) |
| Revenue manager | `revenue@<hotel>.test` |
| Front desk | `frontdesk@<hotel>.test` |
| Head housekeeper | `head@<hotel>.test` |
| Housekeepers | `maid1@<hotel>.test`, `maid2@…`, `maid3@…` (each sees only the rooms given to them) |

Guests need no account: the confirmation email carries the manage link. The worker sends it over SMTP to Mailpit; open http://localhost:58025 to read it.

### Tests

```bash
pnpm install
docker compose up -d postgres redis         # real Postgres and Redis, no mocks
pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm gen:api                                # regenerates the OpenAPI client; CI fails on a diff
pnpm e2e                                    # Playwright against the running compose stack
```

`pnpm test` creates and migrates its own database (`hotel_test`) and uses its own Redis database numbers, so it never touches the data of a running compose stack and can run next to it (including its worker). Tests create their own small data (a fresh hotel with a few rooms), so they stay fast and do not depend on the big seed. The full seed is only for compose and the performance check. CI loads a small seed (`SEED_BOOKINGS_PER_HOTEL=2000`, `SEED_HISTORY_DAYS=30`) and runs four jobs side by side: typecheck and lint; build; tests plus the generated-client check; and the Playwright e2e on the real compose stack. The e2e specs also run in parallel with each other, each on its own freshly created hotel.

| Suite | What it proves |
| --- | --- |
| `packages/shared` (unit) | cancellation in Lisbon (13:59 free, 14:01 first night), min stay (Fri–Sun rejected, Thu–Sun passes), Kyiv DST spring and fall, price with weekend +15 % |
| `apps/api/test/races` | 50 parallel bookings on 5 rooms → exactly 5; "1–5" vs "4–8" on the last room; confirm racing the expiry (looped); room assignment race; night audit twice in parallel |
| `apps/api/test/channel` | events are stored and applied by a real BullMQ worker: one booking sent 10× in parallel through both api copies; cancel before booking; stale versions; 200 parallel (web + channel) on the last 5 rooms; a lost Redis job rebuilt from the inbox; key and scope checks |
| `apps/api/test/hold-job` | a new hold queues its own expiry job, due exactly when the hold ends |
| `apps/api/test/login` | the five brute-force cases, including a real nginx container for the spoofed `X-Forwarded-For` |
| `apps/api/test/permissions` | route sweep (401 without a token, 403 with the wrong role on every protected route), IDOR, guest-link limiter, bad input |
| `apps/api/test/{frontdesk,housekeeping,admin,reports,realtime}` | check-in rules, folio and storno, early check-out, move/extend rollback, own-rooms-only, failed job retry, report numbers, a booking on api copy B reaching a manager socket on copy A in under a second |
| `apps/worker/test` | hold expiry once with two workers, 3-day catch-up in order, Kyiv DST nights, `FLUSHALL`, push retries with valid signatures and growing versions, stub chaos mode, `kill -9` of a worker in the middle of the audit, out-of-order periods starting and ending with the hotel date |
| `apps/worker/test/email` | the mail reaches a real SMTP server once with the booking number and manage link; a refused mail stays unsent and is retried |
| `apps/channel-stub/test` | bad signature 401, older versions ignored, the live event stream fires when a push is accepted |
| `apps/web/e2e` | the four flows of the assignment (see below) and the phone layout |

The four e2e flows run against the real stack: guest search → hold → confirm → the email in Mailpit → the channel stub shows one room less; front desk assign → check-in → real night audit → payment → check-out → room dirty → housekeeper cleans (375 px phone) → head inspects → room available again, plus the no-show with its penalty; channel booking on a sold night → overbooking at the front desk → free upgrade at check-in; cancel after the deadline → penalty shown first, one penalty line on the account.

## Architecture

```
nginx ── api ×2 (NestJS, REST + Socket.IO) ── PostgreSQL 16
  │            └── Redis 7: BullMQ queues, Socket.IO adapter, limiter counters
  └── web (Next.js 15)          worker (NestJS, BullMQ processors + reconciler)
                                channel-stub (sales channel simulator)
```

`packages/shared` holds the rules every part uses (zod schemas, error format, hotel date and DST, nights, cancellation, restrictions, price, status transitions). `packages/db` holds the transactional operations both api and worker run (inventory, holds, cancel, change, night audit, rooms, folio), so each rule exists once. The Prisma schema, migrations and seed are in `infra/db`.

Code style: Nest classes only wire things (modules, controllers, services, guards, filters); the rules are plain functions; expected failures are `Result` values turned into HTTP errors at the edge. The web app follows Feature-Sliced Design with a lint rule that fails on layer violations.

## Inventory by night and why nothing can be oversold

`inventory` has one row per (room type, night): `total` (rooms + allowed overbooking), `ooo` (out of order), `sold`, `held`, `overbooked`. Every change goes through one function that, in one transaction:

1. locks the nights `SELECT … FOR UPDATE ORDER BY night` (always ascending, so two stays can never deadlock);
2. checks that every night has a free room (`total − ooo − (sold − overbooked + held) ≥ 1`);
3. updates the counters **and** appends rows to the append-only `inventory_journal` (type, night, delta, document, actor, time).

A booking over several nights takes all nights or none: the transaction either commits with every night or rolls back. The counters always equal the journal sums (`checkConsistency`, asserted at the end of every race test), and the database enforces the limit itself:

```sql
CHECK (sold - overbooked + held <= total - ooo)   -- accepted channel overbooking is the only exception
```

### Protection against concurrent actions

| Action | How |
| --- | --- |
| Hold, confirm | `UPDATE booking SET status='confirmed' WHERE status='held' AND hold_expires_at > now` and the expiry's `UPDATE … SET status='expired' WHERE status='held' AND hold_expires_at <= now` take the same row lock: exactly one wins. The loser sees 0 rows. Inventory moves only for the winner. |
| Assign a room | `room_assignment` has `EXCLUDE USING gist (room_id WITH =, nights WITH &&)`: a room cannot have two stays on one night. The room row is locked first, so the loser gets a clean `ROOM_TAKEN` and not a deadlock. |
| Change dates | one transaction: release removed nights, occupy added nights, rewrite night prices. If anything fails it rolls back and the old booking and counters are untouched. |
| Cancel vs no-show | both are `UPDATE … WHERE status='confirmed'`: exactly one changes the status. The penalty line has a unique key (`penalty:<booking>`), so it is charged once. |
| Night audit | the hotel row is locked, `night_audit (hotel, date)` is unique, and room-night lines have unique keys: a date closes once, in order, from any number of workers. |
| Channel import | `pg_advisory_xact_lock(hash(channel_ref))` plus a unique `channel_ref`. |

## Hotel date, deadline and night audit, with DST

The hotel date is the local calendar date, except before the audit time, when it is still the previous day. The audit for date D runs at the audit time on D+1 (03:00 local in the seed). "Today" on the front desk and in housekeeping is computed by the server (`last_closed_date + 1`), never by the browser. The hold countdown uses the server's `serverNow` as well.

A local wall time that does not exist (spring forward) is moved forward by the gap; one that happens twice (fall back) uses its first occurrence. Example, Kyiv (`Europe/Kyiv`):

| Date closed | Audit instant | Why |
| --- | --- | --- |
| 2026-03-28 | 2026-03-29 **04:00** EEST = 01:00Z | 03:00 does not exist on 29 March (clocks go 03:00 → 04:00) |
| 2026-03-29 | 2026-03-30 03:00 EEST = 00:00Z | a normal day |
| 2026-10-24 | 2026-10-25 03:00 EEST = 00:00Z | 03:00 happens twice on 25 October; the first is used |
| 2026-10-25 | 2026-10-26 03:00 EET = 01:00Z | the second 03:00 does not reopen the date |

Each date closes once. Catch-up after downtime closes missed dates one by one, in order. Cancellation deadline: free strictly before 14:00 hotel time two calendar days before arrival (`cancelFreeDays` and `cancelFreeUntil` per hotel). In Lisbon in summer that is 13:00Z, so 13:59 local is free and 14:01 charges the first night's locked price.

## Background jobs (BullMQ, worker)

| Job | When it is queued | Repeats and duplicate protection |
| --- | --- | --- |
| `hold-expiry` | by the api when the hold is created (delayed to the moment the hold ends); the reconciler re-creates it for every due hold if Redis lost it | `expireHold` is a conditional update, so a repeated or parallel run does nothing; jobId `expire-<booking>` |
| `channel-inbound` | by the api for every new channel event, after the event is stored in `channel_inbox`; the reconciler re-creates it for unprocessed rows | `processed_at` on the row; the import itself is idempotent per (reference, version) |
| `night-audit` | by the reconciler for every hotel whose next audit instant has passed | `closeNextDate` locks the hotel row and `night_audit` is unique; catches up date by date |
| `channel-push` | by the api after any availability, rate or restriction change (3 s delay, jobId `push-<roomType>` = debounce) and by the reconciler for `channel_dirty` rows | every attempt reads the **current** state and takes a new `channel_push_version`; exponential backoff, `JOB_ATTEMPTS` attempts |
| `email` | by the reconciler for unsent `email_outbox` rows | the row is locked (`SKIP LOCKED`), sent over SMTP, and marked sent in the same transaction; a refused mail is retried |

The reconciler is a plain `setInterval` in the worker (not a BullMQ repeatable job), so a Redis wipe cannot remove it. Every `RECONCILE_INTERVAL_MS` (5 s) it rebuilds pending jobs from Postgres. After `FLUSHALL` holds still expire, audits still close, pushes still go out, and nothing runs twice (tested). If a worker is killed (`kill -9`), the job it was running is taken over by another worker about 15 seconds later (`WORKER_LOCK_MS`, the job lock, is 10 s); the work itself is idempotent, so nothing is done twice. Failed jobs stay in BullMQ; the chain administrator sees them in the admin screen and can run them again (`/api/admin/jobs`).

A hold is released by its own delayed job at the moment it ends. If that job was lost with Redis, the reconciler releases it within one tick (5 s). Either way, confirming an expired hold is refused immediately by the database condition, so the guest never gets a booking that has already expired.

## Sales channel

Inbound: `POST /api/channel/events` with `X-Channel-Key`, scoped to the connected hotels and room types (`channel_room_type`), limited per key. The api checks the scope, **stores the event in `channel_inbox`** (unique per channel booking number, version and type, so a repeat is the same row) and queues a BullMQ job, then answers `202`. The worker applies the event and writes its result on the row. If Redis loses the job, the reconciler queues every unprocessed row again; Postgres keeps the event either way. Bookings are idempotent by `channelRef`; modify and cancel carry a version and a stale one is dropped. A modify or cancel that arrives before its booking is stored in `channel_pending_event` (highest version wins) and applied right after the booking is created. A channel booking on a sold night is **accepted**, marked `overbooking` on the nights that did not fit, and shown to the front desk, which can give a free upgrade to a higher-class room.

Outbound: after a change the api marks the room type dirty and queues one push 3 s later; the worker sends the current availability, price and stop-sell for the next 60 nights, signed with HMAC-SHA256 (`X-Signature`) and a growing version. If the channel answers 500 or times out, the job retries with backoff, re-reading the current state each time, so versions never go backwards and the channel never receives older numbers than it already has. The stub ignores versions that are not newer. With `CHANNEL_STUB_CHAOS=true` the stub sends bookings twice at once to both api copies, sometimes sends the cancel before the booking, and fails or hangs every 5th push.

## Statuses

Booking (a transition happens only through a conditional update from the listed status):

| From | To | Who |
| --- | --- | --- |
| `held` | `confirmed` | guest (within 10 minutes) |
| `held` | `expired` | system (worker) |
| `confirmed` | `cancelled` | guest, front desk, channel (penalty by the hotel's rule) |
| `confirmed` | `checked_in` | front desk (needs an assigned clean or inspected room) |
| `confirmed` | `no_show` | system, at the night audit after the arrival date (first-night penalty, other nights released) |
| `checked_in` | `checked_out` | front desk (balance must be zero) |

Room: `clean`, `dirty`, `inspected`, `out_of_order`; "occupied" is derived from a checked-in booking.

| From | To | Who |
| --- | --- | --- |
| `dirty` | `clean` | housekeeper (own rooms), head |
| `clean` | `inspected` | head housekeeper |
| `clean`, `inspected` | `dirty` | head housekeeper, front desk |
| any usable status | `out_of_order` | head housekeeper (with dates and a reason) |
| `out_of_order` | `dirty` | head housekeeper (when the period is removed) |
| (check-out) | `dirty` | system |

## Database: constraints and indexes

Constraints: `inventory` CHECK for the capacity and non-negative counters; `EXCLUDE USING gist` on `room_assignment` (room, nights); unique `booking.code`, `booking.channel_ref`, `booking.token_hash`; unique `night_audit (hotel_id, hotel_date)`; unique `folio_line.idem_key` and `folio_line.storno_of_id`; `booking.check_out > check_in`; triggers that forbid UPDATE and DELETE on `folio_line` and `inventory_journal`; a sequence for push versions.

Indexes: `booking (hotel_id, check_in)`, `(hotel_id, check_out)`, `(hotel_id, status)`, `(hotel_id, status, check_in)`, `(guest_email)`, lower-cased guest name, surname and e-mail prefixes (`text_pattern_ops`), partial `(hold_expires_at) WHERE status='held'`, `booking_night (night)`, `inventory_journal (room_type_id, night)` and `(doc_id)`, `room (hotel_id, housekeeper_id)`. Measured on the full seed (300,022 bookings, 1,020,124 folio lines), calling an api copy directly: search for 7 nights 8–20 ms (limit 200), 60-day grid 9–14 ms (300), booking search 3–27 ms (300), 90-day report 68–120 ms (1 s).

Money is an integer in the minor unit of the hotel currency. Folio lines are append-only; a mistake is a storno line; the balance is always the sum of the lines.

## Rate limiting

The real client IP comes from nginx only: it sets `X-Forwarded-For` and `X-Real-IP` to `$remote_addr`, replacing anything the client sent, and Nest trusts proxy headers only from `TRUSTED_PROXY_CIDRS` (nginx's fixed address). Counters live in Redis (Lua `INCR` + `EXPIRE`) and are shared by both api copies. If Redis is down, the login and guest-link limiters switch to an in-memory store per process and keep blocking; the general limiter fails open.

| Limiter | Key | Default (env) |
| --- | --- | --- |
| General | IP | `RATE_LIMIT_GLOBAL_PER_MIN=600` |
| Login | IP + email | 5 failures per `LOGIN_FAIL_WINDOW_SEC=900` (`LOGIN_MAX_FAILS_PER_IP_EMAIL`) |
| Login (spraying) | IP | `LOGIN_MAX_FAILS_PER_IP=20` |
| Login (distributed) | email | `LOGIN_MAX_FAILS_PER_EMAIL=50` |
| Block length | — | `LOGIN_BLOCK_SEC=900` |
| Guest link, failed lookups | IP | `GUEST_LINK_LOOKUPS_PER_MIN=30` |
| Channel endpoints | channel key | `CHANNEL_RATE_PER_MIN=6000` |

The block is checked before the password, so a blocked client gets `429 RATE_LIMITED` with `Retry-After` even with the correct password. A wrong password and an unknown email give the same `401 INVALID_CREDENTIALS` (unknown emails are checked against a dummy hash). The email is trimmed and lower-cased before it is a key. A successful login resets only the IP+email counter. Passwords are never logged.

## Security

Staff passwords: argon2id. Staff get a JWT access token carrying their roles per hotel; every endpoint checks the role and the hotel of the resource, and a housekeeper sees only her own rooms. Sockets check the token on connect and the role in that hotel on `join`, with separate rooms for the grid, the front desk and housekeeping feeds. The guest link is a 128-bit random token, stored only as a SHA-256 hash; unknown tokens count against the caller's IP. The channel key is scoped to the connected hotels and room types, outbound pushes are HMAC-signed. One error format `{ code, message, details? }` is used everywhere and declared in OpenAPI; a bad body is `400`, malformed JSON `400 MALFORMED_JSON`, and unexpected failures are `500 INTERNAL` without internals. Body size limit, helmet and CORS come from the environment.

## Decisions

- Hotel date, DST, cancellation, price lock, lock order, channel debounce and reconciler: see [plan.md](plan.md) "Assumptions" (all implemented as written there).
- The channel import is a BullMQ job, as the assignment says; the api answers `202` after the event is safely stored. The worker's import takes an advisory lock and opens other transactions from `packages/db`; a semaphore of 8 per worker process keeps the connection pool from running dry.
- Live updates: Postgres triggers `NOTIFY` on commit; each api copy `LISTEN`s and emits to its sockets (throttled to 100 ms). This also covers changes made by the worker. The Socket.IO Redis adapter is installed for room operations across the copies.
- Move-room is limited to the same room type. Extending a stay checks stop-sell on the new nights and closed-to-departure on the new check-out date. Resolving an overbooking needs the same currency and a higher class.
- Out-of-order periods are `[from, to)`. The night audit puts a room out of service when its period starts and returns it as `dirty` when the period ends; removing a period by hand does the same.
- Channel changes skip min stay and stop-sell, like channel bookings: the channel already sold the stay. Dates without a rate are still refused (and the reason is kept on the inbox row).
- A free upgrade moves the sale to the higher room type; the guest keeps the locked nightly prices.
- Seed: 150 rooms per hotel cannot hold 250 in-house bookings, so "about 250 in-house" is read as guests: each hotel has 140 checked-in bookings with about 250 guests, about 60 arrivals and about 60 departures today, 3 overbooked channel bookings and 4 rooms out of order.
- The JWT carries the roles, so a role change takes effect when the token expires (`JWT_TTL_SEC`, 8 h).

### Bugs found by the tests and the build (kept as tests)

- Two parallel room assignments could deadlock inside the exclusion constraint; the room row is now locked first, the loser gets `ROOM_TAKEN`.
- A hold that failed after its first inserts would have committed a `held` booking without inventory; every operation now runs through a helper that rolls back on any error value.
- The seed placed guests in rooms that were out of order; the capacity CHECK rejected it (planner fixed).
- `room_assignment` had `booking_id` as primary key, so a moved guest could not hold two rooms (key is now `(booking_id, room_id)`); `checkOut` assumed one assignment row.
- The HMAC helper pulled `node:crypto` into the browser bundle through the shared index; it is imported from `@hotel/shared/dist/hmac` by server code only.
- The channel admin screen would have silently disconnected other hotels when saving; there is now a `GET /api/admin/channel` and the screen preloads the current selection.

## Not done

Everything in the assignment is built, with these gaps:

- **No refresh-token rotation**: one access token per login, roles inside it (see decisions).
