import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it, onTestFinished } from 'vitest';
import { ConfigurationReader, DependencyPlanner, ExternalModel, SourceLoader, type Configuration } from '../../src/index.js';

async function workspace(files: Record<string, string>, settings: object = {}) {
  const temporary = await realpath(await mkdtemp(join(tmpdir(), 'expec-source-contract-')));
  onTestFinished(async () => {
    const remainder = relative(await realpath(tmpdir()), resolve(temporary));
    if (isAbsolute(remainder) || remainder.startsWith('..' + sep) || !remainder.startsWith('expec-source-contract-')) throw new Error('Unsafe fixture cleanup.');
    await rm(temporary, { recursive: true, force: true });
  });
  for (const [name, text] of Object.entries(files)) await writeFile(join(temporary, name), text);
  const configuration = new ConfigurationReader([]).read({ sourceId: 'settings', text: JSON.stringify({
    formatVersion: 1, version: '0.1.0', build: { entries: ['store.expec'] }, ...settings,
  }) });
  if (!configuration.value) throw new Error('Invalid configuration fixture: ' + JSON.stringify(configuration));
  return { directory: temporary, configuration: configuration.value, loader: new SourceLoader(join(temporary, 'expec.json')),
    url: (name: string) => pathToFileURL(join(temporary, name)).href };
}

it('rejects a supplied module whose model interface cannot be consumed', async () => {
  const project = await workspace({ 'store.expec': 'use Book from "library"' },
    { libraries: [{ module: 'library', version: '1.0.0' }] });
  const model = new ExternalModel('library', [{ kind: 'opaque-type', name: 'Book' }]);
  Object.defineProperty(model, 'roots', { value: undefined });
  const dependencies = new DependencyPlanner().resolve(project.configuration, { modules: [{ version: '1.0.0', model }], packages: [] });
  expect(dependencies.value).toBeDefined();

  await expect(project.loader.load(project.configuration, dependencies.value!)).rejects.toThrow(TypeError);
});

it('locates only captured owner and authored-locator pairs', async () => {
  const project = await workspace({ 'store.expec': 'use Book from "./book.expec"', 'book.expec': 'opaque type Book' });
  const loaded = await project.loader.load(project.configuration, { modules: [], packages: [] });

  expect(loaded.value).toBeDefined();
  expect(loaded.value!.locate(project.url('store.expec'), './book.expec')).toBe(project.url('book.expec'));
  expect(loaded.value!.locate(project.url('book.expec'), './book.expec')).toBeUndefined();
  expect(loaded.value!.locate(project.url('store.expec'), './store.expec')).toBeUndefined();
  expect(loaded.value!.locate('unknown', './book.expec')).toBeUndefined();
});

it('captures selected package availability without owning caller arrays', async () => {
  const project = await workspace({ 'store.expec': 'opaque type Store' }, {
    packages: [{ alias: 'web', name: 'vite', version: '1.0.0', phases: ['build'] }],
  });
  const selected = new DependencyPlanner().resolve(project.configuration, { modules: [], packages: [{ name: 'vite', version: '1.0.0' }] });
  expect(selected.value).toBeDefined();
  const loaded = await project.loader.load(project.configuration, selected.value!);

  expect(loaded.value).toBeDefined();
  expect(selected.value!.packages).toEqual([{ alias: 'web', phases: ['build'] }]);
  const captured = loaded.value!.entries[0]!.dependencies.packages;
  expect(captured).toEqual([{ alias: 'web', phases: ['build'] }]);
  // A caller reusing its own array cannot rewrite an earlier capture.
  (selected.value!.packages[0]!.phases as string[]).push('test');
  expect(captured).toEqual([{ alias: 'web', phases: ['build'] }]);
});

it('rejects different root spellings that identify the same directory', async () => {
  const project = await workspace({ 'store.expec': 'opaque type Store' });
  await symlink(project.directory, join(project.directory, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
  const configuration = { ...project.configuration, build: { ...project.configuration.build, sourceRoots: ['alias'] } } satisfies Configuration;
  const loaded = await project.loader.load(configuration, { modules: [], packages: [] });

  expect(loaded.value).toBeUndefined();
  expect(loaded.problems).toContainEqual(expect.objectContaining({
    code: 'invalid-source-root', at: { kind: 'dependency', path: ['manifest', 'settings', 'build', 'sourceRoots', 0] },
    related: [{ kind: 'dependency', path: ['manifest', 'settings', 'build'] }],
  }));
});
