import { defineConfig } from "vitest/config";

// Offline recommendation evaluation against gitignored personal fixtures. Not part of `npm test`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/eval/**/*.eval.ts"],
    watch: false,
    testTimeout: 600_000,
  },
});
