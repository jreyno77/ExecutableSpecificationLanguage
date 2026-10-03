import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PythonContext, type ProjectContext, type ProjectSnapshot } from '../../src/index.js';

function project(files: Record<string, string> = {}, excluded: string[] = []): ProjectContext {
  const snapshot: ProjectSnapshot = { root: { path: process.cwd(), identity: 'caller' }, complete: true, problems: [], excludeNames: ['.venv', '__pycache__'], excluded,
    files: Object.entries(files).map(([path, text]) => ({ path, bytes: Buffer.from(text), version: createHash('sha256').update(text).digest('hex') })) };
  return { root: snapshot.root, readSnapshot: async () => structuredClone(snapshot) };
}
const config = { format: 1, python: process.execPath, uv: process.execPath, sourceRoots: { main: ['src'], test: ['test'] }, environment: '.venv' };

describe('Python native capture prerequisites', () => {
  it('explains the missing configuration without inventing native availability', async () => {
    const source = project(), before = await source.readSnapshot();
    const result = await new PythonContext(source).readSnapshot();
    expect(result.complete).toBe(false); expect(result.problems.map(problem => problem.code)).toContain('missing-python-config');
    expect(result.nativeInputs).toBeUndefined(); expect(await source.readSnapshot()).toEqual(before);
  });
  it('rejects duplicate authored properties before starting a native tool', async () => {
    const source = project({ 'expec.python.json': '{"format":1,"format":1}' });
    const result = await new PythonContext(source).readSnapshot();
    expect(result.complete).toBe(false); expect(result.problems.map(problem => problem.code)).toContain('duplicate-key');
  });
  it('keeps excluded selected source distinct from an empty project', async () => {
    const source = project({ 'expec.python.json': JSON.stringify(config) }, ['src/__pycache__/models']);
    const result = await new PythonContext(source).readSnapshot();
    expect(result.complete).toBe(false); expect(result.problems.map(problem => problem.code)).toContain('excluded-python-input');
  });
  it('requires an actual successful install report', async () => {
    const result = await new PythonContext(project({ 'expec.python.json': JSON.stringify(config) })).readSnapshot();
    expect(result.complete).toBe(false); expect(result.problems.map(problem => problem.code)).toContain('python-install-required');
  });
  it('rejects an escaping or ambient configuration filename at the caller boundary', () => {
    expect(() => new PythonContext(project(), { configFile: '../expec.python.json' })).toThrow(TypeError);
    expect(() => new PythonContext(project(), { configFile: 'C:expec.python.json' })).toThrow(TypeError);
  });
});
