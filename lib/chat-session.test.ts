import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { chatMessage, chatSession } from "./db/schema";
import {
  countSessionMessages,
  findActiveSession,
  getOrCreateSession,
  getSessionHistory,
  resetSession,
} from "./chat-session";
import { resetDb, seedChatMessage, seedChatSession, seedUser } from "@/tests/helpers/db";

const HOUR = 60 * 60 * 1000;

beforeEach(async () => {
  await resetDb();
});

describe("getOrCreateSession", () => {
  it("creates a first session stamped with now", async () => {
    const u = await seedUser();
    const now = new Date("2026-10-06T12:00:00Z");

    const session = await getOrCreateSession(u.id, now);

    expect(session.userId).toBe(u.id);
    expect(session.startedAt).toEqual(now);
    expect(session.lastActiveAt).toEqual(now);
    expect(await db.select().from(chatSession)).toHaveLength(1);
  });

  it("reuses the active session and touches lastActiveAt", async () => {
    const u = await seedUser();
    const now = new Date("2026-10-06T12:00:00Z");
    const active = await seedChatSession(u.id, new Date(now.getTime() - 2 * HOUR), new Date(now.getTime() - 5 * 60_000));

    const session = await getOrCreateSession(u.id, now);

    expect(session.id).toBe(active.id);
    expect(session.lastActiveAt).toEqual(now);
    const [row] = await db.select().from(chatSession).where(eq(chatSession.id, active.id));
    expect(row.lastActiveAt).toEqual(now);
  });

  it("reuses a session exactly at the TTL boundary", async () => {
    const u = await seedUser();
    const now = new Date("2026-10-06T12:00:00Z");
    const boundary = await seedChatSession(u.id, new Date(now.getTime() - 2 * HOUR), new Date(now.getTime() - HOUR));

    const session = await getOrCreateSession(u.id, now);
    expect(session.id).toBe(boundary.id);
  });

  it("starts a new session past the TTL and purges the old one with its messages", async () => {
    const u = await seedUser();
    const now = new Date("2026-10-06T12:00:00Z");
    const expired = await seedChatSession(u.id, new Date(now.getTime() - 3 * HOUR), new Date(now.getTime() - HOUR - 60_000));
    await seedChatMessage(u.id, "user", "stale question", new Date(now.getTime() - 2 * HOUR), expired.id);
    await seedChatMessage(u.id, "assistant", "stale answer", new Date(now.getTime() - 2 * HOUR), expired.id);

    const session = await getOrCreateSession(u.id, now);

    expect(session.id).not.toBe(expired.id);
    const sessions = await db.select().from(chatSession);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(session.id);
    // The expired session's messages died with it — nothing leaks into the new session.
    expect(await db.select().from(chatMessage)).toHaveLength(0);
    expect(await getSessionHistory(session.id)).toEqual([]);
  });

  it("keeps sessions of different users separate", async () => {
    const a = await seedUser();
    const b = await seedUser();
    const now = new Date("2026-10-06T12:00:00Z");

    const sa = await getOrCreateSession(a.id, now);
    const sb = await getOrCreateSession(b.id, now);

    expect(sa.id).not.toBe(sb.id);
    expect(await db.select().from(chatSession)).toHaveLength(2);
  });
});

