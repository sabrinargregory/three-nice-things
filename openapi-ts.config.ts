import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: { path: "./public/openapi.json" },
  output: "api-client",
  plugins: ["@hey-api/client-fetch", "@tanstack/react-query"],
});
