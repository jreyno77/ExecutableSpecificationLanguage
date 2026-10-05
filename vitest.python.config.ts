import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    environment: 'node',
    include: ['test/{unit,acceptance}/python-*.test.ts'],
    passWithNoTests: false, clearMocks: true, restoreMocks: true, maxWorkers: 1,
  },
});
