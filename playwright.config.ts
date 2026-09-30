import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 240_000,
  expect: { timeout: 60_000 },
  workers: 1,
  use: { baseURL: "http://localhost:3000", channel: "chrome", trace: "retain-on-failure" },
  webServer: { command: "bun run dev", url: "http://localhost:3000/api/health", reuseExistingServer: true, timeout: 180_000 },
});
