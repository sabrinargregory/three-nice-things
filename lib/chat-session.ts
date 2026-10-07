import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { chatMessage, chatSession } from "./db/schema";
import { loadEnv } from "./env";

export type ChatSession = typeof chatSession.$inferSelect;

function sessionTtlMs(): number {
  const { CHAT_SESSION_TTL_MINUTES } = loadEnv("ai");
  return CHAT_SESSION_TTL_MINUTES * 60 * 1000;
}

/**
 * Returns the user's active chat session, starting a new one when the previous
 * session went quiet past the TTL. Expired sessions — and their messages — are
 * purged on rollover, so only the active session ever has messages. Every call
 * counts as activity and refreshes `lastActiveAt`.
 */
export async function getOrCreateSession(userId: string, now = new Date()): Promise<ChatSession> {
  const [latest] = await db
    .select()
    .from(chatSession)
    .where(eq(chatSession.userId, userId))
    .orderBy(desc(chatSession.lastActiveAt))
    .limit(1);

  if (latest && now.getTime() - latest.lastActiveAt.getTime() <= sessionTtlMs()) {
    await db.update(chatSession).set({ lastActiveAt: now }).where(eq(chatSession.id, latest.id));
    return { ...latest, lastActiveAt: now };
  }

  await db.delete(chatSession).where(eq(chatSession.userId, userId));
  const [created] = await db
    .insert(chatSession)
    .values({ userId, startedAt: now, lastActiveAt: now })
    .returning();
  return created;
}

/**
 * Messages of one session, oldest-first, capped at CHAT_HISTORY_MAX_MESSAGES
 * (or an explicit limit) so the model prompt stays bounded.
 */
export async function getSessionHistory(sessionId: number, limit?: number) {
  const max = limit ?? loadEnv("ai").CHAT_HISTORY_MAX_MESSAGES;
  const rows = await db
    .select({ role: chatMessage.role, content: chatMessage.content })
    .from(chatMessage)
    .where(eq(chatMessage.sessionId, sessionId))
    .orderBy(desc(chatMessage.id))
    .limit(max);
  return rows.toReversed();
}

/**
 * Wipes every session of the user (messages go with them via cascade) and
 * returns how many messages were deleted, so /reset can say what it did.
 */
export async function resetSession(userId: string): Promise<number> {
  const sessions = await db
    .select({ id: chatSession.id })
    .from(chatSession)
    .where(eq(chatSession.userId, userId));
  if (sessions.length === 0) return 0;

  const [counted] = await db
    .select({ n: sql<number>`count(*)` })
    .from(chatMessage)
    .where(inArray(chatMessage.sessionId, sessions.map((s) => s.id)));

  await db.delete(chatSession).where(eq(chatSession.userId, userId));
  return counted?.n ?? 0;
}

/** Number of messages recorded in one session. */
export async function countSessionMessages(sessionId: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(chatMessage)
    .where(eq(chatMessage.sessionId, sessionId));
  return row?.n ?? 0;
}

/** The user's active session if it exists and is still inside the TTL window. */
export async function findActiveSession(userId: string, now = new Date()) {
  const [latest] = await db
    .select()
    .from(chatSession)
    .where(eq(chatSession.userId, userId))
    .orderBy(desc(chatSession.lastActiveAt))
    .limit(1);
  if (!latest) return null;
  if (now.getTime() - latest.lastActiveAt.getTime() > sessionTtlMs()) return null;
  return latest;
}