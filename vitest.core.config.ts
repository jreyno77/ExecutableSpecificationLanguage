import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    environment: 'node',
    include: ['test/unit/**/*.test.ts', 'test/acceptance/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'test/unit/project/kotlin/**', 'test/acceptance/project/kotlin/**', 'test/unit/workflow/**', 'test/acceptance/workflow/**', 'test/acceptance/package/installed-package*.test.ts', 'test/acceptance/project/java/installed-java-package.test.ts',
      'test/unit/project/java/java-*.test.ts', 'test/acceptance/project/java/java-*.test.ts', 'test/acceptance/cli/project-pilot*.test.ts',
      'test/unit/python-*.test.ts', 'test/acceptance/python-*.test.ts',
      'test/acceptance/package/installed-readiness.test.ts', 'test/acceptance/package/shipped-walkthrough.test.ts', 'test/acceptance/package/exporter-author.test.ts', 'test/acceptance/package/public-recipes.test.ts',
      'test/acceptance/package/clean-package.test.ts', 'test/acceptance/project/*/shipped-*-walkthrough.test.ts'],
    passWithNoTests: false,
    clearMocks: true,
    restoreMocks: true,
  },
});
