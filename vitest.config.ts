import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.{js,ts}"],
    exclude: ["tests/e2e/**", "**/web/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "json-summary"],
      reportsDirectory: "coverage/vitest",
      all: false,
      include: ["goose_rarity.js"],
      extension: [".js"],
    },
  },
});
