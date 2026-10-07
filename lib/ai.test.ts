import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { generateText } from "ai";
import { db } from "./db";
import { chatMessage, chatSession } from "./db/schema";
import { daysAgo } from "./date";
import {
  resetDb,
  seedChatMessage,
  seedChatSession,
  seedDiscordAccount,
  seedEntry,
  seedUser,
} from "@/tests/helpers/db";
import {
  generateChatReply,
  generateReminder,
  getAllUsers,
  getDiscordId,
  getRecentActivity,
  getUserByDiscordId,
  getUserIdsWithEntriesOnDates,
  type ActivityDay,
} from "./ai";

vi.mock("ai", () => ({ generateText: vi.fn() }));

const generateTextMock = vi.mocked(generateText);

function textResult(text: string) {
  return { text } as unknown as Awaited<ReturnType<typeof generateText>>;
}

beforeEach(async () => {
  vi.clearAllMocks();
  await resetDb();
});

describe("getRecentActivity", () => {
  it("returns the last 7 days oldest-first, filling empty days", async () => {
    const u = await seedUser();
    await seedEntry(u.id, daysAgo(5), "older entry", new Date(1000));
    await seedEntry(u.id, daysAgo(5), "newer entry", new Date(2000));
    await seedEntry(u.id, daysAgo(0), "today entry", new Date(3000));

    const activity = await getRecentActivity(u.id);

    expect(activity).toHaveLength(7);
    expect(activity[0].date).toBe(daysAgo(6));
    expect(activity[6].date).toBe(daysAgo(0));
    expect(activity[1].items).toEqual(["older entry", "newer entry"]);
    expect(activity[6].items).toEqual(["today entry"]);
    expect(activity[3].items).toEqual([]);
  });

  it("ignores other users and entries outside the window", async () => {
    const u = await seedUser();
    const other = await seedUser();
    await seedEntry(other.id, daysAgo(0), "someone else's", new Date(1000));
    await seedEntry(u.id, daysAgo(9), "too old", new Date(2000));

    const activity = await getRecentActivity(u.id);
    expect(activity.every((day) => day.items.length === 0)).toBe(true);
  });
});

describe("getDiscordId", () => {
  it("returns the linked discord account id", async () => {
    const u = await seedUser();
    await seedDiscordAccount(u.id, "discord-123");
    expect(await getDiscordId(u.id)).toBe("discord-123");
  });

  it("returns null when no discord account is linked", async () => {
    const u = await seedUser();
    expect(await getDiscordId(u.id)).toBeNull();
  });
});

describe("getAllUsers", () => {
  it("returns every user's id and name", async () => {
    const a = await seedUser({ name: "Ada" });
    const b = await seedUser({ name: "Grace" });
    const users = await getAllUsers();
    expect(users).toEqual(
      expect.arrayContaining([
        { id: a.id, name: "Ada" },
        { id: b.id, name: "Grace" },
      ]),
    );
    expect(users).toHaveLength(2);
  });
});

describe("getUserByDiscordId", () => {
  it("finds the app user linked to a discord id", async () => {
    const u = await seedUser({ name: "Ada" });
    await seedDiscordAccount(u.id, "discord-777");

    const found = await getUserByDiscordId("discord-777");
    expect(found).toEqual({ id: u.id, name: "Ada" });
  });

  it("returns null for unknown discord ids", async () => {
    expect(await getUserByDiscordId("nobody")).toBeNull();
  });
});

