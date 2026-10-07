import { Client, Events, GatewayIntentBits, MessageFlags, Partials, REST, Routes } from "discord.js";
import cron from "node-cron";
import { eq } from "drizzle-orm";
import { db } from "../lib/db";
import { reminderLog } from "../lib/db/schema";
import { commands } from "./commands";
import {
  generateChatReply,
  generateReminder,
  getAllUsers,
  getDiscordId,
  getRecentActivity,
  getUserByDiscordId,
} from "../lib/ai";
import { today } from "../lib/date";
import { loadEnv } from "../lib/env";

const { DISCORD_BOT_TOKEN: token, DISCORD_GUILD_ID: guildId } = loadEnv("bot");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
    // Privileged: enable "Message Content Intent" in the Discord developer portal
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

async function reminderSweep() {
  const date = today();
  console.log(`[bot] running 7pm reminder sweep for ${date}`);

  const users = await getAllUsers();
  const alreadyReminded = await db
    .select({ userId: reminderLog.userId })
    .from(reminderLog)
    .where(eq(reminderLog.entryDate, date));
  const remindedSet = new Set(alreadyReminded.map((r) => r.userId));

  for (const appUser of users) {
    try {
      if (remindedSet.has(appUser.id)) continue;

      const activity = await getRecentActivity(appUser.id);
      const doneToday = activity[activity.length - 1]?.items.length ?? 0;
      if (doneToday >= 3) continue;

      const discordId = await getDiscordId(appUser.id);
      if (!discordId) continue;

      const discordUser = await client.users.fetch(discordId);
      const message = await generateReminder(appUser.name, activity);
      await discordUser.send(message);

      await db.insert(reminderLog).values({ userId: appUser.id, entryDate: date });
      console.log(`[bot] reminder sent to ${appUser.name} (${doneToday}/3 logged)`);
    } catch (err) {
      console.error(`[bot] failed to remind ${appUser.name}:`, err);
    }
  }

  console.log("[bot] sweep complete");
}

/** Registers slash commands: instantly in the dev guild (if set) and globally. */
async function registerSlashCommands(applicationId: string) {
  const rest = new REST().setToken(token);
  const body = commands.map((command) => command.data.toJSON());
  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body });
    console.log(`[bot] registered ${body.length} slash commands in guild ${guildId}`);
  }
  await rest.put(Routes.applicationCommands(applicationId), { body });
  console.log(`[bot] registered ${body.length} global slash commands`);
}

client.once(Events.ClientReady, async (c) => {
  console.log(`[bot] logged in as ${c.user.tag}`);

  try {
    await registerSlashCommands(c.user.id);
  } catch (err) {
    console.error("[bot] slash command registration failed:", err);
  }

  const timezone = process.env.REMINDER_TZ || undefined;
  cron.schedule("0 19 * * *", () => void reminderSweep(), { timezone });
  console.log(`[bot] reminder cron scheduled at 19:00 ${timezone ?? "(server time)"}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = commands.find((c) => c.data.name === interaction.commandName);
  if (!command) return;
  try {
    await command.execute(interaction, client);
  } catch (err) {
    console.error(`[bot] /${interaction.commandName} failed:`, err);
    const content = "Something went wrong on my end — try again in a bit.";
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content });
      } else {
        await interaction.reply({ content, flags: MessageFlags.Ephemeral });
      }
    } catch {
      // Interaction expired; nothing left to salvage.
    }
  }
});

// Messages are handled one-at-a-time per user so concurrent DMs can't race on
// chat session creation (the DB would happily create two sessions otherwise).
const userQueues = new Map<string, Promise<unknown>>();

function serializeForUser(discordId: string, task: () => Promise<void>): Promise<void> {
  const previous = userQueues.get(discordId) ?? Promise.resolve();
  const next = previous.then(task, task);
  // The queue stores a never-rejecting twin so one failure can't break the chain.
  const stored = next.catch(() => {});
  userQueues.set(discordId, stored);
  void stored.finally(() => {
    if (userQueues.get(discordId) === stored) userQueues.delete(discordId);
  });
  return next;
}

client.on(Events.MessageCreate, (message) => {
  // DMs only, and never respond to other bots or ourselves
  if (message.guildId !== null || message.author.bot) return;
  const content = message.content.trim();
  if (!content) return;

  void serializeForUser(message.author.id, async () => {
    try {
      const appUser = await getUserByDiscordId(message.author.id);
      if (!appUser) return; // signed up via web without Discord link (not possible today, but safe)

      const reply = await generateChatReply(appUser.name, content, appUser.id);
      await message.channel.send(reply);
    } catch (err) {
      console.error("[bot] failed to handle DM:", err);
    }
  });
});

process.on("SIGINT", () => {
  console.log("[bot] shutting down");
  void client.destroy();
  process.exit(0);
});
process.on("SIGTERM", () => {
  void client.destroy();
  process.exit(0);
});

// Format crashes readably; the common misconfiguration gets a fix-it hint.
process.on("uncaughtException", (err) => {
  if (/disallowed intents/i.test(String(err.message))) {
    console.error(
      "[bot] Discord rejected our gateway intents. Enable 'Message Content Intent' in the Discord Developer Portal (your application → Bot → Privileged Gateway Intents), then restart.",
    );
  } else {
    console.error("[bot] crashed:", err);
  }
  process.exit(1);
});

void client.login(token);