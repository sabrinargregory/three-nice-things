import { describe, expect, it } from "vitest";
import { buildAuthOptions } from "./auth";
import { envSchemas } from "./env";

const webEnv = envSchemas.web.parse({
  OPENROUTER_API_KEY: "or-key",
  BETTER_AUTH_SECRET: "s".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
  DISCORD_CLIENT_ID: "client-id",
  DISCORD_CLIENT_SECRET: "client-secret",
});

describe("buildAuthOptions", () => {
  it("derives the better-auth base URL from BETTER_AUTH_URL", () => {
    const options = buildAuthOptions(webEnv);
    expect(options.baseURL).toBe("http://localhost:3000");
    expect(options.secret).toBe(webEnv.BETTER_AUTH_SECRET);
  });

  it("configures the Discord social provider", () => {
    const options = buildAuthOptions(webEnv);
    expect(options.socialProviders.discord).toMatchObject({
      clientId: "client-id",
      clientSecret: "client-secret",
      scope: ["identify", "email"],
    });
  });

  it("keeps email/password disabled (Discord-only)", () => {
    expect(buildAuthOptions(webEnv).emailAndPassword).toEqual({ enabled: false });
  });
});
