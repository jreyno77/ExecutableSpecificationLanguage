import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    environment: 'node',
    include: ['test/unit/**/*.test.ts', 'test/acceptance/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'test/unit/project/python/**', 'test/acceptance/project/python/**', 'test/unit/project/kotlin/**', 'test/acceptance/project/kotlin/**', 'test/unit/workflow/**', 'test/acceptance/workflow/**', 'test/acceptance/package/installed-package*.test.ts', 'test/acceptance/project/java/installed-java-package.test.ts',
      'test/unit/project/java/java-*.test.ts', 'test/acceptance/project/java/java-*.test.ts', 'test/acceptance/cli/project-pilot*.test.ts'],
    passWithNoTests: false,
    clearMocks: true,
    restoreMocks: true,
  },
});
