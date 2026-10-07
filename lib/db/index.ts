import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as schema from "./schema";

const dbPath = resolve(/*turbopackIgnore: true*/ process.env.DATABASE_PATH ?? "./data/app.db");

mkdirSync(dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);

// WAL lets the Next.js server and the bot process share the file safely.
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("busy_timeout = 5000");

const globalForDb = globalThis as unknown as { __tntDb?: ReturnType<typeof createDb> };

function createDb() {
  return drizzle(sqlite, { schema });
}

export const db = globalForDb.__tntDb ?? createDb();
if (process.env.NODE_ENV !== "production") globalForDb.__tntDb = db;

export { schema };
