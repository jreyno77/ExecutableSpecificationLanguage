import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/unit/**/*.test.ts", "test/acceptance/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "test/acceptance/installed-package.test.ts", "test/acceptance/installed-kotlin-package.test.ts"],
    passWithNoTests: false,
    clearMocks: true,
    restoreMocks: true,
  },
});
