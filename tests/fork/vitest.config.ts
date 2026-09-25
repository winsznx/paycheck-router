import { defineConfig } from "vitest/config";

/** Each suite starts its own surfnet, deploys the program and funds keys: minutes, one at a time. */
export default defineConfig({
  test: {
    include: ["suites/**/*.test.ts"],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 600_000,
    hookTimeout: 900_000,
  },
});
