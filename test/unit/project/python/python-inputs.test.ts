import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { PythonInputs, type PythonEnvironment } from '../../../../src/project/python/python-inputs.js';
import type { PythonProfile } from '../../../../src/project/python/python-profile.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function nativeFiles(): Promise<{ root: string; profile: PythonProfile; environment: PythonEnvironment; inputs: PythonInputs }> {
  const root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'expec-python-inputs-')); roots.push(root);
  for (const name of ['stdlib', 'sites', 'readonly']) await fs.mkdir(join(root, name));
  for (const name of ['python', 'uv']) await fs.writeFile(join(root, name), name);
  const profile = { format: 1 as const, python: join(root, 'python'), uv: join(root, 'uv'), sourceRoots: { main: ['src'], test: ['test'] }, environment: '.venv', sourcePath: [join(root, 'readonly')] };
  const environment: PythonEnvironment = { format: 1, config: '0'.repeat(64), pyproject: '0'.repeat(64), lock: '0'.repeat(64),
    python: { path: profile.python, version: '3.12.14', stdlib: [join(root, 'stdlib')], binaries: [] }, uv: { path: profile.uv, version: '0.12.23' },
    environment: { path: join(root, '.venv'), sites: [join(root, 'sites')] }, tools: { libcst: '1.9.0', jedi: '0.20.0', mypy: '2.4.0', pytest: '9.1.1' }, packages: [] };
  return { root, profile, environment, inputs: new PythonInputs() };
}

describe('selected Python input capture', () => {
  it('notices replacement of an empty selected directory', async () => {
    const p = await nativeFiles(); await p.inputs.capture(p.environment, p.profile); expect(p.inputs.problems).toEqual([]);
    await fs.rename(join(p.root, 'readonly'), join(p.root, 'previous')); await fs.mkdir(join(p.root, 'readonly'));
    expect((await p.inputs.verify()).map(problem => problem.code)).toContain('native-input-changed');
  });
  it('does not hide Python source under a bytecode-cache name', async () => {
    const p = await nativeFiles(); await fs.mkdir(join(p.root, 'sites', '__pycache__'));
    await fs.writeFile(join(p.root, 'sites', '__pycache__', 'hidden.py'), 'class Hidden: pass');
    await p.inputs.capture(p.environment, p.profile); expect(p.inputs.problems.map(problem => problem.code)).toContain('native-input-unavailable');
  });
  it('does not omit a nested directory merely named site-packages', async () => {
    const p = await nativeFiles(), path = join(p.root, 'readonly', 'site-packages', 'book.pyi');
    await fs.mkdir(join(p.root, 'readonly', 'site-packages')); await fs.writeFile(path, 'class Book: ...');
    await p.inputs.capture(p.environment, p.profile); expect(p.inputs.problems).toEqual([]);
    expect(p.inputs.evidence().map(input => input.uri)).toContain(pathToFileURL(path).href);
  });
  it('refuses a selected directory reached through a redirected parent', async () => {
    const p = await nativeFiles(); await fs.symlink(join(p.root, 'readonly'), join(p.root, 'redirect'), process.platform === 'win32' ? 'junction' : 'dir');
    await fs.mkdir(join(p.root, 'readonly', 'nested')); p.profile.sourcePath = [join(p.root, 'redirect', 'nested')];
    await p.inputs.capture(p.environment, p.profile); expect(p.inputs.problems.map(problem => problem.code)).toContain('native-input-unavailable');
  });
  it('refuses distinct selected names for the same physical file', async () => {
    const p = await nativeFiles(); await fs.writeFile(join(p.root, 'readonly', 'one.pyi'), 'class Book: ...');
    await fs.link(join(p.root, 'readonly', 'one.pyi'), join(p.root, 'readonly', 'two.pyi'));
    await p.inputs.capture(p.environment, p.profile); expect(p.inputs.problems.map(problem => problem.code)).toContain('native-input-unavailable');
  });
  it('permits ordinary cached bytecode without claiming its bytes as native source', async () => {
    const p = await nativeFiles(), cache = join(p.root, 'sites', '__pycache__'); await fs.mkdir(cache);
    await fs.writeFile(join(cache, 'book.cpython-312.pyc'), 'irrelevant cache bytes');
    await p.inputs.capture(p.environment, p.profile); expect(p.inputs.problems).toEqual([]);
    expect(p.inputs.evidence().some(input => input.uri.endsWith('.pyc'))).toBe(false);
  });
});
