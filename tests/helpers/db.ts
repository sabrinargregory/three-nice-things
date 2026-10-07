import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  account,
  chatMessage,
  chatSession,
  entry,
  reminderLog,
  user,
} from "@/lib/db/schema";

let seq = 0;

export type SeedUser = Awaited<ReturnType<typeof seedUser>>;

export async function seedUser(overrides: Partial<typeof user.$inferInsert> = {}) {
  seq += 1;
  const [row] = await db
    .insert(user)
    .values({
      id: overrides.id ?? `user-${seq}`,
      name: overrides.name ?? `User ${seq}`,
      email: overrides.email ?? `user-${seq}@example.com`,
      image: overrides.image ?? null,
      createdAt: overrides.createdAt ?? new Date(),
      updatedAt: overrides.updatedAt ?? new Date(),
      ...overrides,
    })
    .returning();
  return row;
}

export async function seedDiscordAccount(userId: string, discordId: string) {
  seq += 1;
  const [row] = await db
    .insert(account)
    .values({
      id: `account-${seq}`,
      accountId: discordId,
      providerId: "discord",
      userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  return row;
}

export async function seedEntry(
  userId: string,
  entryDate: string,
  content: string,
  createdAt = new Date(),
) {
  const [row] = await db.insert(entry).values({ userId, entryDate, content, createdAt }).returning();
  return row;
}

export async function seedReminder(userId: string, entryDate: string) {
  const [row] = await db.insert(reminderLog).values({ userId, entryDate }).returning();
  return row;
}

export async function seedChatMessage(
  userId: string,
  role: "user" | "assistant",
  content: string,
  createdAt = new Date(),
  sessionId: number | null = null,
) {
  const [row] = await db
    .insert(chatMessage)
    .values({ userId, role, content, createdAt, sessionId })
    .returning();
  return row;
}

export async function seedChatSession(
  userId: string,
  startedAt = new Date(),
  lastActiveAt = new Date(),
) {
  const [row] = await db
    .insert(chatSession)
    .values({ userId, startedAt, lastActiveAt })
    .returning();
  return row;
}

/** Wipe all rows (children first for FKs) between tests. */
export async function resetDb() {
  await db.run(sql`DELETE FROM chat_message`);
  await db.run(sql`DELETE FROM chat_session`);
  await db.run(sql`DELETE FROM reminder_log`);
  await db.run(sql`DELETE FROM entry`);
  await db.run(sql`DELETE FROM account`);
  await db.run(sql`DELETE FROM session`);
  await db.run(sql`DELETE FROM verification`);
  await db.run(sql`DELETE FROM user`);
}
