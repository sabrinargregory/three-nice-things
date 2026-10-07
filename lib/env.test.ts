import { describe, expect, it } from "vitest";
import { envSchemas, parseEnv } from "./env";

const validWeb = {
  DATABASE_PATH: "./data/app.db",
  OPENROUTER_API_KEY: "or-key",
  OPENROUTER_MODEL: "openai/gpt-4o-mini",
  OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
  APP_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "s".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
  DISCORD_CLIENT_ID: "client-id",
  DISCORD_CLIENT_SECRET: "client-secret",
};

describe("parseEnv", () => {
  it("parses a complete web env", () => {
    const env = parseEnv("web app", envSchemas.web, validWeb);
    expect(env.BETTER_AUTH_URL).toBe("http://localhost:3000");
    expect(env.DISCORD_CLIENT_ID).toBe("client-id");
    expect(env.DISCORD_CLIENT_SECRET).toBe("client-secret");
  });

  it("applies defaults for optional values", () => {
    const env = parseEnv("web app", envSchemas.web, {
      OPENROUTER_API_KEY: "or-key",
      BETTER_AUTH_SECRET: "s".repeat(32),
      BETTER_AUTH_URL: "http://localhost:3000",
      DISCORD_CLIENT_ID: "client-id",
      DISCORD_CLIENT_SECRET: "client-secret",
    });
    expect(env.DATABASE_PATH).toBe("./data/app.db");
    expect(env.OPENROUTER_MODEL).toBe("openai/gpt-4o-mini");
    expect(env.OPENROUTER_BASE_URL).toBe("https://openrouter.ai/api/v1");
    expect(env.APP_URL).toBe("http://localhost:3000");
  });

  it("fails with a checklist naming every missing variable", () => {
    expect(() => parseEnv("web app", envSchemas.web, {})).toThrowError(
      /BETTER_AUTH_SECRET: is required[\s\S]*DISCORD_CLIENT_ID: is required[\s\S]*\.env\.example/,
    );
  });

  it("treats empty strings as missing", () => {
    expect(() =>
      parseEnv("web app", envSchemas.web, { ...validWeb, DISCORD_CLIENT_ID: "" }),
    ).toThrowError(/DISCORD_CLIENT_ID: is required/);
  });

  it("rejects malformed URLs", () => {
    expect(() =>
      parseEnv("web app", envSchemas.web, { ...validWeb, BETTER_AUTH_URL: "not-a-url" }),
    ).toThrowError(/BETTER_AUTH_URL: is required and must be a valid URL/);
  });

  it("validates the bot group independently of web-only variables", () => {
    const env = parseEnv("Discord bot", envSchemas.bot, {
      OPENROUTER_API_KEY: "or-key",
      DISCORD_BOT_TOKEN: "bot-token",
    });
    expect(env.DISCORD_BOT_TOKEN).toBe("bot-token");
  });

  it("rejects a bot env without a bot token", () => {
    expect(() =>
      parseEnv("Discord bot", envSchemas.bot, { OPENROUTER_API_KEY: "or-key" }),
    ).toThrowError(/DISCORD_BOT_TOKEN: is required/);
  });
});
