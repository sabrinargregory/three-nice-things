// lib/env validates required variables at startup; seed them here so test
// processes never trip the fail-fast checks. Suites override as needed.
// DATABASE_PATH is intentionally NOT seeded here: node.ts points it at a
// fresh temp SQLite file per test run.
process.env.BETTER_AUTH_SECRET ||= "test-secret-0123456789abcdef0123456789";
process.env.BETTER_AUTH_URL ||= "http://localhost:3000";
process.env.APP_URL ||= "http://localhost:3000";
process.env.DISCORD_CLIENT_ID ||= "test-client-id";
process.env.DISCORD_CLIENT_SECRET ||= "test-client-secret";
process.env.DISCORD_BOT_TOKEN ||= "test-bot-token";
process.env.OPENROUTER_API_KEY ||= "test-openrouter-key";
