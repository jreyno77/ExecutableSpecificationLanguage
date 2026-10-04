import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/acceptance/project-pilot.test.ts'],
    passWithNoTests: false,
    maxWorkers: 1,
  },
});