describe("getSessionHistory", () => {
  it("returns only the given session's messages, oldest-first", async () => {
    const u = await seedUser();
    const s1 = await seedChatSession(u.id);
    const s2 = await seedChatSession(u.id);
    await seedChatMessage(u.id, "user", "s1 one", new Date(1000), s1.id);
    await seedChatMessage(u.id, "assistant", "s1 two", new Date(2000), s1.id);
    await seedChatMessage(u.id, "user", "s2 noise", new Date(3000), s2.id);

    expect(await getSessionHistory(s1.id)).toEqual([
      { role: "user", content: "s1 one" },
      { role: "assistant", content: "s1 two" },
    ]);
  });

  it("caps at CHAT_HISTORY_MAX_MESSAGES (20 by default), keeping the newest", async () => {
    const u = await seedUser();
    const s = await seedChatSession(u.id);
    for (let i = 0; i < 25; i++) {
      await seedChatMessage(u.id, i % 2 === 0 ? "user" : "assistant", `msg-${i}`, new Date((i + 1) * 1000), s.id);
    }

    const history = await getSessionHistory(s.id);

    expect(history).toHaveLength(20);
    expect(history[0].content).toBe("msg-5");
    expect(history[19].content).toBe("msg-24");
  });

  it("honors an explicit limit", async () => {
    const u = await seedUser();
    const s = await seedChatSession(u.id);
    for (let i = 0; i < 5; i++) {
      await seedChatMessage(u.id, "user", `msg-${i}`, new Date((i + 1) * 1000), s.id);
    }

    const history = await getSessionHistory(s.id, 2);
    expect(history.map((m) => m.content)).toEqual(["msg-3", "msg-4"]);
  });

  it("excludes messages without a session (legacy rows)", async () => {
    const u = await seedUser();
    const s = await seedChatSession(u.id);
    await seedChatMessage(u.id, "user", "pre-session", new Date(1000), null);
    await seedChatMessage(u.id, "user", "in-session", new Date(2000), s.id);

    expect(await getSessionHistory(s.id)).toEqual([{ role: "user", content: "in-session" }]);
  });
});

describe("resetSession", () => {
  it("deletes all sessions and messages, reporting the message count", async () => {
    const u = await seedUser();
    const s1 = await seedChatSession(u.id);
    const s2 = await seedChatSession(u.id);
    await seedChatMessage(u.id, "user", "one", new Date(1000), s1.id);
    await seedChatMessage(u.id, "assistant", "two", new Date(2000), s1.id);
    await seedChatMessage(u.id, "user", "three", new Date(3000), s2.id);

    const deleted = await resetSession(u.id);

    expect(deleted).toBe(3);
    expect(await db.select().from(chatSession)).toHaveLength(0);
    expect(await db.select().from(chatMessage)).toHaveLength(0);
  });

  it("returns 0 when the user has no sessions", async () => {
    const u = await seedUser();
    expect(await resetSession(u.id)).toBe(0);
  });

  it("only touches the target user", async () => {
    const u = await seedUser();
    const other = await seedUser();
    const s = await seedChatSession(u.id);
    const otherSession = await seedChatSession(other.id);
    await seedChatMessage(u.id, "user", "mine", new Date(1000), s.id);
    await seedChatMessage(other.id, "user", "theirs", new Date(1000), otherSession.id);

    await resetSession(u.id);

    expect(await db.select().from(chatSession).where(eq(chatSession.userId, u.id))).toHaveLength(0);
    expect(await db.select().from(chatSession).where(eq(chatSession.userId, other.id))).toHaveLength(1);
    expect(await countSessionMessages(otherSession.id)).toBe(1);
  });
});

describe("findActiveSession", () => {
  it("returns null when the user has no sessions", async () => {
    const u = await seedUser();
    expect(await findActiveSession(u.id)).toBeNull();
  });

  it("returns the session when it is inside the TTL", async () => {
    const u = await seedUser();
    const now = new Date("2026-10-06T12:00:00Z");
    const active = await seedChatSession(u.id, new Date(now.getTime() - HOUR), new Date(now.getTime() - 60_000));

    const found = await findActiveSession(u.id, now);
    expect(found?.id).toBe(active.id);
  });

  it("returns null when the latest session expired", async () => {
    const u = await seedUser();
    const now = new Date("2026-10-06T12:00:00Z");
    await seedChatSession(u.id, new Date(now.getTime() - 3 * HOUR), new Date(now.getTime() - HOUR - 1000));

    expect(await findActiveSession(u.id, now)).toBeNull();
  });
});