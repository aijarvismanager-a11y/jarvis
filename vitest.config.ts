import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "server/**/*.test.ts"],
    // The suite spawns processes, git and browsers; under a parallel run the 5s default makes the slow ones flaky.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    exclude: ["legacy-ai-manager/**", "node_modules/**"],
  },
});
