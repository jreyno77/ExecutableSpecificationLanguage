import { describe, expect, it, onTestFinished } from 'vitest';
import { promises as fs } from 'node:fs';
import { parse, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FileProjectWriter, type FileChange, type ProjectSnapshot } from '../../src/index.js';
import { nativeInputs, protectsNativeInput, sameNativeInputs } from '../../src/native-inputs.js';
import { checkPlan, checkRead, checkSearch } from '../../src/output-contract.js';
import { NativeInputDriver } from '../driver/native-inputs.js';

const uri = pathToFileURL(resolve('catalog.jar')).href, version = 'a'.repeat(64);
const snapshot = (native: ProjectSnapshot['nativeInputs'] = [{ uri, version }]): ProjectSnapshot => ({
  root: { path: resolve('.'), identity: 'example' }, complete: true, files: [], excludeNames: [], excluded: [], problems: [], nativeInputs: native,
});
const write = (path: string): FileChange => ({ kind: 'write', path, bytes: Buffer.from('new') });
async function project(included = false): Promise<NativeInputDriver> {
  const driver = new NativeInputDriver(); onTestFinished(() => driver.project.dispose());
  await driver.initialize(); await driver.addLibrary('lib/catalog.jar', 'library', included); await driver.plan({ 'result.txt': 'written' }); return driver;
}
async function stopped(driver: NativeInputDriver, code: string): Promise<void> {
  await driver.project.apply();
  expect(driver.project.result).toMatchObject({ status: 'stopped', problems: [expect.objectContaining({ code })] });
  await expect(fs.lstat(driver.project.path('result.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
}

describe('native input evidence describes canonical files and exact byte versions', () => {
  it('accepts a local escaped filename without inspecting the filesystem', () => {
    const escaped = pathToFileURL(resolve('not-created', 'catalog #1 ü.jar')).href;
    expect(nativeInputs(snapshot([{ uri: escaped, version }]))?.size).toBe(1);
  });
  const invalidUris = [
    ['a relative path', 'catalog.jar'], ['a network resource', 'https://example.test/catalog.jar'],
    ['a network file authority', 'file://server/library.jar'], ['a normalized localhost authority', uri.replace('file:///', 'file://localhost/')],
    ['credentials', 'file://user:password@localhost/library.jar'], ['a query', uri + '?revision=1'], ['a fragment', uri + '#part'],
    ['dot segments', uri.replace('/catalog.jar', '/unused/../catalog.jar')], ['noncanonical escaping', uri.replace('catalog', '%63atalog')],
    ['encoded separators', uri.replace('catalog', 'dir%2Fcatalog')], ['an encoded null', uri.replace('catalog', '%00catalog')],
    ['a directory spelling', uri + '/'], ['a filesystem root', pathToFileURL(parse(resolve('.')).root).href],
  ];
  for (const [meaning, invalid] of invalidUris) it('rejects ' + meaning, () => {
    expect(nativeInputs(snapshot([{ uri: invalid!, version }]))).toBeUndefined();
  });
  it('accepts only lowercase full SHA256 digests', () => {
    for (const invalid of ['', '1.0.0', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64), 17, null]) {
      expect(nativeInputs(snapshot([{ uri, version: invalid as string }]))).toBeUndefined();
    }
  });
  it('rejects malformed input containers and entries', () => {
    for (const invalid of [null, {}, 'file', [null], [{}], new Array(1)]) {
      expect(nativeInputs(snapshot(invalid as ProjectSnapshot['nativeInputs']))).toBeUndefined();
    }
  });
  it('rejects repeated identities even when their versions agree', () => {
    expect(nativeInputs(snapshot([{ uri, version }, { uri, version }]))).toBeUndefined();
  });
  it('treats case aliases according to the host file identity convention', () => {
    const aliases = snapshot([{ uri, version }, { uri: uri.replace('catalog.jar', 'CATALOG.jar'), version }]);
    expect(nativeInputs(aliases)?.size).toBe(process.platform === 'win32' ? undefined : 2);
  });
  it('compares input sets without reordering or changing either snapshot', () => {
    const another = { uri: pathToFileURL(resolve('runtime.bin')).href, version: 'b'.repeat(64) };
    const first = snapshot([{ uri, version }, another]), second = snapshot([another, { uri, version }]);
    const before = structuredClone([first, second]);
    expect(sameNativeInputs(first, second)).toBe(true); expect([first, second]).toEqual(before);
  });
  it('distinguishes changed, added and removed byte evidence', () => {
    expect(sameNativeInputs(snapshot(), snapshot([{ uri, version: 'b'.repeat(64) }]))).toBe(false);
    expect(sameNativeInputs(snapshot(), snapshot([]))).toBe(false);
    expect(sameNativeInputs(snapshot([]), snapshot())).toBe(false);
    expect(sameNativeInputs(snapshot(), snapshot([{ uri, version: 'wrong' }]))).toBe(false);
  });
  it('keeps omitted and empty evidence equivalent', () => {
    const { nativeInputs: _ignored, ...plain } = snapshot();
    expect(sameNativeInputs(plain, snapshot([]))).toBe(true);
  });
});

describe('native file protection does not grant mutation permission', () => {
  it('covers exact, parent and child endpoints without hiding adjacent filenames', () => {
    const captured = snapshot([{ uri: pathToFileURL(resolve('lib/catalog.jar')).href, version }]);
    for (const path of ['lib', 'lib/catalog.jar', 'lib/catalog.jar/part']) expect(protectsNativeInput(captured, path)).toBe(true);
    for (const path of ['library', 'lib/catalog.jar.extra', 'lib/another.jar']) expect(protectsNativeInput(captured, path)).toBe(false);
  });
  it('does not classify an outside-root library as a project endpoint', () => {
    const captured = snapshot([{ uri: pathToFileURL(resolve('../catalog.jar')).href, version }]);
    expect(protectsNativeInput(captured, 'catalog.jar')).toBe(false);
  });
  it('preflights native move sources before an earlier valid write', async () => {
    const driver = await project(true); driver.project.changes.push({ kind: 'move', from: 'lib/catalog.jar', to: 'moved.jar' });
    await stopped(driver, 'invalid-change'); expect(await fs.readFile(driver.project.path('lib/catalog.jar'), 'utf8')).toBe('library');
  });
  it('preflights native move destinations before an earlier valid write', async () => {
    const driver = await project(true); await driver.project.edit('other.jar', 'other'); await driver.plan({ 'result.txt': 'written' });
    driver.project.changes.push({ kind: 'move', from: 'other.jar', to: 'lib/catalog.jar' });
    await stopped(driver, 'invalid-change'); expect(await fs.readFile(driver.project.path('other.jar'), 'utf8')).toBe('other');
  });
  it('preflights native removal and parent/child endpoints', async () => {
    const driver = await project(true);
    for (const change of [{ kind: 'remove', path: 'lib/catalog.jar' } as const, write('lib'), write('lib/catalog.jar/part')]) {
      driver.project.changes = [write('result.txt'), change]; await stopped(driver, 'invalid-change');
    }
  });
});

describe('fresh native observations stay honest through the writer and output boundaries', () => {
  it('stops on malformed complete fresh evidence', async () => {
    const driver = await project(); driver.mode = 'malformed'; await stopped(driver, 'stale-project');
  });
  it('reports an incomplete fresh capture before comparing its partial evidence', async () => {
    const driver = await project(), context = driver.project.context;
    driver.project.context = { root: context.root, readSnapshot: async () => ({ ...await context.readSnapshot(), complete: false, nativeInputs: [] }) };
    await stopped(driver, 'incomplete-project');
  });
  it('reports fresh capture problems even if its complete flag was left true', async () => {
    const driver = await project(), context = driver.project.context;
    driver.project.context = { root: context.root, readSnapshot: async () => ({ ...await context.readSnapshot(), problems: [
      { code: 'unreadable-library', message: 'Cannot read catalog', at: { kind: 'dependency', path: ['catalog.jar'] }, related: [] },
    ] }) }; await stopped(driver, 'incomplete-project');
  });
  it('accepts replacement with identical bytes without inventing inode guarantees', async () => {
    const driver = await project(), path = driver.libraries.get('lib/catalog.jar')!;
    await fs.rename(path, path + '.old'); await fs.writeFile(path, 'library');
    await driver.project.apply(); expect(driver.project.result.status).toBe('applied');
  });
  it('captures supplied input evidence before asynchronous writer work', async () => {
    const driver = await project(), baseline = structuredClone(driver.project.snapshot);
    const pending = new FileProjectWriter(driver.project.context).apply({ basedOn: baseline, changes: driver.project.changes });
    (baseline.nativeInputs![0] as { version: string }).version = 'b'.repeat(64);
    expect((await pending).status).toBe('applied'); expect(driver.project.snapshot.nativeInputs![0]!.version).not.toBe('b'.repeat(64));
  });
  it('rejects malformed evidence at every output result boundary, including a refused plan', () => {
    const malformed = snapshot([{ uri, version: 'bad' }]);
    expect(() => checkPlan({ problems: [{ code: 'unavailable', message: 'No target', at: { kind: 'dependency', path: [] }, related: [] }], deferred: [] }, malformed, 'custom')).toThrow('native');
    expect(() => checkRead({} as never, malformed, 'custom')).toThrow('native');
    expect(() => checkSearch({} as never, malformed, 'custom', 'id')).toThrow('native');
  });
  it('rejects a well-formed output plan that tries to overwrite a captured native input', () => {
    const captured = snapshot();
    expect(() => checkPlan({ value: { outputId: 'custom', basedOn: captured, changes: [write('catalog.jar')], artifacts: [] }, problems: [], deferred: [] }, captured, 'custom')).toThrow('not writable');
  });
});
