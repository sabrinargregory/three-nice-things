import type { ChatInputCommandInteraction, Client } from "discord.js";
import {
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { and, eq } from "drizzle-orm";
import { db } from "../lib/db";
import { reminderLog } from "../lib/db/schema";
import {
  countSessionMessages,
  findActiveSession,
  resetSession,
} from "../lib/chat-session";
import {
  formatActivity,
  generateReminder,
  getRecentActivity,
  getUserByDiscordId,
} from "../lib/ai";
import { today } from "../lib/date";
import { loadEnv } from "../lib/env";

const { APP_URL, OPENROUTER_MODEL, CHAT_HISTORY_MAX_MESSAGES, CHAT_SESSION_TTL_MINUTES } =
  loadEnv("ai");

export type AppCommand = {
  data: SlashCommandBuilder;
  execute: (interaction: ChatInputCommandInteraction, client: Client) => Promise<void>;
};

function reply(interaction: ChatInputCommandInteraction, content: string) {
  return interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

function reminderTimeLabel(): string {
  return `7:00 PM ${process.env.REMINDER_TZ || "(server time)"}`;
}

/**
 * Resolves the web-app user behind a Discord user, replying with a
 * self-service fix hint when the accounts aren't linked yet.
 */
async function requireAppUser(interaction: ChatInputCommandInteraction) {
  const appUser = await getUserByDiscordId(interaction.user.id);
  if (!appUser) {
    await reply(
      interaction,
      `Your Discord account isn't linked to the web app yet. Log in at ${APP_URL} with Discord, then try again.`,
    );
    return null;
  }
  return appUser;
}

const whoami: AppCommand = {
  data: new SlashCommandBuilder()
    .setName("whoami")
    .setDescription("What the bot can see and do with your account")
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM),
  async execute(interaction) {
    const appUser = await requireAppUser(interaction);
    if (!appUser) return;
    await reply(
      interaction,
      [
        `**What I have access to**`,
        `Linked to **${appUser.name}** on the web app (${APP_URL}).`,
        "",
        "**What I read**",
        "- Your entries from the last 7 days",
        "- The messages of your active DM chat with me",
        "",
        "**What I do with it**",
        `- DM you one reminder per day at ${reminderTimeLabel()} if you haven't logged 3 things yet`,
        `- Reply to your DMs, with your last 7 days as context (model: \`${OPENROUTER_MODEL}\`)`,
        "",
        "**What I never do**",
        "- Read or reply to messages in servers (DMs only)",
        `- Keep chat history longer than one session: ${CHAT_SESSION_TTL_MINUTES} min of quiet and it's wiped`,
        "",
        "Use /reset to wipe the current chat session right now.",
      ].join("\n"),
    );
  },
};

const todayCmd: AppCommand = {
  data: new SlashCommandBuilder()
    .setName("today")
    .setDescription("Show today's logged nice things and progress toward 3")
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM),
  async execute(interaction) {
    const appUser = await requireAppUser(interaction);
    if (!appUser) return;
    const activity = await getRecentActivity(appUser.id, 1);
    const day = activity[0];
    const body =
      day.items.length === 0
        ? "Nothing logged yet — there's still time."
        : day.items.map((item) => `- ${item}`).join("\n");
    await reply(interaction, `**Today (${day.date}) — ${day.items.length}/3**\n${body}`);
  },
};

const history: AppCommand = {
  data: new SlashCommandBuilder()
    .setName("history")
    .setDescription("Show your last 7 days of entries")
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM),
  async execute(interaction) {
    const appUser = await requireAppUser(interaction);
    if (!appUser) return;
    const activity = await getRecentActivity(appUser.id);
    await reply(interaction, `**Last 7 days**\n${formatActivity(activity)}`);
  },
};

const reminder: AppCommand = {
  data: new SlashCommandBuilder()
    .setName("reminder")
    .setDescription("Your reminder status for today")
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM),
  async execute(interaction) {
    const appUser = await requireAppUser(interaction);
    if (!appUser) return;
    const [sent] = await db
      .select()
      .from(reminderLog)
      .where(and(eq(reminderLog.userId, appUser.id), eq(reminderLog.entryDate, today())));
    const status = sent
      ? `Already sent today at ${sent.sentAt.toLocaleTimeString()}.`
      : "Not sent today.";
    await reply(
      interaction,
      [
        `**Daily reminder — ${reminderTimeLabel()}**`,
        status,
        "",
        "You only get one if you haven't logged 3 things by then, and never more than once per day.",
        "Use /test-reminder to preview one anytime (it doesn't count toward today's).",
      ].join("\n"),
    );
  },
};

const session: AppCommand = {
  data: new SlashCommandBuilder()
    .setName("session")
    .setDescription("Info about your current AI chat session")
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM),
  async execute(interaction) {
    const appUser = await requireAppUser(interaction);
    if (!appUser) return;
    const active = await findActiveSession(appUser.id);
    if (!active) {
      await reply(interaction, "No active chat session — DM me and I'll start one.");
      return;
    }
    const messages = await countSessionMessages(active.id);
    await reply(
      interaction,
      [
        "**Current chat session**",
        `Started ${active.startedAt.toLocaleString()} · ${messages} message(s)`,
        `The model sees your last ${CHAT_HISTORY_MAX_MESSAGES} messages, plus your last 7 days of entries.`,
        `Expires after ${CHAT_SESSION_TTL_MINUTES} min of quiet — a fresh session (with no memory of this one) starts on your next DM.`,
        "",
        "Use /reset to wipe it now.",
      ].join("\n"),
    );
  },
};

const reset: AppCommand = {
  data: new SlashCommandBuilder()
    .setName("reset")
    .setDescription("Wipe the current AI chat session and start fresh")
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM),
  async execute(interaction) {
    const appUser = await requireAppUser(interaction);
    if (!appUser) return;
    const deleted = await resetSession(appUser.id);
    await reply(
      interaction,
      deleted === 0
        ? "Nothing to reset — there's no chat history on file."
        : `Forgot ${deleted} message(s). Our next DM starts a brand-new session.`,
    );
  },
};

const testReminder: AppCommand = {
  data: new SlashCommandBuilder()
    .setName("test-reminder")
    .setDescription("Preview a reminder DM right now (doesn't count as today's real one)")
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM),
  async execute(interaction, client) {
    const appUser = await requireAppUser(interaction);
    if (!appUser) return;
    // AI generation can take a while; defer so Discord doesn't time out the interaction.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const activity = await getRecentActivity(appUser.id);
    const message = await generateReminder(appUser.name, activity);
    const discordUser = await client.users.fetch(interaction.user.id);
    await discordUser.send(message);
    await interaction.editReply(
      "Preview sent to your DMs! This does NOT count as today's reminder — you'll still get the real one at " +
        reminderTimeLabel() +
        " if you're under 3.",
    );
  },
};

export const commands: AppCommand[] = [
  whoami,
  todayCmd,
  history,
  reminder,
  session,
  reset,
  testReminder,
];