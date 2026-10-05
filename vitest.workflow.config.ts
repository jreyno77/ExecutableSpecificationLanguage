import { defineConfig } from 'vitest/config';
export default defineConfig({ test: {
  environment: 'node',
  include: ['test/unit/ci-*.test.ts', 'test/unit/release-package.test.ts', 'test/unit/main-ci-history.test.ts'],
} });
