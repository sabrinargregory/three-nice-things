import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import { generateText } from "ai";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { chatMessage, chatSession, reminderLog } from "@/lib/db/schema";
import { resetDb, seedDiscordAccount, seedEntry, seedReminder, seedUser } from "@/tests/helpers/db";
import { commands } from "./commands";

const FIXED_DATE = "2026-10-06";

// Anchor the whole activity window to FIXED_DATE so seeds never age out.
vi.mock("@/lib/date", () => ({
  today: () => FIXED_DATE,
  daysAgo: (n: number) => {
    const d = new Date(`${FIXED_DATE}T12:00:00Z`);
    d.setDate(d.getDate() - n);
    return d.toLocaleDateString("en-CA", { timeZone: "UTC" });
  },
}));

vi.mock("ai", () => ({ generateText: vi.fn() }));

const generateTextMock = vi.mocked(generateText);

function textResult(text: string) {
  return { text } as unknown as Awaited<ReturnType<typeof generateText>>;
}

type FakeInteraction = ChatInputCommandInteraction & {
  reply: Mock;
  deferReply: Mock;
  editReply: Mock;
};

function fakeInteraction(commandName: string, overrides: Record<string, unknown> = {}): FakeInteraction {
  return {
    commandName,
    user: { id: "discord-user-1" },
    reply: vi.fn(async () => ({})),
    deferReply: vi.fn(async () => ({})),
    editReply: vi.fn(async () => ({})),
    deferred: false,
    replied: false,
    ...overrides,
  } as unknown as FakeInteraction;
}

function fakeClient() {
  return {
    users: { fetch: vi.fn(async () => ({ send: vi.fn(async () => ({})) })) },
  } as unknown as Client & { users: { fetch: ReturnType<typeof vi.fn> } };
}

function command(name: string) {
  const found = commands.find((c) => c.data.name === name);
  if (!found) throw new Error(`command ${name} not defined`);
  return found;
}

beforeEach(async () => {
  vi.clearAllMocks();
  generateTextMock.mockResolvedValue(textResult("log three nice things!"));
  await resetDb();
});

describe("command registration shape", () => {
  it("exposes all seven commands with DM + guild contexts", () => {
    expect(commands.map((c) => c.data.name)).toEqual([
      "whoami",
      "today",
      "history",
      "reminder",
      "session",
      "reset",
      "test-reminder",
    ]);
    for (const c of commands) {
      const json = c.data.toJSON();
      expect(json.contexts).toEqual([0, 1]); // Guild, BotDM
    }
  });
});

describe("unlinked Discord users", () => {
  it("each command tells them how to link instead of doing anything", async () => {
    const names = ["whoami", "today", "history", "reminder", "session", "reset", "test-reminder"];
    for (const name of names) {
      const interaction = fakeInteraction(name);
      await command(name).execute(interaction, fakeClient());
      const replyContent = interaction.reply.mock.calls[0]?.[0]?.content as string;
      expect(replyContent).toContain("isn't linked");
      expect(replyContent).toContain("http://localhost:3000");
    }
  });
});

describe("whoami", () => {
  it("describes what the bot reads, does, and never does", async () => {
    const u = await seedUser({ name: "Ada" });
    await seedDiscordAccount(u.id, "discord-user-1");
    const interaction = fakeInteraction("whoami");

    await command("whoami").execute(interaction, fakeClient());

    const content = interaction.reply.mock.calls[0][0].content as string;
    expect(content).toContain("**Ada**");
    expect(content).toContain("last 7 days");
    expect(content).toContain("7:00 PM");
    expect(content).toContain("never");
    expect(content).toContain("DMs only");
  });
});

describe("today", () => {
  it("shows today's items and progress", async () => {
    const u = await seedUser({ name: "Ada" });
    await seedDiscordAccount(u.id, "discord-user-1");
    await seedEntry(u.id, "2026-10-06", "went for a walk");
    await seedEntry(u.id, "2026-10-06", "cooked dinner");
    const interaction = fakeInteraction("today");

    await command("today").execute(interaction, fakeClient());

    const content = interaction.reply.mock.calls[0][0].content as string;
    expect(content).toContain("2/3");
    expect(content).toContain("went for a walk");
    expect(content).toContain("cooked dinner");
  });

  it("encourages when nothing is logged", async () => {
    const u = await seedUser();
    await seedDiscordAccount(u.id, "discord-user-1");
    const interaction = fakeInteraction("today");

    await command("today").execute(interaction, fakeClient());

    const content = interaction.reply.mock.calls[0][0].content as string;
    expect(content).toContain("0/3");
    expect(content).toContain("Nothing logged yet");
  });
});

describe("history", () => {
  it("summarizes the last 7 days", async () => {
    const u = await seedUser();
    await seedDiscordAccount(u.id, "discord-user-1");
    await seedEntry(u.id, "2026-10-01", "read a book");
    const interaction = fakeInteraction("history");

    await command("history").execute(interaction, fakeClient());

    const content = interaction.reply.mock.calls[0][0].content as string;
    expect(content).toContain("Last 7 days");
    expect(content).toContain("read a book");
  });
});

describe("reminder", () => {
  it("reports not-sent when no reminder was logged today", async () => {
    const u = await seedUser();
    await seedDiscordAccount(u.id, "discord-user-1");
    const interaction = fakeInteraction("reminder");

    await command("reminder").execute(interaction, fakeClient());

    const content = interaction.reply.mock.calls[0][0].content as string;
    expect(content).toContain("Not sent today");
  });

  it("reports the sent time when a reminder went out today", async () => {
    const u = await seedUser();
    await seedDiscordAccount(u.id, "discord-user-1");
    await seedReminder(u.id, "2026-10-06");
    const interaction = fakeInteraction("reminder");

    await command("reminder").execute(interaction, fakeClient());

    const content = interaction.reply.mock.calls[0][0].content as string;
    expect(content).toContain("Already sent today");
  });
});

