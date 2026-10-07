import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { loadEnv, type WebEnv } from "@/lib/env";

const env = loadEnv("web");

export function buildAuthOptions(e: WebEnv = env) {
  return {
    secret: e.BETTER_AUTH_SECRET,
    baseURL: e.BETTER_AUTH_URL,
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: { enabled: false }, // Discord-only
    socialProviders: {
      discord: {
        clientId: e.DISCORD_CLIENT_ID,
        clientSecret: e.DISCORD_CLIENT_SECRET,
        scope: ["identify", "email"],
      },
    },
  };
}

export const auth = betterAuth(buildAuthOptions());
