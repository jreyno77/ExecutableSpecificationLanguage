import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/acceptance/installed-java-package.test.ts'],
    passWithNoTests: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
