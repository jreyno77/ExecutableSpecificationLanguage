import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigurationReader, SourceLoader, type SourceLoad } from '../../src/index.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    const path = resolve(root), inside = relative(await fs.realpath(tmpdir()), path);
    if (isAbsolute(inside) || inside === '..' || inside.startsWith('..' + sep) || !inside.startsWith('expec-source-unit-')) throw new Error('Unsafe fixture cleanup');
    await fs.rm(path, { recursive: true, force: true });
  }
});
async function workspace(files: Record<string, string>, entries = Object.keys(files)) {
  const container = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'expec-source-unit-'))); roots.push(container);
  const root = join(container, 'workspace'); await fs.mkdir(root);
  for (const [name, text] of Object.entries(files)) { await fs.mkdir(dirname(join(root, name)), { recursive: true }); await fs.writeFile(join(root, name), text); }
  const configuration = manifest({ entries });
  if (!configuration.value) throw new Error('Invalid fixture');
  const loader = new SourceLoader(join(root, 'expec.json'));
  return { root, container, load: () => loader.load(configuration.value!, { modules: [], packages: [] }) };
}
function manifest(build: unknown, libraries: unknown[] = []) {
  return new ConfigurationReader([]).read({ sourceId: 'settings', text: JSON.stringify({ formatVersion: 1, version: '0.1.0', build, libraries }) });
}
function codes(report: SourceLoad): string[] { return report.problems.map(problem => problem.code); }
function captureNames(report: SourceLoad): string[] { return report.captures.filter(item => item.model).map(item => fileURLToPath(item.source.sourceId).split(/[\\/]/).at(-1)!).sort(); }

describe('source loading boundaries', () => {
  it('requires an absolute manifest filename', () => {
    expect(() => new SourceLoader('expec.json')).toThrow(TypeError);
  });
  it('keeps absent extra roots absent in existing configuration results', () => {
    expect(manifest({ entries: ['store.expec'] }).value?.build).toEqual({ entries: ['store.expec'] });
  });
  it('rejects repeated additional roots in the configuration', () => {
    const checked = manifest({ entries: ['store.expec'], sourceRoots: ['../shared', '../shared'] });
    expect(checked.value).toBeUndefined();
    expect(checked.problems).toContainEqual(expect.objectContaining({
      code: 'invalid-setting', at: { kind: 'dependency', path: ['manifest', 'settings', 'build', 'sourceRoots', 1] }
    }));
  });
  it('keeps local filenames out of the bare library namespace', () => {
    const checked = manifest({ entries: ['store.expec'] }, [{ module: './book.expec', version: '1.0.0' }]);
    expect(checked.value).toBeUndefined();
    expect(checked.problems).toContainEqual(expect.objectContaining({
      code: 'invalid-setting', at: { kind: 'dependency', path: ['manifest', 'settings', 'libraries', 0, 'module'] }
    }));
  });
  it('retains scoped bare library names unchanged', () => {
    expect(manifest({ entries: ['store.expec'] }, [{ module: '@shop/books', version: '^1.0.0' }]).value?.libraries)
      .toEqual([{ module: '@shop/books', version: '^1.0.0' }]);
  });
  it('rejects a changing file while keeping an unaffected sibling', async () => {
    const project = await workspace({ 'changing.expec': 'opaque type Before', 'good.expec': 'opaque type Good' });
    const originalOpen = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
      const handle = await originalOpen(path, flags, mode);
      if (String(path) === join(project.root, 'changing.expec')) {
        const originalRead = handle.readFile.bind(handle);
        handle.readFile = (async () => {
          const bytes = await originalRead(); await fs.writeFile(join(project.root, 'changing.expec'), 'opaque type After'); return bytes;
        }) as typeof handle.readFile;
      }
      return handle;
    });
    const loaded = await project.load();
    expect(loaded.value).toBeUndefined();
    expect(codes(loaded)).toContain('source-changed');
    expect(captureNames(loaded)).toEqual(['good.expec']);
    expect(await fs.readFile(join(project.root, 'changing.expec'), 'utf8')).toBe('opaque type After');
  });
  it('rejects an observed root replacement without trusting its new contents', async () => {
    const project = await workspace({ 'store.expec': 'opaque type Original' });
    const originalOpen = fs.open.bind(fs); let replaced = false;
    vi.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
      if (!replaced && String(path) === join(project.root, 'store.expec')) {
        replaced = true;
        await fs.rename(project.root, join(project.container, 'previous'));
        await fs.mkdir(project.root); await fs.writeFile(join(project.root, 'store.expec'), 'opaque type Replacement');
      }
      return originalOpen(path, flags, mode);
    });
    const loaded = await project.load();
    expect(loaded.value).toBeUndefined();
    expect(codes(loaded)).toContain('source-root-changed');
    expect(loaded.captures.some(capture => capture.source.text.includes('Replacement'))).toBe(false);
    expect(replaced).toBe(true);
    expect(await fs.readFile(join(project.root, 'store.expec'), 'utf8')).toBe('opaque type Replacement');
  });
  it('reports a read error and retains unrelated syntax evidence', async () => {
    const project = await workspace({ 'denied.expec': 'opaque type Hidden', 'broken.expec': 'type Broken {' });
    const originalOpen = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
      if (String(path) === join(project.root, 'denied.expec')) throw Object.assign(new Error('Access denied by fixture'), { code: 'EACCES' });
      return originalOpen(path, flags, mode);
    });
    const loaded = await project.load();
    expect(loaded.value).toBeUndefined();
    expect(loaded.problems).toContainEqual(expect.objectContaining({
      code: 'source-unavailable', message: expect.stringContaining('EACCES'),
      at: { kind: 'dependency', path: ['manifest', 'settings', 'build', 'entries', 0] }
    }));
    expect(loaded.syntax).toContainEqual(expect.objectContaining({
      category: 'expected-token', primaryRange: expect.objectContaining({ sourceId: expect.stringContaining('broken.expec') })
    }));
  });
});
