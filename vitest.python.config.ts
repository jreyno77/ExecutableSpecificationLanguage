import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    environment: 'node',
    include: ['test/{unit,acceptance}/project/python/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'test/acceptance/project/python/shipped-python-walkthrough.test.ts'],
    passWithNoTests: false, clearMocks: true, restoreMocks: true, maxWorkers: 1,
  },
});
