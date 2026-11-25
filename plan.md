# Plan (3-hour mode)

## Assumptions / decisions

- **Hotel date**: the local date, except before the audit time it is still the previous day. The audit for date D runs at `audit_time` on D+1 local. Front desk "today" = `last_closed_date + 1`.
- **DST**: a local time that does not exist (Kyiv spring-forward 03:00) is pushed forward by the gap (04:00 EEST = 01:00Z). A time that happens twice (fall-back) uses the first occurrence.
- **Cancellation**: free strictly before `(check-in - 2 days) 14:00` local; at or after, the penalty is the first night's locked price. Per hotel: `cancel_free_days`, `cancel_free_until`.
- **Weekend** = Friday and Saturday nights. Rates are stored per (room type, night); "+15 %" is applied once at write time, rounded to minor units.
- **Price lock**: nightly prices are copied to `booking_night` at hold time. On a date change, kept nights keep their price, new nights use the current rate.
- **Inventory row**: `total` (rooms + allowance), `ooo`, `sold`, `held`, `overbooked`. `CHECK (sold - overbooked + held <= total - ooo)`. A channel booking that does not fit is accepted with `overbooking = true` and counted in `overbooked` on each night.
- **Lock order**: booking row first, then inventory rows `ORDER BY night`.
- **Hold token = manage token**: 128-bit random, sha256 stored. The email (log + `email_outbox`) carries the manage link.
- **Channel import is synchronous in the api** (advisory lock on `channel_ref` + unique constraint), not BullMQ, so the 10x duplicate is atomic and the channel gets an answer. A modify/cancel before its booking goes to `channel_pending_event` and is applied when the booking arrives.
- **Channel push**: changes upsert `channel_dirty` and enqueue a BullMQ job `push-<roomType>` delayed 3 s (jobId dedupes = debounce). Each attempt re-reads current state and takes a new `nextval` version.
- **Reconciler**: a plain `setInterval` in the worker (survives FLUSHALL). From Postgres it re-enqueues due hold expiries, due audits, dirty room types, unsent emails.
- **One channel** configured from env; its scope is the `channel_room_type` table.
- **Real IP**: `trust proxy` = `TRUSTED_PROXY_CIDRS`; nginx has a fixed IP in compose.
- **Layout**: Prisma schema, migrations and seed in `infra/db`. `packages/db` holds the IO helpers both api and worker need (inventory + journal writes, hold expiry, cancel, night audit), because `packages/shared` may not do IO and duplicating them would split one rule in two places.
- **Housekeeper vs head**: head housekeeper sees all rooms of her hotel, housekeeper only her own. Socket rooms: one per hotel, join checks the same role as REST.
- **Seed** is small (3 hotels, 5 types, 150 rooms, 90 days, ~2k bookings): a time cut, logged in README.

## Checklist

**P0**
- [ ] Monorepo, env.ts per app, compose, CI
- [ ] shared rules + tests
- [ ] DB schema, constraints, seed
- [ ] Auth, roles, rate limiters, one error format, Swagger
- [ ] Guest flow, revenue manager
- [ ] Tests from the skill, README

**P1**
- [ ] Worker: hold expiry, night audit, reconciler, failed jobs + retry
- [ ] Front desk, folio, housekeeping
- [ ] Channel import + push + stub
- [ ] Web screens, 375 px housekeeping, Playwright guest flow

**P2**: live grid via sockets, revenue report, chaos mode, moves/extend, overbooking UI, big seed.

## Commits
1. chore: monorepo, env, compose, CI
2. feat(shared): rules
3. feat(db): schema, constraints, seed
4. feat(api): auth, roles, rate limiting, errors, swagger
5. feat(api): guest booking + revenue
6. feat(worker): holds, audit, reconciler, channel push + stub
7. feat(api): front desk, folio, housekeeping
8. feat(web): screens, e2e, docs
