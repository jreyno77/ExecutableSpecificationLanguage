import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/unit/**/*.test.ts", "test/acceptance/**/*.test.ts"],
    passWithNoTests: false,
    clearMocks: true,
    restoreMocks: true,
  },
});
