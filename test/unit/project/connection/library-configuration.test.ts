import { describe, expect, it } from 'vitest';
import { ConfigurationReader } from '../../../../src/index.js';

const read = (library: object) => new ConfigurationReader([]).read({ sourceId: 'expec.json', text: JSON.stringify({
  formatVersion: 1, version: '0.1.0', build: { entries: ['main.expec'] }, libraries: [library],
}) });

describe('explicit library acquisition configuration', () => {
  it('preserves the exact selected source root', () => {
    const result = read({ module: 'books', version: '^1', source: './Library Contracts' });
    expect(result.problems).toEqual([]);
    expect(result.value?.libraries).toEqual([{ module: 'books', version: '^1', source: './Library Contracts' }]);
  });
  it.skipIf(process.platform !== 'win32')('rejects a Windows root-relative library source before resolving it', () => {
    const result = read({ module: 'books', version: '^1', source: '\\libraries\\books' });
    expect(result.value).toBeUndefined();
    expect(result.problems).toContainEqual(expect.objectContaining({ code: 'invalid-setting',
      at: { kind: 'dependency', path: ['manifest', 'expec.json', 'libraries', 0, 'source'] } }));
  });
  it.skipIf(process.platform !== 'win32')('rejects a Windows UNC source without a share', () => {
    expect(read({ module: 'books', version: '^1', source: '\\\\server' }).value).toBeUndefined();
  });
  it('retains an ordinary absolute native source spelling', () => {
    const source = process.platform === 'win32' ? 'C:\\Library Contracts' : '/library-contracts';
    expect(read({ module: 'books', version: '^1', source }).value?.libraries[0]?.source).toBe(source);
  });
  it('leaves a host-supplied library without a fabricated source root', () => {
    expect(read({ module: 'books', version: '^1' }).value?.libraries).toEqual([{ module: 'books', version: '^1' }]);
  });
  it('rejects source discovery patterns at the authored configuration setting', () => {
    const result = read({ module: 'books', version: '^1', source: './libraries/*' });
    expect(result.value).toBeUndefined();
    expect(result.problems).toContainEqual(expect.objectContaining({ code: 'invalid-setting',
      at: { kind: 'dependency', path: ['manifest', 'expec.json', 'libraries', 0, 'source'] } }));
  });
});
