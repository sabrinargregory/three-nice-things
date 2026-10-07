import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "discord.js";
import cron from "node-cron";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { reminderLog } from "@/lib/db/schema";
import { resetDb, seedReminder, seedUser } from "@/tests/helpers/db";

const FIXED_DATE = "2026-10-06";

const aiState = vi.hoisted(() => ({
  getAllUsers: vi.fn(),
  getRecentActivity: vi.fn(),
  getDiscordId: vi.fn(),
  getUserByDiscordId: vi.fn(),
  generateReminder: vi.fn(),
  generateChatReply: vi.fn(),
}));

vi.mock("@/lib/ai", () => aiState);
vi.mock("@/lib/date", () => ({ today: () => FIXED_DATE }));

const discordState = vi.hoisted(() => ({ instances: [] as unknown[] }));

vi.mock("discord.js", () => {
  class FakeClient {
    static instances: unknown[] = discordState.instances;
    handlers = new Map<string, (arg: unknown) => unknown>();
    user = { tag: "test-bot#0001" };
    users = { fetch: vi.fn() };
    on(event: string, handler: (arg: unknown) => unknown) {
      this.handlers.set(event, handler);
      return this;
    }
    once(event: string, handler: (arg: unknown) => unknown) {
      this.handlers.set(event, handler);
      return this;
    }
    async login() {
      return "token";
    }
    async destroy() {}
    constructor() {
      FakeClient.instances.push(this);
    }
  }
  return {
    Client: FakeClient,
    Events: { ClientReady: "ClientReady", MessageCreate: "MessageCreate" },
    GatewayIntentBits: { Guilds: 1, DirectMessages: 2, MessageContent: 4 },
    Partials: { Channel: "Channel" },
  };
});

vi.mock("node-cron", () => {
  const schedule = vi.fn();
  return { default: { schedule }, schedule };
});

// bot/index.ts runs top-level side effects, so import it once per file.
beforeAll(async () => {
  await import("./index");
});

type FakeBotClient = Client & {
  handlers: Map<string, (arg: unknown) => unknown>;
  users: { fetch: ReturnType<typeof vi.fn> };
};

function botClient() {
  return discordState.instances[0] as unknown as FakeBotClient;
}

function fakeMessage(overrides: Record<string, unknown> = {}) {
  return {
    guildId: null,
    author: { bot: false, id: "discord-user-1" },
    content: "hello bot",
    channel: { send: vi.fn() },
    ...overrides,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  await resetDb();
});

