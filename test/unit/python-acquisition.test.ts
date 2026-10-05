import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ConfigurationReader, ProjectInitializer, type Configuration } from '../../src/index.js';
import { installPython, readPythonPackages } from '../../src/python-acquisition.js';
import { ProjectFiles } from '../../src/project-files.js';

const temporary: string[] = [];
async function initialized(): Promise<{ root: string; manifest: string; configuration: Configuration }> {
  const directory = await fs.realpath(await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'expec-python-acquisition-')));
  temporary.push(directory);
  const manifest = join(directory, 'expec.json'), root = join(directory, 'project');
  const read = new ConfigurationReader([]).read({ sourceId: manifest, text: JSON.stringify({
    formatVersion: 1, version: '0.1.0', build: { entries: ['store.expec'] },
  }) });
  if (!read.value) throw Error(JSON.stringify(read.problems));
  const initializer = new ProjectInitializer(manifest, read.value), preview = await initializer.prepare({
    target: 'python', root, python: process.env.EXPEC_TEST_PYTHON!, uv: process.env.EXPEC_TEST_UV!,
  });
  if (!preview.value) throw Error(JSON.stringify(preview.problems));
  const applied = await initializer.apply(preview.value, true);
  if (!applied.value) throw Error(JSON.stringify(applied.problems));
  return { root, manifest, configuration: applied.value.configuration };
}
function requirePackage(configuration: Configuration, version = '26.0'): Configuration {
  return { ...configuration, packages: [...configuration.packages, { alias: 'packaging', name: 'pypi:packaging', version, phases: ['runtime'] }] };
}
afterEach(async () => {
  vi.restoreAllMocks();
  const parent = await fs.realpath(tmpdir());
  for (const path of temporary.splice(0)) {
    if (dirname(path) !== parent || !path.slice(parent.length + 1).startsWith('expec-python-acquisition-')) throw Error('Unexpected cleanup root.');
    await fs.rm(path, { recursive: true, force: true });
  }
});
describe('explicit Python dependency acquisition', { timeout: 180_000 }, () => {
  it('installs the actual exact request and preserves its compatible native lock offline', async () => {
    const p = await initialized(), configuration = requirePackage(p.configuration);
    const installed = await installPython(configuration, p.manifest);
    expect(installed.problems, JSON.stringify(installed.problems)).toEqual([]);
    expect(installed.packages).toContainEqual({ name: 'pypi:packaging', requested: '26.0', selected: '26.0', installed: '26.0' });
    const lock = await fs.readFile(join(p.root, 'uv.lock'));
    expect((await readPythonPackages(configuration, p.manifest)).problems).toEqual([]);
    expect((await installPython(configuration, p.manifest, { offline: true })).problems).toEqual([]);
    expect(await fs.readFile(join(p.root, 'uv.lock'))).toEqual(lock);
  });
  it('refuses a conflicting handwritten requirement before changing native configuration', async () => {
    const p = await initialized(), path = join(p.root, 'pyproject.toml');
    const text = (await fs.readFile(path, 'utf8')).replace('dependencies = []', 'dependencies = ["packaging==25.0"]');
    await fs.writeFile(path, text);
    const installed = await installPython(requirePackage(p.configuration), p.manifest);
    expect(installed.problems.map(problem => problem.code)).toContain('native-dependency-conflict');
    expect(await fs.readFile(path, 'utf8')).toBe(text);
    expect(installed.effects).toEqual([]);
  });
  it('rejects a range before touching the environment', async () => {
    const p = await initialized(), before = await fs.readFile(join(p.root, 'pyproject.toml'));
    const installed = await installPython(requirePackage(p.configuration, '^26.0'), p.manifest);
    expect(installed.problems.map(problem => problem.code)).toContain('unsupported-package-version');
    expect(installed.effects).toEqual([]);
    expect(await fs.readFile(join(p.root, 'pyproject.toml'))).toEqual(before);
    await expect(fs.stat(join(p.root, '.venv'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('retains actual partial effects when a requested distribution cannot be resolved', async () => {
    const p = await initialized(), configuration = { ...p.configuration, packages: [...p.configuration.packages,
      { alias: 'missing', name: 'pypi:expec-absent-distribution-028452991', version: '1.0', phases: ['runtime' as const] }] };
    const installed = await installPython(configuration, p.manifest);
    expect(installed.value).toBeUndefined();
    expect(installed.problems.map(problem => problem.code)).toContain('package-install-failed');
    expect(installed.effects, JSON.stringify(installed.problems)).toContainEqual(expect.objectContaining({ path: 'pyproject.toml', state: 'file' }));
    expect((await readPythonPackages(configuration, p.manifest)).value).toBeUndefined();
  });
  it('removes only its own withdrawn request and keeps handwritten native dependencies', async () => {
    const p = await initialized(), path = join(p.root, 'pyproject.toml');
    await fs.writeFile(path, (await fs.readFile(path, 'utf8')).replace('dependencies = []', 'dependencies = ["colorama==0.4.6"]') + '\n[tool.author]\nnotes = "Keep this setting"\n');
    expect((await installPython(requirePackage(p.configuration), p.manifest)).problems).toEqual([]);
    expect((await installPython(p.configuration, p.manifest, { offline: true })).problems).toEqual([]);
    const text = await fs.readFile(path, 'utf8');
    expect(text).toContain('colorama==0.4.6'); expect(text).toContain('notes = "Keep this setting"');
    expect(text).not.toContain('packaging==');
    expect((await readPythonPackages(p.configuration, p.manifest)).packages.some(item => item.name === 'pypi:packaging')).toBe(false);
  });
  it('keeps a preexisting compatible requirement when its Expec request is removed', async () => {
    const p = await initialized(), path = join(p.root, 'pyproject.toml');
    await fs.writeFile(path, (await fs.readFile(path, 'utf8')).replace('dependencies = []', 'dependencies = ["packaging==26.0"]'));
    expect((await installPython(requirePackage(p.configuration), p.manifest)).problems).toEqual([]);
    expect((await installPython(p.configuration, p.manifest, { offline: true })).problems).toEqual([]);
    expect(await fs.readFile(path, 'utf8')).toContain('packaging==26.0');
  });
  it('moves its requirement to the authored test phase without deleting unrelated entries', async () => {
    const p = await initialized(), runtime = requirePackage(p.configuration);
    expect((await installPython(runtime, p.manifest)).problems).toEqual([]);
    const test = { ...runtime, packages: runtime.packages.map(item => item.alias === 'packaging' ? { ...item, phases: ['test' as const] } : item) };
    const stale = await readPythonPackages(test, p.manifest);
    expect(stale.problems.map(problem => problem.code)).toContain('python-install-required');
    expect((await installPython(test, p.manifest, { offline: true })).problems).toEqual([]);
    const report = JSON.parse(await fs.readFile(join(p.root, '.expec/python/environment.json'), 'utf8'));
    expect(report.packages.find((item: { alias: string }) => item.alias === 'packaging')).toMatchObject({ version: '26.0', phases: ['test'] });
    expect(report.owned).toContainEqual({ name: 'packaging', requirement: 'packaging==26.0', group: 'expec-test' });
  });
  it('retains previous observations as pending after a later install fails', async () => {
    const p = await initialized(), first = requirePackage(p.configuration), path = join(p.root, '.expec/python/environment.json');
    expect((await installPython(first, p.manifest)).problems).toEqual([]);
    const successful = JSON.parse(await fs.readFile(path, 'utf8'));
    const next = { ...first, packages: [...first.packages, { alias: 'missing', name: 'pypi:expec-absent-distribution-028452991', version: '1.0', phases: ['runtime' as const] }] };
    const failed = await installPython(next, p.manifest);
    expect(failed.value).toBeUndefined();
    expect(JSON.parse(await fs.readFile(path, 'utf8'))).toMatchObject({ pending: true, packages: successful.packages });
    expect((await readPythonPackages(first, p.manifest)).value).toBeUndefined();
    expect((await installPython(first, p.manifest, { offline: true })).problems).toEqual([]);
    expect(JSON.parse(await fs.readFile(path, 'utf8')).pending).not.toBe(true);
  });
  it('requires the fixed native tooling phases before modifying requirements', async () => {
    const p = await initialized(), before = await fs.readFile(join(p.root, 'pyproject.toml'));
    const configuration = { ...p.configuration, packages: p.configuration.packages.map(item => item.alias === 'jedi' ? { ...item, phases: ['test' as const] } : item) };
    const result = await installPython(configuration, p.manifest);
    expect(result.problems.map(problem => problem.code)).toContain('python-tooling-required');
    expect(result.effects).toEqual([]);
    expect(await fs.readFile(join(p.root, 'pyproject.toml'))).toEqual(before);
  });
  it('rejects arbitrary partial ownership instead of deleting a handwritten dependency', async () => {
    const p = await initialized(), path = join(p.root, 'pyproject.toml');
    const text = (await fs.readFile(path, 'utf8')).replace('dependencies = []', 'dependencies = ["packaging==25.0"]');
    await fs.writeFile(path, text); await fs.mkdir(join(p.root, '.expec/python'), { recursive: true });
    await fs.writeFile(join(p.root, '.expec/python/environment.json'), JSON.stringify({ owned: [{ name: 'packaging', requirement: 'packaging==25.0', group: 'runtime' }] }));
    const result = await installPython(p.configuration, p.manifest);
    expect(result.problems.map(problem => problem.code)).toContain('invalid-python-environment');
    expect(result.effects).toEqual([]); expect(await fs.readFile(path, 'utf8')).toBe(text);
  });
  it('does not confuse a native group named runtime with the actual runtime dependencies', async () => {
    const p = await initialized(), path = join(p.root, 'pyproject.toml');
    const text = (await fs.readFile(path, 'utf8')).replace('dependencies = []', 'dependencies = ["packaging==25.0"]')
      .replace('[dependency-groups]', '[dependency-groups]\nruntime = ["packaging==26.0"]');
    await fs.writeFile(path, text);
    const result = await installPython(requirePackage(p.configuration), p.manifest);
    expect(result.problems.map(problem => problem.code)).toContain('native-dependency-conflict');
    expect(result.effects).toEqual([]); expect(await fs.readFile(path, 'utf8')).toBe(text);
  });
  it('stops when the captured native configuration changes before acquisition', async () => {
    const p = await initialized(), read = ProjectFiles.prototype.read;
    let changed = false;
    vi.spyOn(ProjectFiles.prototype, 'read').mockImplementation(async function(this: ProjectFiles, path: string) {
      if (this.root.path === p.root && path === 'expec.python.json' && !changed) {
        changed = true;
        const config = JSON.parse(await fs.readFile(this.path(path), 'utf8')); config.environment = '.changed';
        await fs.writeFile(this.path(path), JSON.stringify(config));
      }
      return read.call(this, path);
    });
    const result = await installPython(p.configuration, p.manifest);
    expect(changed).toBe(true);
    expect(result.problems.map(problem => problem.code)).toContain('stale-project');
    expect(result.effects).toEqual([]);
    await expect(fs.stat(join(p.root, '.venv'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('does not write through a redirected native cache', async () => {
    const p = await initialized(), destination = join(dirname(p.root), 'external-cache');
    await fs.mkdir(destination); await fs.symlink(destination, join(p.root, '.uv-cache'), process.platform === 'win32' ? 'junction' : 'dir');
    const result = await installPython(p.configuration, p.manifest);
    expect(result.problems.map(problem => problem.code)).toContain('unsupported-change');
    expect(result.effects).toEqual([]); expect(await fs.readdir(destination)).toEqual([]);
  });
});
