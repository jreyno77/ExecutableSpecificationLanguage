import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    environment: 'node',
    include: ['test/unit/project/java/java-*.test.ts', 'test/acceptance/project/java/java-*.test.ts'],
    passWithNoTests: false,
    clearMocks: true,
    restoreMocks: true,
    maxWorkers: 2,
  },
});
