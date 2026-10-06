import { promises as fs } from 'node:fs';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { ExternalModel, LibraryLoader, SourceLoader, type LoadedLibraries } from '../../../../src/index.js';
import { LibraryLoadingDriver } from '../../../driver/project/dependencies/library-loading.js';

const openFile = fs.open;
async function project(sources: Record<string, string> = { 'index.expec': 'type Book { title: Text }' }) {
  const driver = new LibraryLoadingDriver(); await driver.initialize(); onTestFinished(() => driver.dispose());
  await driver.library('books', '1.0.0', sources); driver.requireLibrary('books', '^1', './libraries/books');
  driver.configure('expec.json', { build: { entries: ['main.expec'] }, libraries: driver.requirements }); return driver;
}
function rejected(driver: LibraryLoadingDriver, code: string) {
  expect(driver.libraries.value).toBeUndefined(); expect(driver.libraries.problems.map(item => item.code)).toContain(code);
}
describe('library capture and supplied graph boundaries', () => {
  it('rejects duplicate decoded metadata keys and retains captured text', async () => {
    const driver = await project(); await driver.file('libraries/books/package.json', '{"version":"1.0.0","version":"2.0.0"}');
    await driver.loadLibraries(); rejected(driver, 'duplicate-key'); expect(driver.libraries.captures[0]!.source.text).toBe('{"version":"1.0.0","version":"2.0.0"}');
  });
  it('retains invalid syntax evidence without a fabricated parsed model', async () => {
    const driver = await project({ 'index.expec': 'type {' }); await driver.loadLibraries();
    expect(driver.libraries.value).toBeUndefined(); expect(driver.libraries.syntax.length).toBeGreaterThan(0);
    expect(driver.libraries.captures.find(item => item.source.sourceId.endsWith('/index.expec'))?.model).toBeUndefined();
  });
  it('rejects invalid UTF-8 without a fabricated text capture', async () => {
    const driver = await project(); await driver.file('libraries/books/index.expec', new Uint8Array([0xff]));
    await driver.loadLibraries(); rejected(driver, 'source-encoding'); expect(driver.libraries.captures.map(item => item.source.sourceId)).not.toContain(driver.fileUrl('libraries/books/index.expec'));
  });
  it('requires a complete library version and an exact supported entry extension', async () => {
    const driver = await project(); await driver.file('libraries/books/package.json', '{"version":"^1","expec":{"entry":"index.js"}}');
    await driver.loadLibraries(); rejected(driver, 'invalid-library-metadata'); expect(driver.opened.mock.calls.some(call => String(call[0]).endsWith('index.js'))).toBe(false);
  });
  it('terminates relative source cycles through the same captured model', async () => {
    const driver = await project({ 'index.expec': 'use Other from "./other.expec"\ntype Book = Text', 'other.expec': 'use Book from "./index.expec"\ntype Other = Number' });
    await driver.loadLibraries(); expect(driver.libraries.problems).toEqual([]);
    const graph = driver.libraries.value!; expect(graph.modules).toHaveLength(2);
    const other = graph.locate('books', './other.expec')!; expect(graph.locate(other, './index.expec')).toBe('books');
  });
  it('does not follow a descendant directory link', async () => {
    const driver = await project({ 'index.expec': 'use Title from "./shared/types.expec"\ntype Book = Title' });
    await driver.file('outside/types.expec', 'type Title = Text'); await driver.directoryLink('libraries/books/shared', 'outside');
    await driver.loadLibraries(); rejected(driver, 'source-link'); expect(driver.opened.mock.calls.some(call => String(call[0]).endsWith('shared/types.expec'))).toBe(false);
  });
  it('does not use another configured library root as relative escape permission', async () => {
    const driver = await project({ 'index.expec': 'use Title from "../other/index.expec"\ntype Book = Title' });
    await driver.library('other', '1.0.0', { 'index.expec': 'type Title = Text' }); driver.requireLibrary('other', '^1', './libraries/other');
    await driver.loadLibraries(); rejected(driver, 'source-outside-roots');
  });
  it('refuses to assign one physical source to two acquired owners', async () => {
    const driver = await project(); driver.requireLibrary('other', '^1', './libraries/books');
    await driver.loadLibraries(); rejected(driver, 'source-alias');
  });
  it('refuses an acquired root link', async () => {
    const driver = await project(); await driver.directoryLink('libraries/alias', 'libraries/books'); driver.requireLibrary('books', '^1', './libraries/alias');
    await driver.loadLibraries(); rejected(driver, 'source-link');
  });
  it('retains an observed root replacement as a failed capture', async () => {
    const driver = await project(); let replaced = false;
    driver.opened.mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await openFile(...args);
      if (!replaced && String(args[0]) === driver.path('libraries/books/index.expec')) {
        replaced = true; const close = handle.close.bind(handle);
        handle.close = async () => {
          await close(); await fs.rename(driver.path('libraries/books'), driver.path('libraries/old-books'));
          await fs.mkdir(driver.path('libraries/books')); await driver.file('libraries/books/index.expec', 'type Replacement = Number');
        };
      }
      return handle;
    });
    await driver.loadLibraries(); rejected(driver, 'source-root-changed');
  });
  it('captures caller configuration before awaiting filesystem work', async () => {
    const driver = await project(), configuration = structuredClone(driver.configuration);
    const pending = new LibraryLoader(driver.manifest).load(configuration);
    (configuration.libraries[0] as { source: string }).source = './missing';
    const loaded = await pending; expect(loaded.problems).toEqual([]); expect(loaded.value?.inventory[0]!.model.locator).toBe('books');
  });
  it('rejects unselected or unreachable graph members', async () => {
    const driver = await project(); await driver.file('main.expec', 'use Book from "books"'); await driver.loadLibraries(); driver.selectDependencies();
    const extra = new ExternalModel('unreached', [{ kind: 'opaque-type', name: 'Unused' }]);
    const result = await driver.loader.load(driver.configuration, driver.selected.value!, { ...driver.libraries.value!, modules: [...driver.libraries.value!.modules, extra] });
    expect(result.value).toBeUndefined(); expect(result.problems.map(item => item.code)).toContain('invalid-library-input');
  });
  it('rejects a relative target omitted from the supplied graph', async () => {
    const driver = await project({ 'index.expec': 'use Title from "./types.expec"\ntype Book = Title', 'types.expec': 'type Title = Text' });
    await driver.file('main.expec', 'use Book from "books"'); await driver.loadLibraries(); driver.selectDependencies();
    const result = await driver.loader.load(driver.configuration, driver.selected.value!, { ...driver.libraries.value!, modules: [driver.libraries.value!.inventory[0]!.model] });
    expect(result.value).toBeUndefined(); expect(result.problems.map(item => item.code)).toContain('invalid-library-input');
  });
  it('captures locator answers once rather than exposing a mutable provider callback', async () => {
    const driver = await project({ 'index.expec': 'use Title from "./types.expec"\ntype Book = Title', 'types.expec': 'type Title = Text' });
    await driver.file('main.expec', 'use Book from "books"'); await driver.loadLibraries(); driver.selectDependencies();
    const graph = driver.libraries.value!, locate = vi.fn(graph.locate);
    const result = await driver.loader.load(driver.configuration, driver.selected.value!, { ...graph, locate });
    expect(result.problems).toEqual([]); expect(locate).toHaveBeenCalledTimes(1); locate.mockReturnValue('changed');
    expect(result.value!.locate('books', './types.expec')).toBe(graph.locate('books', './types.expec')); expect(locate).toHaveBeenCalledTimes(1);
  });
  it.skipIf(process.platform !== 'win32')('does not turn a root-relative library input into an accepted absolute capture', async () => {
    const driver = await project(), source = driver.path('libraries/books').slice(2); driver.opened.mockClear();
    const result = await new LibraryLoader(driver.manifest).load({ ...driver.configuration,
      libraries: [{ module: 'books', version: '^1', source }] });
    expect(result.value).toBeUndefined(); expect(result.problems.map(item => item.code)).toContain('invalid-source-root');
    expect(driver.opened).not.toHaveBeenCalled();
  });
  it.skipIf(process.platform !== 'win32')('rejects a partial UNC input as an invalid root without attempting a file capture', async () => {
    const driver = await project(); driver.opened.mockClear();
    const result = await new LibraryLoader(driver.manifest).load({ ...driver.configuration,
      libraries: [{ module: 'books', version: '^1', source: '\\\\server' }] });
    expect(result.value).toBeUndefined(); expect(result.problems.map(item => item.code)).toContain('invalid-source-root');
    expect(driver.opened).not.toHaveBeenCalled();
  });
  it('uses TypeError for malformed collaborators and invalid locator return shapes', async () => {
    const driver = await project({ 'index.expec': 'use Title from "./types.expec"\ntype Book = Title', 'types.expec': 'type Title = Text' });
    await driver.loadLibraries(); driver.selectDependencies();
    await expect(new SourceLoader(driver.manifest).load(driver.configuration, driver.selected.value!, {} as LoadedLibraries)).rejects.toThrow(TypeError);
    await expect(driver.loader.load(driver.configuration, driver.selected.value!, { ...driver.libraries.value!, locate: () => 42 as unknown as string })).rejects.toThrow(TypeError);
  });
});
