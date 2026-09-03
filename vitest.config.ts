import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: "coverage/.vite-cache",
  test: {
    clearMocks: true,
    exclude: ["recipes/**", "node_modules/**", "dist/**"],
    testTimeout: 10_000,
    coverage: {
      reportsDirectory: "coverage/report",
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/cli.ts"],
      thresholds: {
        branches: 80,
        functions: 85,
        lines: 85,
        statements: 85,
      },
    },
  },
});
