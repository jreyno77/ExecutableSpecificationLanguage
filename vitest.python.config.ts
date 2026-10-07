import { configDefaults, defineConfig } from 'vitest/config';

const group = process.env.EXPEC_PYTHON_CLI_GROUP;
if (group !== undefined && group !== 'selected' && group !== 'remaining')
  throw Error('EXPEC_PYTHON_CLI_GROUP must be selected or remaining.');
const selectedCases = 'builds and executes|reuses a project|reports the real|executes changed';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    environment: 'node',
    ...(group === undefined ? {} : { testNamePattern: new RegExp(group === 'selected'
      ? selectedCases : '^(?![\\s\\S]*(?:' + selectedCases + '))') }),
    include: ['test/{unit,acceptance}/project/python/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'test/acceptance/project/python/shipped-python-walkthrough.test.ts'],
    passWithNoTests: false, clearMocks: true, restoreMocks: true, maxWorkers: 1,
  },
});
