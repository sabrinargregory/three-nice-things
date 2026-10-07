import { Client, Events, GatewayIntentBits, Partials } from "discord.js";
import cron from "node-cron";
import { eq } from "drizzle-orm";
import { db } from "../lib/db";
import { reminderLog } from "../lib/db/schema";
import {
  generateChatReply,
  generateReminder,
  getAllUsers,
  getDiscordId,
  getRecentActivity,
  getUserByDiscordId,
} from "../lib/ai";
import { today } from "../lib/date";

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error("[bot] DISCORD_BOT_TOKEN is required");
  process.exit(1);
}

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

client.once(Events.ClientReady, (c) => {
  console.log(`[bot] logged in as ${c.user.tag}`);

  const timezone = process.env.REMINDER_TZ || undefined;
  cron.schedule("0 19 * * *", () => void reminderSweep(), { timezone });
  console.log(`[bot] reminder cron scheduled at 19:00 ${timezone ?? "(server time)"}`);
});

client.on(Events.MessageCreate, async (message) => {
  try {
    // DMs only, and never respond to other bots or ourselves
    if (message.guildId !== null || message.author.bot) return;
    const content = message.content.trim();
    if (!content) return;

    const appUser = await getUserByDiscordId(message.author.id);
    if (!appUser) return; // signed up via web without Discord link (not possible today, but safe)

    const reply = await generateChatReply(appUser.name, content, appUser.id);
    await message.channel.send(reply);
  } catch (err) {
    console.error("[bot] failed to handle DM:", err);
  }
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

void client.login(token);