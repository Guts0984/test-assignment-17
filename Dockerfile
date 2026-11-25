# One image for api, worker, migrate and channel-stub; a second target for the Next.js web app.
FROM node:22-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY infra/db/package.json infra/db/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/channel-stub/package.json apps/channel-stub/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY packages packages
COPY infra/db infra/db
COPY apps/api apps/api
COPY apps/worker apps/worker
COPY apps/channel-stub apps/channel-stub
RUN pnpm --filter @hotel/shared run build \
 && pnpm --filter @hotel/migrate run build \
 && pnpm --filter @hotel/db run build \
 && pnpm --filter @hotel/api run build \
 && pnpm --filter @hotel/worker run build \
 && pnpm --filter @hotel/channel-stub run build

FROM build AS app
ENV NODE_ENV=production
USER node
CMD ["node", "apps/api/dist/main.js"]

FROM deps AS web-build
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @hotel/shared run build && pnpm --filter @hotel/web run build

FROM base AS web
ENV NODE_ENV=production
COPY --from=web-build /app/apps/web/.next/standalone ./
COPY --from=web-build /app/apps/web/.next/static ./apps/web/.next/static
USER node
ENV PORT=3001 HOSTNAME=0.0.0.0
CMD ["node", "apps/web/server.js"]
