# CLAUDE.md: standing rules (hotel-chain booking, 3-hour mode)

## Priority

1. `ASSIGNMENT.md` defines correct behavior.
2. `plan.md`.
3. This file.
4. Your own defaults.

Under the time box, cut features (see the priorities in the prompt), not correctness. Log every cut in the README "Not done" section.

## Stack

The assignment fixes the stack, so use exactly this:

- PostgreSQL 16 + Prisma, with raw SQL for locks and constraints.
- Redis 7: BullMQ, the Socket.IO adapter and limiter counters.
- NestJS api ×2 behind nginx, and a NestJS worker.
- Next.js 15 + React 19, with TanStack Query, React Hook Form, Tailwind and a client generated from OpenAPI.
- `packages/shared`, Vitest, Playwright.

Defaults: pnpm workspaces, TypeScript strict, `nestjs-zod`, `unplugin-swc` for Vitest with Nest.

## Paradigm

- **Classes only for NestJS constructs**: modules, controllers, providers/services, guards, interceptors, pipes, filters. Keep them thin. They wire dependencies and delegate to pure functions. No business logic in a class body.
- **Everything else is functional**: no `class`, no `this`, no inheritance. Pure functions, immutable data (`readonly`, `as const`, spread instead of mutate), composition over inheritance.
- Side effects live at the edges (db, redis, http, clock, random). Inject them as parameters or via factories `createX(deps) => ({ ... })`. Never import a singleton inside a pure function.
- Expected failures are values (`Result<T, E>`). Throw only for programmer errors and unexpected states.
- Named exports only. No default exports. No barrel files that re-export whole folders, except FSD public APIs. **One exception:** Next.js route files (`page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`, `template.tsx`, `default.tsx`) and tool config files that require a default export may use `export default`. Keep those files as thin wrappers that import named exports from `src/pages`.
- TypeScript `strict`. No `any`, no `@ts-ignore` without a one-line reason, no non-null `!` assertions. Validate every external input with zod at the boundary and infer types from the schemas.
- **Inject the clock** (`now()`) into the api, worker and shared rules, so tests can move time.

## Frontend: Feature-Sliced Design (strict)

```
apps/web/src/
  app/        providers, router, global styles, entry
  pages/      route-level composition
  widgets/    large self-contained UI blocks
  features/   user actions that deliver business value
  entities/   business entities (types, api, UI)
  shared/     ui kit, api client, lib, config. No business logic.
```

- A layer may import only from layers below it. Never import sideways between slices on the same layer.
- Each slice has segments by purpose: `ui/`, `model/`, `api/`, `lib/`, `config/`. Import a slice only through its `index.ts` public API, never its internals.
- Enforce this with a linter (`steiger` or `eslint-plugin-boundaries`) and make violations fail lint.
- Components are functions with hooks. UI holds no business rules. Rules live in pure functions in `model/` or `lib/`.

### FSD inside Next.js (App Router)

Next owns the root `app/` folder for routes, and FSD's `app` and `pages` layers both clash with Next's folders. Use this layout:

- Root `apps/web/app/` holds only Next route files (`page.tsx`, `layout.tsx`, route handlers). Each one is a thin re-export or composition of a page from `src/pages`.
- All FSD layers live in `apps/web/src/` (`app`, `pages`, `widgets`, `features`, `entities`, `shared`).
- Add an empty `apps/web/pages/README.md` so Next never treats `src/pages` as a Pages Router.
- Server Components are allowed, but business rules still live in pure functions in `model/` or `lib/`, or in `packages/shared`.
- The API client is generated from OpenAPI into `shared/api`. Never hand-edit generated code, and regenerate it with a script.

## Backend structure (applies to `apps/api` and `apps/worker`)

```
apps/api/src/
  config/env.ts        zod-parsed env, the only reader of process.env
  main.ts, app.module.ts
  modules/<domain>/
    <domain>.module.ts | .controller.ts | .service.ts   (Nest classes, thin)
    domain/            pure business logic, no framework imports
    dto/               zod schemas + inferred types
    repo/              data access functions
    *.spec.ts          tests next to the code
  common/              guards, filters, interceptors, pipes, rate limiters, real-IP
  infra/               db and redis clients, factories, clock
```

One folder per responsibility. A file has one reason to change and stays under about 200 lines. Business rules in `domain/` must be testable without Nest, db or redis.

Domains for this assignment: auth, hotels, inventory, rates, holds, bookings, frontdesk, folio, housekeeping, channel, reports, jobs-admin. The worker uses the same structure, with one module per job type.

## Repo layout

`apps/api`, `apps/worker`, `apps/web`, `packages/shared`, `apps/channel-stub`, `infra/{nginx,db,redis}`, `docker-compose.yml`, `.env.example`, `docs/`, `plan.md`, `CLAUDE.md`, `ASSIGNMENT.md`.

`packages/shared` holds zod schemas, the error schema, rule constants and pure calculations: hotel date, nights, cancellation deadline and penalty, restrictions, price, status transitions. `api`, `worker` and `web` all import from it, so a rule exists in exactly one place. It contains no framework code and no IO.

