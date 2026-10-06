import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['test/unit/workflow/**/*.test.ts', 'test/acceptance/workflow/**/*.test.ts'], passWithNoTests: false },
});