describe("session", () => {
  it("says there is no session when none exists", async () => {
    const u = await seedUser();
    await seedDiscordAccount(u.id, "discord-user-1");
    const interaction = fakeInteraction("session");

    await command("session").execute(interaction, fakeClient());

    expect(interaction.reply.mock.calls[0][0].content).toContain("No active chat session");
  });

  it("shows the active session's message count and expiry policy", async () => {
    const u = await seedUser();
    await seedDiscordAccount(u.id, "discord-user-1");
    const session = await seedSessionFor(u.id);
    await db.insert(chatMessage).values({ userId: u.id, sessionId: session.id, role: "user", content: "hi" });
    const interaction = fakeInteraction("session");

    await command("session").execute(interaction, fakeClient());

    const content = interaction.reply.mock.calls[0][0].content as string;
    expect(content).toContain("1 message(s)");
    expect(content).toContain("20"); // CHAT_HISTORY_MAX_MESSAGES default
    expect(content).toContain("60 min"); // CHAT_SESSION_TTL_MINUTES default
  });
});

describe("reset", () => {
  it("wipes chat history and reports the count", async () => {
    const u = await seedUser();
    await seedDiscordAccount(u.id, "discord-user-1");
    const session = await seedSessionFor(u.id);
    await db.insert(chatMessage).values({ userId: u.id, sessionId: session.id, role: "user", content: "hi" });
    await db.insert(chatMessage).values({ userId: u.id, sessionId: session.id, role: "assistant", content: "yo" });
    const interaction = fakeInteraction("reset");

    await command("reset").execute(interaction, fakeClient());

    const content = interaction.reply.mock.calls[0][0].content as string;
    expect(content).toContain("Forgot 2 message(s)");
    expect(await db.select().from(chatMessage)).toHaveLength(0);
    expect(await db.select().from(chatSession)).toHaveLength(0);
  });

  it("says nothing to reset when history is empty", async () => {
    const u = await seedUser();
    await seedDiscordAccount(u.id, "discord-user-1");
    const interaction = fakeInteraction("reset");

    await command("reset").execute(interaction, fakeClient());

    expect(interaction.reply.mock.calls[0][0].content).toContain("Nothing to reset");
  });
});

async function seedSessionFor(userId: string) {
  const [row] = await db
    .insert(chatSession)
    .values({ userId, startedAt: new Date(), lastActiveAt: new Date() })
    .returning();
  return row;
}

describe("test-reminder", () => {
  it("sends a reminder DM without touching reminderLog", async () => {
    const u = await seedUser({ name: "Ada" });
    await seedDiscordAccount(u.id, "discord-user-1");
    await seedEntry(u.id, "2026-10-05", "made soup");
    const interaction = fakeInteraction("test-reminder");
    const send = vi.fn(async () => ({}));
    const client = {
      users: { fetch: vi.fn(async () => ({ send })) },
    } as unknown as Client & { users: { fetch: ReturnType<typeof vi.fn> } };

    await command("test-reminder").execute(interaction, client);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: expect.anything() });
    expect(client.users.fetch).toHaveBeenCalledWith("discord-user-1");
    // The DM is the mocked model output; "soup" only appears in the prompt it was given.
    expect(send).toHaveBeenCalledWith("log three nice things!");
    const prompt = generateTextMock.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("made soup");
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining("does NOT count"));
    expect(await db.select().from(reminderLog)).toHaveLength(0);
  });

  it("lets errors bubble to the interaction error handler", async () => {
    const u = await seedUser();
    await seedDiscordAccount(u.id, "discord-user-1");
    const interaction = fakeInteraction("test-reminder");
    generateTextMock.mockRejectedValueOnce(new Error("model down"));

    await expect(command("test-reminder").execute(interaction, fakeClient())).rejects.toThrow(
      "model down",
    );
    expect(interaction.editReply).not.toHaveBeenCalledWith(expect.stringContaining("does NOT count"));
  });

  it("does not reply when the user is not linked", async () => {
    const interaction = fakeInteraction("test-reminder");

    await command("test-reminder").execute(interaction, fakeClient());

    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalled();
  });
});

describe("ephemeral replies", () => {
  it("always replies with the ephemeral flag", async () => {
    const u = await seedUser();
    await seedDiscordAccount(u.id, "discord-user-1");
    for (const name of ["whoami", "today", "history", "reminder", "session", "reset"]) {
      const interaction = fakeInteraction(name);
      await command(name).execute(interaction, fakeClient());
      expect(interaction.reply).toHaveBeenCalledWith({
        content: expect.any(String),
        flags: expect.anything(),
      });
    }
  });
});

describe("reminderLog user scoping", () => {
  it("only reports the invoking user's reminder", async () => {
    const u = await seedUser();
    const other = await seedUser();
    await seedDiscordAccount(u.id, "discord-user-1");
    await seedDiscordAccount(other.id, "discord-user-2");
    await seedReminder(other.id, "2026-10-06");
    const interaction = fakeInteraction("reminder");

    await command("reminder").execute(interaction, fakeClient());

    expect(interaction.reply.mock.calls[0][0].content).toContain("Not sent today");
    const logs = await db.select().from(reminderLog).where(eq(reminderLog.userId, other.id));
    expect(logs).toHaveLength(1);
  });
});