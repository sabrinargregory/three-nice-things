import { z } from "zod";

/**
 * Fail-fast environment validation.
 *
 * Each process validates only the group it needs, on first use: a missing or
 * malformed variable crashes startup with a readable checklist instead of
 * surfacing as a runtime warning or silently passing `undefined` along.
 * See .env.example for the documented setup.
 */

function required(hint?: string) {
  const message = `is required${hint ? ` — ${hint}` : ""}`;
  return z.string({ error: message }).min(1, { message });
}

function optionalStr(fallback: string) {
  return z.string().min(1).default(fallback);
}

function optionalUrl(fallback: string) {
  return z.url({ error: "must be a valid URL" }).default(fallback);
}

const databaseShape = {
  /** SQLite file shared by the web app and the bot. */
  DATABASE_PATH: optionalStr("./data/app.db"),
};

const aiShape = {
  OPENROUTER_API_KEY: required("create one at https://openrouter.ai/keys"),
  OPENROUTER_MODEL: optionalStr("openai/gpt-4o-mini"),
  OPENROUTER_BASE_URL: optionalUrl("https://openrouter.ai/api/v1"),
  /** Public origin of the web app, sent as HTTP-Referer to OpenRouter. */
  APP_URL: optionalUrl("http://localhost:3000"),
};

const webShape = {
  ...databaseShape,
  ...aiShape,
  BETTER_AUTH_SECRET: required("generate with: openssl rand -base64 32"),
  BETTER_AUTH_URL: z.url({
    error: "is required and must be a valid URL (public origin of the web app, e.g. http://localhost:3000)",
  }),
  DISCORD_CLIENT_ID: required("Discord application → OAuth2 → Client ID"),
  DISCORD_CLIENT_SECRET: required("Discord application → OAuth2 → Client Secret"),
};

const botShape = {
  ...databaseShape,
  ...aiShape,
  DISCORD_BOT_TOKEN: required("Discord application → Bot → Reset Token"),
};

/** Formats a zod failure into a readable env checklist error message. */
function envErrorMessage(
  label: string,
  error: { issues: { path: PropertyKey[]; message: string }[] },
): string {
  const details = error.issues
    .map((issue) => `  ${issue.path.join("")}: ${issue.message}`)
    .join("\n");
  return `Invalid environment for the ${label}:\n${details}\nCopy .env.example to .env, fill in the values, and restart.`;
}

/** Parses `source` against `schema`, throwing a readable checklist on failure. */
export function parseEnv<S extends z.ZodRawShape>(
  label: string,
  schema: z.ZodObject<S>,
  source: Record<string, string | undefined>,
): z.output<z.ZodObject<S>> {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new Error(envErrorMessage(label, result.error));
  }
  return result.data;
}

export const envSchemas = {
  database: z.object(databaseShape),
  ai: z.object(aiShape),
  web: z.object(webShape),
  bot: z.object(botShape),
} as const;

export type DatabaseEnv = z.output<(typeof envSchemas)["database"]>;
export type AiEnv = z.output<(typeof envSchemas)["ai"]>;
export type WebEnv = z.output<(typeof envSchemas)["web"]>;
export type BotEnv = z.output<(typeof envSchemas)["bot"]>;

const groupLabels: Record<keyof typeof envSchemas, string> = {
  database: "database config",
  ai: "AI (OpenRouter) config",
  web: "web app",
  bot: "Discord bot",
};

const cache = new Map<keyof typeof envSchemas, unknown>();

/**
 * Validates one env group and caches it for the process lifetime. Call at
 * module load of the consumer so misconfiguration fails at startup.
 */
export function loadEnv<K extends keyof typeof envSchemas>(
  group: K,
): z.output<(typeof envSchemas)[K]> {
  if (!cache.has(group)) {
    const result = envSchemas[group].safeParse(process.env);
    if (!result.success) {
      throw new Error(envErrorMessage(groupLabels[group], result.error));
    }
    cache.set(group, result.data);
  }
  return cache.get(group) as z.output<(typeof envSchemas)[K]>;
}
