import { defineConfig } from "@playwright/test";

// UI tests drive the built Electron app (`npm run test:ui` builds first) against fixtures only.
export default defineConfig({
  testDir: "test/ui",
  testMatch: "**/*.e2e.ts",
  // Gitignored scratch checks (live probes, audits) never run with the suite.
  testIgnore: "tmp/**",
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  outputDir: "test-results",
});
