import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/unit/**/*.test.ts", "test/acceptance/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "test/acceptance/installed-package.test.ts", "test/acceptance/installed-readiness.test.ts", "test/acceptance/shipped-walkthrough.test.ts", "test/acceptance/exporter-author.test.ts", "test/acceptance/public-recipes.test.ts", "test/acceptance/clean-package.test.ts"],
    passWithNoTests: false,
    clearMocks: true,
    restoreMocks: true,
  },
});
