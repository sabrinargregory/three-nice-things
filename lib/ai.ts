import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { and, eq, gte, inArray } from "drizzle-orm";
import { db } from "./db";
import { account, chatMessage, entry, user } from "./db/schema";
import { getOrCreateSession, getSessionHistory } from "./chat-session";
import { daysAgo, today } from "./date";
import { loadEnv } from "./env";

const { OPENROUTER_API_KEY, OPENROUTER_MODEL, OPENROUTER_BASE_URL, APP_URL } = loadEnv("ai");

const openai = createOpenAI({
  baseURL: OPENROUTER_BASE_URL,
  apiKey: OPENROUTER_API_KEY,
  headers: {
    "HTTP-Referer": APP_URL,
    "X-Title": "3 Nice Things",
  },
});

function getModel() {
  return openai(OPENROUTER_MODEL);
}

/**
 * Calls the model, retrying once when the response carries no text. Reasoning
 * models can spend the entire output budget thinking and answer with an empty
 * message, which Discord then rejects (50006) — so guard here and log the
 * telltales (finishReason + reasoning length + usage) for diagnosis.
 */
async function generateTextWithRetry(args: Parameters<typeof generateText>[0]): Promise<string> {
  const attempt = async (): Promise<string | null> => {
    const result = await generateText(args);
    const text = result.text.trim();
    if (text) return text;
    console.error(
      "[ai] empty model response:",
      JSON.stringify({
        finishReason: result.finishReason,
        reasoningLength: result.finalStep.reasoningText?.length ?? 0,
        usage: result.usage,
      }),
    );
    return null;
  };

  const text = (await attempt()) ?? (await attempt());
  if (text === null) throw new Error("model returned an empty response twice");
  return text;
}

// ---- context builders ----

export type ActivityDay = { date: string; items: string[] };

/** Last `days` days of entries for a user, oldest first, including today. */
export async function getRecentActivity(userId: string, days = 7): Promise<ActivityDay[]> {
  const rows = await db
    .select({ entryDate: entry.entryDate, content: entry.content })
    .from(entry)
    .where(and(eq(entry.userId, userId), gte(entry.entryDate, daysAgo(days - 1))))
    .orderBy(entry.entryDate, entry.createdAt);

  const byDate = new Map<string, string[]>();
  for (const row of rows) {
    const list = byDate.get(row.entryDate) ?? [];
    list.push(row.content);
    byDate.set(row.entryDate, list);
  }

  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) dates.push(daysAgo(i));

  return dates.map((date) => ({ date, items: byDate.get(date) ?? [] }));
}

export async function getDiscordId(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ accountId: account.accountId })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "discord")))
    .limit(1);
  return row?.accountId ?? null;
}

/** All app users (bot sweeps over these). */
export async function getAllUsers() {
  return db.select({ id: user.id, name: user.name }).from(user);
}

/** Find an app user by their linked Discord account id. */
export async function getUserByDiscordId(discordId: string) {
  const [row] = await db
    .select({ id: user.id, name: user.name })
    .from(account)
    .innerJoin(user, eq(account.userId, user.id))
    .where(and(eq(account.providerId, "discord"), eq(account.accountId, discordId)))
    .limit(1);
  return row ?? null;
}

/** Compact multi-day rendering of entries, shared by prompts and slash commands. */
export function formatActivity(activity: ActivityDay[]): string {
  if (activity.every((day) => day.items.length === 0)) {
    return "(no entries logged in the last 7 days)";
  }
  return activity
    .map((day) => {
      if (day.items.length === 0) return `${day.date}: nothing logged`;
      return `${day.date}:\n${day.items.map((i) => `- ${i}`).join("\n")}`;
    })
    .join("\n");
}

// ---- reminder generation ----

const REMINDER_SYSTEM = `You are the accountability buddy for "3 Nice Things", an app where a person logs three nice things they did for themselves each day. Small things count: taking out the trash, going for a walk, cooking a real meal.

It is now 7:00 PM and the user hasn't finished today's three yet. Write ONE short reminder DM.

Rules:
- Warm, playful, lightly teasing. Never guilt-trippy or passive-aggressive.
- Make it personal: reference specific things from their recent entries (what they logged before, patterns, favorites). Never invent things they didn't log.
- If they logged 1-2 today, acknowledge those specifically and nudge for the rest.
- If today is completely empty but they have history, gently point that out.
- If they have no history at all, be welcoming and explain the idea in a sentence.
- Under 80 words. Plain text, no markdown lists, no emojis unless they clearly fit.
- End with a light nudge toward the web app to finish logging.`;

export async function generateReminder(userName: string, activity: ActivityDay[]): Promise<string> {
  const todaysCount = activity[activity.length - 1]?.items.length ?? 0;

  return generateTextWithRetry({
    model: getModel(),
    system: REMINDER_SYSTEM,
    prompt: `User: ${userName}
Today is ${today()}. They have logged ${todaysCount} of 3 nice things today.

Their last 7 days of entries:
${formatActivity(activity)}`,
    // Room for reasoning tokens, which OpenRouter counts against this budget.
    maxOutputTokens: 600,
  });
}

// ---- two-way chat ----

const CHAT_SYSTEM = `You are the accountability buddy for "3 Nice Things", an app where a person logs three nice things they did for themselves each day. Small things count: taking out the trash, going for a walk, cooking a real meal.

The user is replying to you in Discord DMs. Be conversational and brief:
- Help them reflect on their day and come up with nice things they actually did.
- When they're out of ideas, suggest small things based on what they've logged and enjoyed before. Never invent past entries.
- Celebrate streaks and completed days when relevant.
- Under 120 words. Plain text, casual tone. You can be playful but don't nag — this is a conversation, not a reminder.`;

export async function generateChatReply(
  userName: string,
  userMessage: string,
  userId: string,
): Promise<string> {
  // Resolves or rolls over the session (touching lastActiveAt) before the model call.
  const session = await getOrCreateSession(userId);
  const [activity, history] = await Promise.all([
    getRecentActivity(userId),
    getSessionHistory(session.id),
  ]);

  const context = `User: ${userName}
Today is ${today()}.

Their last 7 days of entries:
${formatActivity(activity)}`;

  const reply = await generateTextWithRetry({
    model: getModel(),
    system: `${CHAT_SYSTEM}\n\n${context}`,
    messages: [
      ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      { role: "user", content: userMessage },
    ],
    // Room for reasoning tokens, which OpenRouter counts against this budget.
    maxOutputTokens: 1000,
  });

  // Persisted only once a non-empty reply exists, so a failed turn can't leave
  // an empty assistant message behind to pollute the next prompt's history.
  await db.insert(chatMessage).values([
    { userId, sessionId: session.id, role: "user", content: userMessage },
    { userId, sessionId: session.id, role: "assistant", content: reply },
  ]);

  return reply;
}

/** Ids of users who have any entries on the given dates (helper for sweeps). */
export async function getUserIdsWithEntriesOnDates(dates: string[]) {
  const rows = await db
    .selectDistinct({ userId: entry.userId })
    .from(entry)
    .where(inArray(entry.entryDate, dates));
  return rows.map((r) => r.userId);
}