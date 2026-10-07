import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/acceptance/package/installed-package*.test.ts', 'test/acceptance/package/installed-readiness.test.ts', 'test/acceptance/package/shipped-walkthrough.test.ts',
      'test/acceptance/package/exporter-author.test.ts', 'test/acceptance/package/public-recipes.test.ts'],
    passWithNoTests: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
    maxWorkers: 1,
  },
});
