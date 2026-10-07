import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll } from "vitest";
import "./env";

// Deterministic dates for every server test (lib/date reads these at module load).
process.env.TZ = "UTC";
process.env.REMINDER_TZ = "UTC";

// Fresh SQLite file per test file, so files never share state.
const dataDir = mkdtempSync(path.join(tmpdir(), "tnt-tests-"));
process.env.DATABASE_PATH = path.join(dataDir, "test.db");

// lib/db opens the same path later; create the tables up front here.
const sqlite = new Database(process.env.DATABASE_PATH);
sqlite.pragma("foreign_keys = ON");
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS "account" (
    "id" text PRIMARY KEY NOT NULL,
    "account_id" text NOT NULL,
    "provider_id" text NOT NULL,
    "user_id" text NOT NULL,
    "access_token" text,
    "refresh_token" text,
    "id_token" text,
    "access_token_expires_at" integer,
    "refresh_token_expires_at" integer,
    "scope" text,
    "password" text,
    "created_at" integer NOT NULL,
    "updated_at" integer NOT NULL,
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON UPDATE no action ON DELETE cascade
  );
  CREATE TABLE IF NOT EXISTS "chat_message" (
    "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    "user_id" text NOT NULL,
    "role" text NOT NULL,
    "content" text NOT NULL,
    "created_at" integer NOT NULL,
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON UPDATE no action ON DELETE cascade
  );
  CREATE INDEX IF NOT EXISTS "chat_message_user_idx" ON "chat_message" ("user_id","created_at");
  CREATE TABLE IF NOT EXISTS "entry" (
    "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    "user_id" text NOT NULL,
    "entry_date" text NOT NULL,
    "content" text NOT NULL,
    "created_at" integer NOT NULL,
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON UPDATE no action ON DELETE cascade
  );
  CREATE INDEX IF NOT EXISTS "entry_user_date_idx" ON "entry" ("user_id","entry_date");
  CREATE TABLE IF NOT EXISTS "reminder_log" (
    "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    "user_id" text NOT NULL,
    "entry_date" text NOT NULL,
    "sent_at" integer NOT NULL,
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON UPDATE no action ON DELETE cascade
  );
  CREATE UNIQUE INDEX IF NOT EXISTS "reminder_log_user_date_idx" ON "reminder_log" ("user_id","entry_date");
  CREATE TABLE IF NOT EXISTS "session" (
    "id" text PRIMARY KEY NOT NULL,
    "expires_at" integer NOT NULL,
    "token" text NOT NULL,
    "created_at" integer NOT NULL,
    "updated_at" integer NOT NULL,
    "ip_address" text,
    "user_agent" text,
    "user_id" text NOT NULL,
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON UPDATE no action ON DELETE cascade
  );
  CREATE UNIQUE INDEX IF NOT EXISTS "session_token_unique" ON "session" ("token");
  CREATE TABLE IF NOT EXISTS "user" (
    "id" text PRIMARY KEY NOT NULL,
    "name" text NOT NULL,
    "email" text NOT NULL,
    "email_verified" integer DEFAULT false NOT NULL,
    "image" text,
    "created_at" integer NOT NULL,
    "updated_at" integer NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS "user_email_unique" ON "user" ("email");
  CREATE TABLE IF NOT EXISTS "verification" (
    "id" text PRIMARY KEY NOT NULL,
    "identifier" text NOT NULL,
    "value" text NOT NULL,
    "expires_at" integer NOT NULL,
    "created_at" integer,
    "updated_at" integer
  );
`);
sqlite.close();

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});
