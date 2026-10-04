import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/acceptance/installed-package.test.ts', 'test/acceptance/installed-readiness.test.ts', 'test/acceptance/shipped-walkthrough.test.ts', 'test/acceptance/exporter-author.test.ts', 'test/acceptance/public-recipes.test.ts'],
    maxWorkers: 1,
    passWithNoTests: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