describe("generateReminder", () => {
  it("sends the system prompt plus an activity summary to the model", async () => {
    generateTextMock.mockResolvedValue(textResult("  hey, log your things!  "));
    const u = await seedUser();
    const activity: ActivityDay[] = [
      { date: daysAgo(1), items: ["made soup"] },
      { date: daysAgo(0), items: [] },
    ];

    const reminder = await generateReminder(u.name, activity);

    expect(reminder).toBe("hey, log your things!");
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    const args = generateTextMock.mock.calls[0][0];
    expect(args.system).toContain("accountability buddy");
    expect(args.prompt).toContain(`User: ${u.name}`);
    expect(args.prompt).toContain("logged 0 of 3 nice things today");
    expect(args.prompt).toContain(`${daysAgo(1)}:\n- made soup`);
    expect(args.prompt).toContain(`${daysAgo(0)}: nothing logged`);
  });

  it("mentions when there is no history at all", async () => {
    generateTextMock.mockResolvedValue(textResult("welcome!"));
    const activity: ActivityDay[] = [{ date: daysAgo(0), items: [] }];

    await generateReminder("Ada", activity);

    const args = generateTextMock.mock.calls[0][0];
    expect(args.prompt).toContain("(no entries logged in the last 7 days)");
  });

  it("counts today's logged items correctly", async () => {
    generateTextMock.mockResolvedValue(textResult("nice"));
    const activity: ActivityDay[] = [
      { date: daysAgo(1), items: [] },
      { date: daysAgo(0), items: ["a", "b"] },
    ];

    await generateReminder("Ada", activity);

    expect(generateTextMock.mock.calls[0][0].prompt).toContain("logged 2 of 3 nice things today");
  });
});

describe("generateChatReply", () => {
  it("passes the session's history plus the new message to the model", async () => {
    generateTextMock.mockResolvedValue(textResult("sounds great!"));
    const u = await seedUser();
    const session = await seedChatSession(u.id);
    await seedChatMessage(u.id, "user", "earlier message", new Date(1000), session.id);
    await seedChatMessage(u.id, "assistant", "earlier reply", new Date(2000), session.id);
    // Legacy row without a session must not leak into the prompt.
    await seedChatMessage(u.id, "user", "pre-session noise", new Date(3000), null);

    const reply = await generateChatReply(u.name, "new message", u.id);

    expect(reply).toBe("sounds great!");
    const args = generateTextMock.mock.calls[0][0];
    expect(args.messages).toEqual([
      { role: "user", content: "earlier message" },
      { role: "assistant", content: "earlier reply" },
      { role: "user", content: "new message" },
    ]);
    expect(args.system).toContain("accountability buddy");
  });

  it("stores both sides of the conversation in the active session", async () => {
    generateTextMock.mockResolvedValue(textResult("here you go"));
    const u = await seedUser();

    await generateChatReply(u.name, "hello", u.id);

    const rows = await db.select().from(chatMessage).where(eq(chatMessage.userId, u.id));
    expect(rows.map((r) => ({ role: r.role, content: r.content }))).toEqual(
      expect.arrayContaining([
        { role: "user", content: "hello" },
        { role: "assistant", content: "here you go" },
      ]),
    );
    const [session] = await db.select().from(chatSession).where(eq(chatSession.userId, u.id));
    expect(session).toBeDefined();
    expect(rows.every((r) => r.sessionId === session.id)).toBe(true);
  });
});

describe("getUserIdsWithEntriesOnDates", () => {
  it("returns distinct user ids with entries on the given dates", async () => {
    const a = await seedUser();
    const b = await seedUser();
    await seedEntry(a.id, "2026-10-01", "one", new Date(1000));
    await seedEntry(a.id, "2026-10-01", "two", new Date(2000));
    await seedEntry(b.id, "2026-10-02", "three", new Date(3000));

    const ids = await getUserIdsWithEntriesOnDates(["2026-10-01", "2026-10-02"]);
    expect(ids).toHaveLength(2);
    expect(ids).toEqual(expect.arrayContaining([a.id, b.id]));
  });

  it("returns nothing when no entries match", async () => {
    const a = await seedUser();
    await seedEntry(a.id, "2026-10-01", "one", new Date(1000));
    expect(await getUserIdsWithEntriesOnDates(["2026-09-30"])).toEqual([]);
  });
});
