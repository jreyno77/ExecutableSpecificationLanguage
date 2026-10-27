import { describe, expect, it } from 'vitest';
import { ConfigurationReader } from '../../../../src/project/connection/configuration.js';
import { pythonStarter } from '../../../../src/project/python/python-initialization.js';

describe('capture policy in a Python starter', () => {
  it('preserves configured artifact boundaries when choosing a new Python project root', async () => {
    const read = new ConfigurationReader([]).read({ sourceId: 'settings', text: JSON.stringify({ formatVersion: 1, version: '0.1.0',
      project: { root: 'old', excludePaths: ['dist', 'generation/tooling'] }, build: { entries: ['book.expec'] } }) });
    if (!read.value) throw Error(JSON.stringify(read.problems));
    const before = structuredClone(read.value), python = process.env.EXPEC_TEST_PYTHON, uv = process.env.EXPEC_TEST_UV;
    if (!python || !uv) throw Error('Provide the existing Python test job CPython3.12 and uv0.12.23.');
    const prepared = await pythonStarter(read.value, 'application', python, uv);
    expect(prepared.problems).toEqual([]);
    expect(prepared.value?.configuration.project).toEqual({ root: 'application', excludePaths: ['dist', 'generation/tooling'] });
    expect(read.value).toEqual(before);
  });
});
