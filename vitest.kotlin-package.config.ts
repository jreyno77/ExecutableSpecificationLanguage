import { defineConfig } from 'vitest/config';
export default defineConfig({ test: {
  environment: 'node', include: ['test/acceptance/project/kotlin/installed-kotlin-package.test.ts'],
  hookTimeout: 180_000, testTimeout: 600_000, passWithNoTests: false, maxWorkers: 1,
} });
