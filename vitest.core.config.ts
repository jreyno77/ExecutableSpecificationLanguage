import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    environment: 'node',
    include: ['test/unit/**/*.test.ts', 'test/acceptance/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'test/acceptance/installed-package*.test.ts', 'test/acceptance/installed-java-package.test.ts', 'test/acceptance/installed-kotlin-package.test.ts',
      'test/unit/kotlin-*.test.ts', 'test/acceptance/kotlin-*.test.ts', 'test/unit/java-*.test.ts', 'test/acceptance/java-*.test.ts', 'test/acceptance/project-pilot*.test.ts'],
    passWithNoTests: false,
    clearMocks: true,
    restoreMocks: true,
  },
});