## Data rules (do not cut these)

- **Inventory:** one row per (room type, night) with `sold` and `held`, plus an append-only `inventory_journal`. Every change writes both in one transaction.
  - Lock the nights with `SELECT … FOR UPDATE ORDER BY night`.
  - A CHECK constraint enforces `sold + held <= capacity` (rooms − out of order + overbooking allowance), except for accepted channel overbooking.
- **Physical room:** an `EXCLUDE USING gist (room_id WITH =, nights WITH &&)` constraint prevents double assignment.
- **Status changes** are conditional updates (`UPDATE … WHERE status = 'held'`). Exactly one of confirm and expire wins, and exactly one of cancel and no-show wins.
- **Channel import:** unique on the channel booking number. Changes and cancels carry a version, and a stale one is dropped.
- **Money:** integer minor units. Folio lines are append-only, corrections are storno lines, and balance = sum of lines.
- **Night audit:** a unique row per (hotel, hotel date). Dates close in order, and missed days catch up one by one.
- **Jobs** are idempotent. After a Redis wipe, the reconciler rebuilds pending jobs from Postgres.

## Rate limiting (required)

**Real client IP**

- nginx sets `X-Forwarded-For` and `X-Real-IP` to `$remote_addr`.
- Nest trusts proxy headers only from `TRUSTED_PROXY_CIDRS`.
- The api copies expose no host ports. Traffic reaches them only through nginx.

**Storage**

- Counters live in Redis, updated atomically (Lua, or INCR + EXPIRE in a MULTI), and are shared by both api copies.
- If Redis is down, the login and guest-link limiters fall back to an in-memory store per process, so they keep blocking. The general limiter fails open.

**Limiters** (every value is an env variable)
| Limiter | Key | Default |
| --- | --- | --- |
| General | IP | `RATE_LIMIT_GLOBAL_PER_MIN=600` |
| Login, per IP + email | `ip:email` | `LOGIN_MAX_FAILS_PER_IP_EMAIL=5` per `LOGIN_FAIL_WINDOW_SEC=900` |
| Login, per IP (spray) | `ip` | `LOGIN_MAX_FAILS_PER_IP=20` per window |
| Login, per email (distributed) | `email` | `LOGIN_MAX_FAILS_PER_EMAIL=50` per window |
| Login block duration | — | `LOGIN_BLOCK_SEC=900` |
| Guest link failed lookups | IP | `GUEST_LINK_LOOKUPS_PER_MIN=30` |
| Channel endpoints | channel key | `CHANNEL_RATE_PER_MIN=6000` |

**Login rules**

- Check the block before checking the password.
- While blocked, return `429 RATE_LIMITED` with `Retry-After`, even if the password is correct.
- A failed login always gets the same `401 INVALID_CREDENTIALS`, whether or not the email exists. Use a dummy hash for unknown emails.
- Lowercase and trim the email before using it as a key.
- A successful login resets only the `ip:email` counter.
- Never log passwords.

**Don't break the acceptance flows:** no limit may break 200 concurrent bookings or the 10× channel duplicate.

## Security baseline

- Staff passwords use argon2id.
- Staff get a JWT access token. Refresh rotation is optional; if it's skipped, note it in "Not done".
- Roles are scoped per hotel and checked in every endpoint and socket join. Housekeepers see only their own rooms.
- The guest link is a 128-bit random token, stored hashed.
- The channel key is scoped to connected hotels and room types. Outbound pushes are HMAC-signed.
- One error format, `{ code, message, details? }`, used everywhere and declared in OpenAPI. Never a bare 500.
- Body-size limit, helmet, and CORS from env.

## Environment

- `.env.example` lists every variable with a comment and is committed. `.env` is gitignored.
- Each app has `src/config/env.ts`: zod + safeParse, with defaults only for non-sensitive values. Secrets are required: `JWT_SECRET`, `DB_PASSWORD`, `CHANNEL_HMAC_SECRET`, `CHANNEL_API_KEY`.
- Nothing else reads `process.env`.

## Testing (light)

- Write only what the skill lists. Integration tests use real Postgres and Redis, with no mocks of the db, Redis or BullMQ.
- No `.skip`, `.only` or fixed sleeps. Move time with the injected clock.
- No mutation checks, perf suites or soak loops in 3-hour mode.

## CI

`.github/workflows/ci.yml` from the first commit:

- install with a frozen lockfile;
- typecheck;
- lint;
- regenerate the OpenAPI client + `git diff --exit-code`;
- tests, with Postgres and Redis as services;
- build.

## Git

- About 6–8 commits, one per working block, using Conventional Commits. Never push.
- Never commit `.env` or `node_modules`.

## Working rules

- Run it. Never claim something works without running it.
- Don't ask questions. Decide and log the decision in plan.md "Assumptions" and the README decisions section.
- No `console.log` or commented-out code.
- The README covers:
  - how to run and test;
  - inventory and locking;
  - the hotel date and DST, with an example;
  - background jobs;
  - the channel exchange;
  - the booking and room status tables;
  - rate limiting;
  - decisions;
  - **Not done**.
    It must match actual behavior.
