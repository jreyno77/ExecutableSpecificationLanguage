import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { PythonContext, type ProjectContext, type ProjectSnapshot } from '../../../../src/index.js';

function project(files: Record<string, string> = {}, excluded: string[] = []): ProjectContext {
  const snapshot: ProjectSnapshot = { root: { path: process.cwd(), identity: 'caller' }, complete: true, problems: [], excludeNames: ['.venv', '__pycache__'], excluded,
    files: Object.entries(files).map(([path, text]) => ({ path, bytes: Buffer.from(text), version: createHash('sha256').update(text).digest('hex') })) };
  return { root: snapshot.root, readSnapshot: async () => structuredClone(snapshot) };
}
const config = { format: 1, python: process.execPath, uv: process.execPath, sourceRoots: { main: ['src'], test: ['test'] }, environment: '.venv' };
const roots: string[] = [], digest = (text: string): string => createHash('sha256').update(text).digest('hex');
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function nativeProject() {
  const root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'expec-python-context-')); roots.push(root);
  const sites = join(root, '.venv', 'sites'), standard = join(root, 'stdlib');
  await fs.mkdir(sites, { recursive: true }); await fs.mkdir(standard);
  for (const name of ['python', 'uv']) await fs.writeFile(join(root, name), name);
  const profile = JSON.stringify({ ...config, python: join(root, 'python'), uv: join(root, 'uv') });
  const report = { format: 1, config: digest(profile), pyproject: digest('project'), lock: digest('lock'),
    python: { path: join(root, 'python'), version: '3.12.14', stdlib: [standard], binaries: [] },
    uv: { path: join(root, 'uv'), version: '0.12.23' }, environment: { path: join(root, '.venv'), sites: [sites] },
    tools: { libcst: '1.9.0', jedi: '0.20.0', mypy: '2.4.0', pytest: '9.1.1' }, packages: [] };
  const supplied = project({ 'expec.python.json': profile, 'pyproject.toml': 'project', 'uv.lock': 'lock', '.expec/python/environment.json': JSON.stringify(report) });
  const snapshot = { ...await supplied.readSnapshot(), root: { path: root, identity: root } };
  return { sites, snapshot, context: new PythonContext({ root: snapshot.root, readSnapshot: async () => structuredClone(snapshot) }) };
}

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
  it('reads changed installed bytes and added or removed native files on repeated captures', async () => {
    const p = await nativeProject(), path = join(p.sites, 'book.pyi'), uri = pathToFileURL(path).href;
    await fs.writeFile(path, 'class Book: ...');
    const first = await p.context.readSnapshot();
    expect(first.complete, JSON.stringify(first.problems)).toBe(true);
    expect(first.nativeInputs).toContainEqual({ uri, version: digest('class Book: ...') });
    await fs.writeFile(path, 'class Cart: ...');
    const changed = await p.context.readSnapshot();
    expect(changed.complete, JSON.stringify(changed.problems)).toBe(true);
    expect(changed.nativeInputs).toContainEqual({ uri, version: digest('class Cart: ...') });
    const added = join(p.sites, 'title.pyi'); await fs.writeFile(added, 'title: str');
    expect((await p.context.readSnapshot()).nativeInputs).toContainEqual({ uri: pathToFileURL(added).href, version: digest('title: str') });
    await fs.unlink(path);
    const removed = await p.context.readSnapshot();
    expect(removed.complete, JSON.stringify(removed.problems)).toBe(true);
    expect(removed.nativeInputs?.some(input => input.uri === uri)).toBe(false);
    expect(first.nativeInputs).toContainEqual({ uri, version: digest('class Book: ...') });
  });
  it('keeps concurrent capture results independent and rechecks upstream evidence each time', async () => {
    const p = await nativeProject(); await p.context.readSnapshot();
    const [first, second] = await Promise.all([p.context.readSnapshot(), p.context.readSnapshot()]);
    expect(first).toEqual(second); expect(first.complete).toBe(true); expect(first).not.toBe(second);
    const input = first.nativeInputs![0]!;
    p.snapshot.nativeInputs = [{ uri: input.uri, version: '0'.repeat(64) }];
    const conflict = await p.context.readSnapshot();
    expect(conflict.complete).toBe(false); expect(conflict.problems.map(problem => problem.code)).toContain('native-input-conflict');
    expect(first.problems).toEqual([]); expect(second.problems).toEqual([]);
  });
  it('refuses a selected directory redirected after a successful capture', async () => {
    const p = await nativeProject(); expect((await p.context.readSnapshot()).complete).toBe(true);
    await fs.rename(p.sites, p.sites + '-old');
    await fs.symlink(p.sites + '-old', p.sites, process.platform === 'win32' ? 'junction' : 'dir');
    const result = await p.context.readSnapshot();
    expect(result.complete).toBe(false); expect(result.problems.map(problem => problem.code)).toContain('native-input-unavailable');
  });
});
