import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    environment: "node",
    include: ["test/unit/**/*.test.ts", "test/acceptance/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "test/acceptance/project/kotlin/installed-kotlin-package.test.ts", "test/acceptance/package/installed-package*.test.ts", "test/acceptance/project/java/installed-java-package.test.ts", "test/acceptance/cli/project-pilot*.test.ts"],
    passWithNoTests: false,
    clearMocks: true,
    restoreMocks: true,
  },
});
