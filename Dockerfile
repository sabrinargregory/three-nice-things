# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS deps
# Build tools so better-sqlite3 can compile if no prebuilt binary matches.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Next.js build. Route modules validate env at import time (lib/env.ts), so
# placeholder values keep `next build` happy; real values are injected at
# runtime via compose env_file and are never baked into the image.
FROM deps AS build
WORKDIR /app
COPY . .
RUN mkdir -p data \
  && npm run db:migrate \
  && BETTER_AUTH_SECRET=build-placeholder \
     BETTER_AUTH_URL=http://localhost:3000 \
     DISCORD_CLIENT_ID=build-placeholder \
     DISCORD_CLIENT_SECRET=build-placeholder \
     OPENROUTER_API_KEY=build-placeholder \
     npm run build

FROM node:24-bookworm-slim AS runtime-base
WORKDIR /app
# Pre-create + own the data dir so the named volume mounts with node ownership.
RUN mkdir -p /app/data && chown node:node /app/data
USER node

FROM runtime-base AS web
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]

FROM runtime-base AS bot
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY bot/index.ts bot/commands.ts ./bot/
COPY lib ./lib
CMD ["node_modules/.bin/tsx", "bot/index.ts"]

FROM runtime-base AS migrate
COPY --from=deps /app/node_modules ./node_modules
COPY drizzle.config.ts ./
COPY drizzle ./drizzle
COPY lib/db ./lib/db
CMD ["node_modules/.bin/drizzle-kit", "migrate"]
