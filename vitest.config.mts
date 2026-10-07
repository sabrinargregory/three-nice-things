import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

const root = path.dirname(new URL(import.meta.url).pathname);

export default defineConfig({
  resolve: {
    alias: { "@": root },
  },
  test: {
    coverage: {
      provider: "v8",
      include: ["app/**", "bot/**", "components/**", "lib/**", "middleware.ts"],
      exclude: [
        "**/*.test.*",
        "**/*.d.ts",
        "app/api/auth/**",
        "app/layout.tsx",
        "app/providers.tsx",
        "lib/db/schema.ts",
        "lib/auth.ts",
        "lib/auth-client.ts",
        "components/ui/**",
      ],
      excludeAfterRemap: true,
    },
    projects: [
      {
        plugins: [tsconfigPaths()],
        resolve: { alias: { "@": root } },
        test: {
          name: "node",
          environment: "node",
          setupFiles: ["./tests/setup/node.ts"],
          include: [
            "lib/**/*.test.{ts,tsx}",
            "bot/**/*.test.{ts,tsx}",
            "app/api/**/*.test.{ts,tsx}",
            "middleware.test.ts",
          ],
        },
      },
      {
        plugins: [tsconfigPaths(), react()],
        resolve: { alias: { "@": root } },
        test: {
          name: "jsdom",
          environment: "jsdom",
          globals: true,
          setupFiles: ["./tests/setup/dom.ts"],
          include: ["components/**/*.test.{ts,tsx}", "app/**/*.test.tsx"],
        },
      },
    ],
  },
});
