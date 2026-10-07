# 3 Nice Things

A personal habit tracker with an AI accountability layer. Every day you log three nice things you did for yourself — small stuff counts. Miss the 7 PM cutoff and a Discord bot DMs you a personalized (AI-generated, not templated) reminder, using your last 7 days as context. You can also just reply to the bot and it'll chat back.

## Stack

- **Next.js 16** (App Router) + **React 19** + **Tailwind v4** + **shadcn/ui**
- **Drizzle ORM** on **SQLite** (better-sqlite3, WAL mode) — designed to migrate to Postgres later by swapping the driver and dialect
- **better-auth** with Discord OAuth
- **Vercel AI SDK** (`ai`) via **OpenRouter**
- **discord.js** bot process (shares the DB and AI code with the web app), **node-cron** for the 7 PM sweep
- **next-openapi-gen** → `public/openapi.json` → **hey-api** client → **TanStack Query**

## Layout

```
app/                 Next.js app router (pages + API routes)
  api/entries        GET/POST entries (+ [id] DELETE, /month history)
  api/me             current user + today's progress
bot/                 Discord bot process (tsx)
api-client/          generated hey-api client (do not edit)
components/          UI (app components + shadcn ui/)
lib/db/              drizzle client + schema
lib/ai.ts            AI prompts + shared DB queries (web + bot)
lib/schemas.ts       zod schemas (validation + OpenAPI source)
drizzle/             SQL migrations (committed)
public/openapi.json  generated OpenAPI spec (also served at /openapi.json)
```

## Setup

```bash
npm install
cp .env.example .env   # fill in the values
npm run db:migrate
npm run dev            # web app on :3000
npm run dev:bot        # bot in another terminal
```

### Discord application (https://discord.com/developers/applications)

1. **OAuth2 tab**: add redirect `{APP_URL}/api/auth/callback/discord`; copy Client ID + Secret
2. **Bot tab**: Reset Token -> `DISCORD_BOT_TOKEN`; enable **Message Content Intent** (needed to read DM replies)
3. Use the OAuth2 URL generator with `bot` + `identify` scopes to invite the bot (no server needed for DMs, but inviting is the easy path)

The bot DMs anyone who logged into the web app with Discord — the OAuth account link is what connects the two.

### AI

OpenRouter key from https://openrouter.ai/keys. Pick any model via `OPENROUTER_MODEL`.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` / `dev:bot` | web app / bot with watch |
| `npm run build` + `start` + `bot` | production processes |
| `npm run db:generate` | generate SQL migration from schema changes |
| `npm run db:migrate` | apply migrations |
| `npm run client:generate` | regenerate OpenAPI spec + typed client after API changes |
| `npm run lint` / `npx tsc --noEmit` | lint / typecheck |

## How the pipeline fits together

1. Route handlers use zod schemas from `lib/schemas.ts` for validation and carry `@body`/`@path`/`@response` JSDoc tags
2. `next-openapi-gen` scans handlers and emits `public/openapi.json`
3. `openapi-ts` (hey-api) generates `api-client/` with typed SDK functions + TanStack Query options/mutations
4. Components consume generated `getEntriesOptions()` / `postEntriesMutation()` etc. — API changes flow to the frontend in one regen

## Deployment (same box)

The web app and bot must run as two processes sharing the SQLite file (WAL mode makes this safe):

```bash
npm run build
pm2 start "npm run start" --name tnt-web
pm2 start "npm run bot" --name tnt-bot
```

or two systemd units running `npm run start` and `npm run bot` from the repo directory. Point `APP_URL`/`BETTER_AUTH_URL` at the public URL and put the app behind a reverse proxy (caddy/nginx) for TLS — Discord OAuth requires HTTPS in production.

Notes:
- `REMINDER_TZ` pins the timezone for both the 7 PM cron and the date rollover; leave unset to use server time
- If the box is down at 7 PM, the sweep is skipped for that day (cron doesn't catch up)
- Deleting entries is allowed for today only; history is immutable
- To start fresh: stop both processes, delete `data/`, run `npm run db:migrate`