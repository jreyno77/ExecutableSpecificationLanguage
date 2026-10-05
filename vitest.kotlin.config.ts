import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    environment: 'node',
    include: ['test/unit/kotlin-*.test.ts', 'test/acceptance/kotlin-*.test.ts'],
    passWithNoTests: false, clearMocks: true, restoreMocks: true, maxWorkers: 1,
  },
});
