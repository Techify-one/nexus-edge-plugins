import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Root plugin folders and the shared SDK are the workspace under test.
    // Nested developer worktrees are independent repositories.
    include: [
      "*/tests/**/*.test.{ts,tsx}",
      "tests/**/*.test.ts",
      ".marketplace/packages/*/test/**/*.test.ts",
    ],
  },
});