describe("reminder sweep", () => {
  async function runSweep(awaitable: () => boolean) {
    botClient().handlers.get("ClientReady")?.(botClient());
    const sweep = vi.mocked(cron.schedule).mock.calls.at(-1)?.[1] as () => void;
    sweep();
    // The sweep runs as a floating promise; wait for the awaited effect.
    await vi.waitFor(async () => {
      expect(awaitable()).toBe(true);
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  function stubSends() {
    const sends: { id: string; message: string }[] = [];
    botClient().users.fetch.mockImplementation(async (id: string) => ({
      send: async (message: string) => {
        sends.push({ id, message });
      },
    }));
    return sends;
  }

  it("DMs users who have not finished their three things", async () => {
    const u = await seedUser({ name: "Ada" });
    aiState.getAllUsers.mockResolvedValue([{ id: u.id, name: "Ada" }]);
    aiState.getRecentActivity.mockResolvedValue([{ date: FIXED_DATE, items: ["walk"] }]);
    aiState.getDiscordId.mockResolvedValue("discord-1");
    aiState.generateReminder.mockResolvedValue("Time to log!");
    const sends = stubSends();

    await runSweep(() => sends.length === 1);

    expect(aiState.generateReminder).toHaveBeenCalledWith("Ada", [{ date: FIXED_DATE, items: ["walk"] }]);
    expect(sends).toEqual([{ id: "discord-1", message: "Time to log!" }]);
    const logged = await db.select().from(reminderLog).where(eq(reminderLog.userId, u.id));
    expect(logged).toHaveLength(1);
    expect(logged[0].entryDate).toBe(FIXED_DATE);
  });

  it("skips users who already logged three today", async () => {
    const u = await seedUser();
    aiState.getAllUsers.mockResolvedValue([{ id: u.id, name: u.name }]);
    aiState.getRecentActivity.mockResolvedValue([{ date: FIXED_DATE, items: ["a", "b", "c"] }]);

    await runSweep(() => aiState.getRecentActivity.mock.calls.length > 0);

    expect(botClient().users.fetch).not.toHaveBeenCalled();
    expect(aiState.generateReminder).not.toHaveBeenCalled();
    expect(await db.select().from(reminderLog)).toHaveLength(0);
  });

  it("skips users already reminded today", async () => {
    const u = await seedUser();
    await seedReminder(u.id, FIXED_DATE);
    aiState.getAllUsers.mockResolvedValue([{ id: u.id, name: u.name }]);
    aiState.getRecentActivity.mockResolvedValue([{ date: FIXED_DATE, items: [] }]);

    await runSweep(() => aiState.getAllUsers.mock.calls.length > 0);

    expect(aiState.getRecentActivity).not.toHaveBeenCalled();
    expect(botClient().users.fetch).not.toHaveBeenCalled();
  });

  it("skips users without a linked discord account", async () => {
    const u = await seedUser();
    aiState.getAllUsers.mockResolvedValue([{ id: u.id, name: u.name }]);
    aiState.getRecentActivity.mockResolvedValue([{ date: FIXED_DATE, items: [] }]);
    aiState.getDiscordId.mockResolvedValue(null);

    await runSweep(() => aiState.getDiscordId.mock.calls.length > 0);

    expect(botClient().users.fetch).not.toHaveBeenCalled();
    expect(await db.select().from(reminderLog)).toHaveLength(0);
  });

  it("keeps sweeping when one user fails", async () => {
    const failing = await seedUser({ name: "Failing" });
    const healthy = await seedUser({ name: "Healthy" });
    aiState.getAllUsers.mockResolvedValue([
      { id: failing.id, name: "Failing" },
      { id: healthy.id, name: "Healthy" },
    ]);
    aiState.getRecentActivity.mockResolvedValue([{ date: FIXED_DATE, items: [] }]);
    aiState.getDiscordId.mockResolvedValue("discord-x");
    aiState.generateReminder
      .mockRejectedValueOnce(new Error("model exploded"))
      .mockResolvedValueOnce("ok");
    stubSends();

    await runSweep(() => aiState.generateReminder.mock.calls.length >= 2);

    expect(aiState.generateReminder).toHaveBeenCalledTimes(2);
    const logged = await db.select().from(reminderLog);
    expect(logged.map((r) => r.userId)).toEqual([healthy.id]);
  });

  it("schedules the cron at 19:00 in the configured timezone", () => {
    botClient().handlers.get("ClientReady")?.(botClient());
    expect(cron.schedule).toHaveBeenCalledWith("0 19 * * *", expect.any(Function), { timezone: "UTC" });
  });
});

describe("DM message handler", () => {
  async function handleMessage(message: Record<string, unknown>) {
    botClient().handlers.get("MessageCreate")?.(message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  it("replies in DMs from linked users", async () => {
    const u = await seedUser({ name: "Ada" });
    aiState.getUserByDiscordId.mockResolvedValue({ id: u.id, name: "Ada" });
    aiState.generateChatReply.mockResolvedValue("nice one!");
    const message = fakeMessage();

    await handleMessage(message);

    expect(aiState.getUserByDiscordId).toHaveBeenCalledWith("discord-user-1");
    expect(aiState.generateChatReply).toHaveBeenCalledWith("Ada", "hello bot", u.id);
    expect(message.channel.send).toHaveBeenCalledWith("nice one!");
  });

  it("ignores guild messages", async () => {
    await handleMessage(fakeMessage({ guildId: "guild-1" }));
    expect(aiState.getUserByDiscordId).not.toHaveBeenCalled();
  });

  it("ignores other bots and itself", async () => {
    await handleMessage(fakeMessage({ author: { bot: true, id: "bot-1" } }));
    expect(aiState.getUserByDiscordId).not.toHaveBeenCalled();
  });

  it("ignores empty messages", async () => {
    await handleMessage(fakeMessage({ content: "   " }));
    expect(aiState.getUserByDiscordId).not.toHaveBeenCalled();
  });

  it("stays quiet for unknown discord users", async () => {
    aiState.getUserByDiscordId.mockResolvedValue(null);
    const message = fakeMessage();
    await handleMessage(message);
    expect(aiState.generateChatReply).not.toHaveBeenCalled();
    expect(message.channel.send).not.toHaveBeenCalled();
  });

  it("does not crash when replying fails", async () => {
    const u = await seedUser();
    aiState.getUserByDiscordId.mockResolvedValue({ id: u.id, name: "Ada" });
    aiState.generateChatReply.mockRejectedValue(new Error("model down"));
    const message = fakeMessage();

    await handleMessage(message);
    expect(message.channel.send).not.toHaveBeenCalled();
  });
});
