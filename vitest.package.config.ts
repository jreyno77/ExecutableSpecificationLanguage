import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/acceptance/installed-package*.test.ts'],
    passWithNoTests: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
    maxWorkers: 1,
  },
});
