# Adversarial testing (light, 3-hour mode)

Write these tests and nothing more until P0 and P1 are done. Each test must be able to fail: it asserts on the status code **and** on the database state.

## Setup

- Use real Postgres and Redis from docker compose. No mocks of the db, Redis or BullMQ.
- Boot the real Nest app on an ephemeral port. One api copy is enough, except for the IP spoofing test, which goes through nginx.
- Helpers in `apps/api/test/helpers.ts`:
  - `client({ sourceIp, token })`: real HTTP. A different IP comes from `localAddress: '127.0.0.N'`.
  - `parallel(n, fn)`: fires `n` requests at once with `Promise.all`.
  - `clock.set(iso)`: sets the injected clock.
  - `assertConsistent()`: the inventory counters equal the sum of the journal and are never negative, and every folio balance equals the sum of its lines.

## 1. Shared rules (unit, `packages/shared`)

- **Cancellation in Lisbon:** 13:59 two days before arrival is free. 14:01 charges the first night.
- **Min stay:** with min 3 nights on a Friday arrival, Fri–Sun is rejected and Thu–Sun passes.
- **Kyiv DST:** the hotel date and the 03:00 audit instant are correct on the spring-forward and fall-back nights.
- **Price:** the sum of nightly prices with a weekend +15 %.

## 2. Core races (integration, run each once and end with `assertConsistent()`)

- **Last rooms:** 50 parallel bookings on 5 free rooms. Exactly 5 are confirmed and the rest get a clear error.
- **Overlap:** "1–5" and "4–8" on the last room in parallel. One gets all its nights, the other gets none.
- **Hold vs expiry:** set the clock to exactly 10 min, then run confirm and the expire job in parallel. The result is exactly one of confirmed or expired, and the nights are released at most once.
- **Room assignment:** two assignments of the same room to overlapping bookings in parallel. One succeeds.
- **Night audit twice:** run the audit job twice in parallel for the same date. The date closes once and room nights are charged once.
- **Channel duplicate:** the same channel booking sent 10× in parallel. The result is one booking.

## 3. Login brute force (required, against the real server)

1. **One IP, one email:** IP X sends wrong passwords to one email. The attempt after `LOGIN_MAX_FAILS_PER_IP_EMAIL` gets `429` with `Retry-After`. After that, the correct password from X is still `429`.
2. **One IP, many emails:** IP X sends one wrong password to each of many emails. The attempt after `LOGIN_MAX_FAILS_PER_IP` gets `429`.
3. **Others unaffected:** while X is blocked, IP Y logs in to the same email with the right password and gets `200`.
4. **No enumeration:** a wrong password and an unknown email get the same `401` body.
5. **Spoofing (through nginx):** X sends a random `X-Forwarded-For` on each attempt and is still blocked.

## 4. Permissions (integration)

- **Route sweep:** loop over the Nest routes. Without a token, protected routes return `401`. With the wrong role, they return `403`.
- **IDOR:**
  - staff of hotel A read a booking of hotel B;
  - a housekeeper reads another housekeeper's rooms;
  - a random guest link token is used.
    All are refused.
- **Bad input:** a few invalid bodies (check-out before check-in, negative guests, malformed JSON) get the shared error format, never a bare 500.

## 5. E2E (Playwright, one flow)

- **Guest booking:** search → hold → fill in the form → confirm → the manage link opens the booking.

## Rules

- Poll with a timeout instead of sleeping, and create fresh data per test.
- When a test finds a bug, fix it, keep the test, and add a line to the README "Decisions / bugs found".
