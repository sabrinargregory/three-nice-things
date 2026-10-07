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
  formatActivity: vi.fn(),
}));

vi.mock("@/lib/ai", () => aiState);
vi.mock("@/lib/date", () => ({ today: () => FIXED_DATE }));

const discordState = vi.hoisted(() => ({ instances: [] as unknown[], restInstances: [] as unknown[] }));

vi.mock("discord.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("discord.js")>();
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
  class FakeREST {
    static instances: FakeREST[] = discordState.restInstances as FakeREST[];
    puts: { route: unknown; body: unknown }[] = [];
    setToken() {
      return this;
    }
    async put(route: unknown, { body }: { body: unknown }) {
      this.puts.push({ route, body });
      return {};
    }
    constructor() {
      FakeREST.instances.push(this);
    }
  }
  return {
    ...actual,
    Client: FakeClient,
    REST: FakeREST,
    Events: {
      ...actual.Events,
      ClientReady: "ClientReady",
      MessageCreate: "MessageCreate",
      InteractionCreate: "InteractionCreate",
    },
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
  discordState.restInstances.length = 0;
});

// The ClientReady handler is async (registers slash commands before the cron).
function fireReady(): Promise<unknown> {
  return botClient().handlers.get("ClientReady")?.(botClient()) as Promise<unknown>;
}

describe("slash command registration", () => {
  it("registers all commands globally on ready", async () => {
    await fireReady();

    await vi.waitFor(() => {
      expect(discordState.restInstances.length).toBeGreaterThan(0);
    });
    const rest = discordState.restInstances.at(-1) as { puts: { route: unknown; body: unknown[] }[] };
    expect(rest.puts).toHaveLength(1); // no DISCORD_GUILD_ID in test env -> global only
    expect(rest.puts[0].body).toHaveLength(7);
  });
});

describe("reminder sweep", () => {
  async function runSweep(awaitable: () => boolean) {
    await fireReady();
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

  it("schedules the cron at 19:00 in the configured timezone", async () => {
    await fireReady();
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

  it("handles a user's DMs one at a time, never concurrently", async () => {
    const u = await seedUser();
    aiState.getUserByDiscordId.mockResolvedValue({ id: u.id, name: "Ada" });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    aiState.generateChatReply.mockImplementation(() => gate.then(() => "first reply"));

    const m1 = fakeMessage({ content: "first" });
    const m2 = fakeMessage({ content: "second" });
    botClient().handlers.get("MessageCreate")?.(m1);
    botClient().handlers.get("MessageCreate")?.(m2);

    // The first message still holds the queue, so the second hasn't started.
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(aiState.generateChatReply).toHaveBeenCalledTimes(1);

    release();
    await vi.waitFor(() => expect(aiState.generateChatReply).toHaveBeenCalledTimes(2));
    expect(m1.channel.send).toHaveBeenCalledWith("first reply");
    expect(m2.channel.send).toHaveBeenCalledWith("first reply");
  });
});

describe("interaction handler", () => {
  function fakeInteraction(overrides: Record<string, unknown> = {}) {
    return {
      isChatInputCommand: () => true,
      commandName: "whoami",
      user: { id: "discord-user-1" },
      reply: vi.fn(async () => ({})),
      deferReply: vi.fn(async () => ({})),
      editReply: vi.fn(async () => ({})),
      deferred: false,
      replied: false,
      ...overrides,
    };
  }

  async function handleInteraction(interaction: Record<string, unknown>) {
    botClient().handlers.get("InteractionCreate")?.(interaction);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }

  it("dispatches to the matching command", async () => {
    const u = await seedUser({ name: "Ada" });
    aiState.getUserByDiscordId.mockResolvedValue({ id: u.id, name: "Ada" });
    const interaction = fakeInteraction();

    await handleInteraction(interaction);

    expect(aiState.getUserByDiscordId).toHaveBeenCalledWith("discord-user-1");
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining("**Ada**"),
      flags: expect.anything(),
    });
  });

  it("ignores non-chat-input interactions", async () => {
    const interaction = fakeInteraction({ isChatInputCommand: () => false });
    await handleInteraction(interaction);
    expect(aiState.getUserByDiscordId).not.toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it("replies with a fallback error when a command throws", async () => {
    aiState.getUserByDiscordId.mockRejectedValue(new Error("db exploded"));
    const interaction = fakeInteraction();

    await handleInteraction(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining("Something went wrong"),
      flags: expect.anything(),
    });
  });

  it("edits the deferred reply when a command throws late", async () => {
    const u = await seedUser();
    aiState.getUserByDiscordId.mockResolvedValue({ id: u.id, name: "Ada" });
    aiState.generateReminder.mockRejectedValue(new Error("model down"));
    const interaction = fakeInteraction({ commandName: "test-reminder", deferred: true });

    await handleInteraction(interaction);

    expect(interaction.deferReply).toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining("Something went wrong"),
    });
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it("does nothing for unknown command names", async () => {
    const interaction = fakeInteraction({ commandName: "nope" });
    await handleInteraction(interaction);
    expect(interaction.reply).not.toHaveBeenCalled();
  });
});
