import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/unit/**/*.test.ts", "test/acceptance/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "test/acceptance/installed-package.test.ts", "test/acceptance/project-pilot.test.ts"],
    passWithNoTests: false,
    clearMocks: true,
    restoreMocks: true,
  },
});
