import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JavaProject, type ProjectSnapshot } from '../../../../src/index.js';

const empty: ProjectSnapshot = { root: { path: join(tmpdir(), 'uncaptured-java'), identity: 'fixture' }, complete: true, files: [], problems: [], excludeNames: [], excluded: [] };
const file = (path: string) => ({ path, bytes: Buffer.from('class Store {}'), version: 'a'.repeat(64) });
describe('Java query caller boundaries', () => {
  it('rejects a captured source path that escapes the supplied project', async () => {
    await expect(new JavaProject({ outputId: 'java' }, []).read('store', { ...empty, files: [file('../Escape.java')] })).rejects.toThrow(TypeError);
  });
  it('rejects duplicate captured paths before inspecting native inputs', async () => {
    await expect(new JavaProject({ outputId: 'java' }, []).read('store', { ...empty, files: [file('Store.java'), file('Store.java')] })).rejects.toThrow(TypeError);
  });
  it('rejects native evidence that is not a canonical absolute file URI', async () => {
    await expect(new JavaProject({ outputId: 'java' }, []).search('store', { ...empty, nativeInputs: [{ uri: '../catalog.jar', version: 'b'.repeat(64) }] })).rejects.toThrow(TypeError);
  });
  it('requires a callable owner for an exact parameter selector', () => {
    expect(() => new JavaProject({ outputId: 'java' }, [{ specId: 'title', locator: { outputId: 'java', format: 'java-symbol-1',
      value: { file: 'Store.java', type: 'Store', parameter: 0 } } }])).toThrow(TypeError);
  });
  it('reports an unsupported association format without treating it as a native definition', async () => {
    const result = await new JavaProject({ outputId: 'java' }, [{ specId: 'store', locator: { outputId: 'java', format: 'future-java-9', value: {} } }]).search('store', empty);
    expect(result.problems.map(problem => problem.code)).toContain('unsupported-project-locator');
    expect(result.definitions).toEqual([]);
  });
});
