import { describe, expect, it } from 'vitest';
import { ConfigurationReader, type Configuration } from '../../src/index.js';
import { pythonStarter } from '../../src/python-initialization.js';

function configuration(packages: Configuration['packages'] = []): Configuration {
  const read = new ConfigurationReader([]).read({ sourceId: 'settings', text: JSON.stringify({
    formatVersion: 1, version: '0.1.0', build: { entries: ['store.expec'] }, packages,
  }) });
  if (!read.value) throw Error(JSON.stringify(read));
  return read.value;
}
function proposed(input: Configuration) {
  const python = process.env.EXPEC_TEST_PYTHON, uv = process.env.EXPEC_TEST_UV;
  if (!python || !uv) throw Error('Provide explicitly provisioned Python3.12 and uv0.12.23 executables.');
  return pythonStarter(input, '../store', python, uv);
}
async function rejects(packages: Configuration['packages']) {
  const result = await pythonStarter(configuration(packages), '../store', '', '');
  expect(result.value).toBeUndefined();
  expect(result.problems.map(problem => problem.code)).toContain('unsupported-initialization-toolchain');
  expect(result.problems.map(problem => problem.code)).not.toContain('native-toolchain-unavailable');
}

describe('Python starter requirements preserve the caller\'s native choices', () => {
  it('keeps a two-component exact release and its authored alias', async () => {
    const existing = { alias: 'syntax', name: 'pypi:libcst', version: '1.9', phases: ['build', 'runtime'] as const };
    const result = await proposed(configuration([existing]));
    expect(result.problems).toEqual([]); expect(result.value).toBeDefined();
    expect(result.value!.configuration.packages).toEqual([existing,
      { alias: 'jedi', name: 'pypi:jedi', version: '0.20.0', phases: ['build'] },
      { alias: 'mypy', name: 'pypi:mypy', version: '2.4.0', phases: ['build'] },
      { alias: 'pytest', name: 'pypi:pytest', version: '9.1.1', phases: ['test'] },
    ]);
  });
  it('keeps an agreeing three-component exact requirement without a duplicate', async () => {
    const existing = { alias: 'syntax', name: 'pypi:libcst', version: '1.9.0', phases: ['build'] as const };
    const result = await proposed(configuration([existing]));
    expect(result.problems).toEqual([]);
    expect(result.value!.configuration.packages.filter(item => item.name === 'pypi:libcst')).toEqual([existing]);
  });
  it('rejects a different patch release before asking the tools to run', async () => {
    await rejects([{ alias: 'syntax', name: 'pypi:libcst', version: '1.9.1', phases: ['build'] }]);
  });
  it('rejects a range instead of reinterpreting it as an exact native release', async () => {
    await rejects([{ alias: 'syntax', name: 'pypi:libcst', version: '^1.9.0', phases: ['build'] }]);
  });
  it('does not silently add build visibility to a runtime-only request', async () => {
    await rejects([{ alias: 'syntax', name: 'pypi:libcst', version: '1.9.0', phases: ['runtime'] }]);
  });
  it('does not take an alias already assigned to another package', async () => {
    await rejects([{ alias: 'libcst', name: 'pypi:packaging', version: '26.0', phases: ['runtime'] }]);
  });
  it('returns independent proposed configuration without changing the caller', async () => {
    const input = configuration([{ alias: 'format', name: 'pypi:packaging', version: '26.0', phases: ['runtime'] }]);
    const before = structuredClone(input), result = await proposed(input);
    expect(result.problems).toEqual([]); expect(input).toEqual(before);
    expect(result.value!.configuration.packages[0]).toEqual(before.packages[0]);
    Object.assign(result.value!.configuration.packages[0]!, { alias: 'changed' });
    Object.assign(result.value!.configuration.outputs[0]!.options, { module: 'changed.contracts' });
    expect(input).toEqual(before);
    expect(result.value!.configuration.project).toEqual({ root: '../store' });
  });
});
