import fs from 'node:fs';
import { createHash } from 'node:crypto';
import type ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileProjectWriter, TypeScriptContext, TypeScriptProject, type ProjectSnapshot, type ProjectFile } from '../../../../src/index.js';
import { NativeContextDriver } from '../../../driver/project/typescript/typescript-context.js';

const semanticObservation = vi.hoisted(() => ({ active: undefined as { checkedFiles: string[] } | undefined }));
vi.mock('typescript', async importOriginal => {
  const actual = await importOriginal<{ default: typeof ts }>(), native = actual.default;
  return { ...actual, default: new Proxy(native, { get(target, key, receiver) {
    if (key !== 'createLanguageService') return Reflect.get(target, key, receiver);
    return function (this: typeof ts, ...args: Parameters<typeof native.createLanguageService>) {
      const service = Reflect.apply(native.createLanguageService, this, args) as ts.LanguageService;
      if (!semanticObservation.active) return service;
      const getProgram = service.getProgram, observed = new WeakSet<ts.Program>();
      vi.spyOn(service, 'getProgram').mockImplementation(function (this: ts.LanguageService) {
        const program = getProgram.call(this);
        if (!semanticObservation.active || !program || observed.has(program)) return program;
        observed.add(program);
        const getDiagnostics = program.getSemanticDiagnostics;
        vi.spyOn(program, 'getSemanticDiagnostics').mockImplementation(function (this: ts.Program, ...args: Parameters<ts.Program['getSemanticDiagnostics']>) {
          if (semanticObservation.active) semanticObservation.active.checkedFiles.push(...(args[0] ? [args[0]] : this.getSourceFiles()).map(file => file.fileName));
          return Reflect.apply(getDiagnostics, this, args);
        });
        return program;
      });
      return service;
    };
  } }) };
});
function observeSemanticChecks(): { checkedFiles: string[] } { return semanticObservation.active = { checkedFiles: [] }; }

const active: NativeContextDriver[] = [];
afterEach(async () => { semanticObservation.active = undefined; vi.restoreAllMocks(); for (const driver of active.splice(0)) await driver.dispose(); });
async function project(): Promise<NativeContextDriver> { const driver = new NativeContextDriver(); active.push(driver); await driver.connect(); return driver; }
const file = (path: string, text: string): ProjectFile => { const bytes = Buffer.from(text); return { path, bytes, version: createHash('sha256').update(bytes).digest('hex') }; };
const snapshot = (): ProjectSnapshot => ({ root: { path: process.cwd(), identity: 'supplied' }, complete: true, problems: [], excludeNames: ['node_modules'], excluded: ['node_modules'], files: [file('store.ts', 'export class Store {}')] });
const reader = () => new TypeScriptProject({ outputId: 'typescript' }, [{ specId: 'store', locator: { outputId: 'typescript', format: 'typescript-symbol-1', value: { file: 'store.ts', declaration: [{ kind: 'class', name: 'Store' }] } } }]);
const book = file('node_modules/catalog/index.d.ts', 'export interface Book { title: string }');

function expectMissingNativeInputAt(result: ProjectSnapshot, path: string, token: string): void {
  const source = result.files.find(file => file.path === path);
  const problem = result.problems.find(problem => problem.code === 'native-input-unavailable'
    && problem.at.kind === 'dependency' && problem.at.path[1] === path);
  expect(source, `Expected captured source ${path}`).toBeDefined();
  expect(problem, `Expected unavailable native input at ${path}`).toBeDefined();
  if (!source || problem?.at.kind !== 'dependency') throw Error('Expected a located native-input failure.');
  const [, , start, length] = problem.at.path;
  expect(typeof start).toBe('number'); expect(typeof length).toBe('number');
  expect(Buffer.from(source.bytes).toString('utf8').slice(Number(start), Number(start) + Number(length))).toBe(token);
}

describe('captured native input contracts', { timeout: 30_000 }, () => {
  it('captures a resolved declaration without semantically checking it for unrelated errors', async () => {
    const driver = await project();
    await driver.package('catalog', { types: 'index.d.ts' }, {
      'index.d.ts': 'export interface Book { title: string }',
    });
    await driver.file('src/use.ts', 'import type { Book } from "catalog"; export type Title = Book["title"];');
    const semantics = observeSemanticChecks();

    await driver.capture();

    expect(driver.snapshot.complete).toBe(true);
    expect(driver.snapshot.problems).toEqual([]);
    expect(driver.snapshot.readOnlyFiles?.map(file => file.path)).toEqual([
      'node_modules/catalog/index.d.ts', 'node_modules/catalog/package.json',
    ]);
    const declaration = driver.snapshot.readOnlyFiles!.find(file => file.path === 'node_modules/catalog/index.d.ts')!;
    expect(Buffer.from(declaration.bytes).toString('utf8')).toBe('export interface Book { title: string }');
    expect(declaration.version).toBe(driver.hash(declaration.bytes));
    expect(driver.snapshot.files.some(file => file.path.startsWith('node_modules/'))).toBe(false);
    expect(semantics.checkedFiles).not.toContain('/__expec_project__/node_modules/catalog/index.d.ts');
  });
  it('locates an unavailable import when its resolved declaration contains invalid UTF-8', async () => {
    const driver = await project();
    await driver.package('catalog', { types: 'index.d.ts' }, {
      'index.d.ts': 'export interface Book { title: string }',
    });
    const importer = 'import type { Book } from "catalog"; export type Title = Book["title"];';
    await driver.file('src/use.ts', importer);
    fs.writeFileSync(driver.path('node_modules/catalog/index.d.ts'), Uint8Array.from([0xc3, 0x28]));

    const result = await new TypeScriptContext(driver.context).readSnapshot();

    expect(result.complete).toBe(false);
    expect(result.problems).toContainEqual(expect.objectContaining({
      code: 'native-read-failed',
      at: { kind: 'dependency', path: ['typescript', 'node_modules/catalog/index.d.ts'] },
    }));
    expectMissingNativeInputAt(result, 'src/use.ts', '"catalog"');
    expect(result.readOnlyFiles?.some(file => file.path === 'node_modules/catalog/index.d.ts')).toBe(false);
    expect(result.files.some(file => file.path === 'src/use.ts')).toBe(true);
  });
  it('keeps a resolved but excluded declaration unavailable under noResolve', async () => {
    const driver = await project();
    await driver.package('catalog', { types: 'index.d.ts' }, {
      'index.d.ts': 'export interface Book { title: string }',
    });
    const importer = 'import type { Book } from "catalog"; export type Title = Book["title"];';
    await driver.file('src/use.ts', importer);
    await driver.file('tsconfig.json', JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', noResolve: true, types: [] },
      files: ['src/use.ts'],
    }));

    const result = await new TypeScriptContext(driver.context, { configFile: 'tsconfig.json' }).readSnapshot();

    expect(result.complete).toBe(false);
    expectMissingNativeInputAt(result, 'src/use.ts', '"catalog"');
    expect(result.files.some(file => file.path === 'src/use.ts')).toBe(true);
  });
  it('keeps a missing import inside an augmentation of an available project module visible', async () => {
    const driver = await project();
    await driver.file('src/store.ts', 'export interface Store {}');
    const extension = `import "./store.js";
  declare module "./store.js" {
    import type { Missing } from "missing-types";
    interface Store { extra: Missing; }
  }
  export {};`;
    await driver.file('src/extension.ts', extension);

    const result = await new TypeScriptContext(driver.context).readSnapshot();

    expect(result.complete).toBe(false);
    expectMissingNativeInputAt(result, 'src/extension.ts', '"missing-types"');
    const store = result.files.find(file => file.path === 'src/store.ts')!;
    expect(Buffer.from(store.bytes).toString('utf8')).toBe('export interface Store {}');
  });
  it('keeps a missing triple-slash path visible when declaration checking is skipped', async () => {
    const driver = await project();
    await driver.package('catalog', { types: 'index.d.ts' }, { 'index.d.ts': '/// <reference path="./missing.d.ts" />\nexport interface Book {}' });
    await driver.file('tsconfig.json', '{"compilerOptions":{"skipLibCheck":true,"types":[]},"files":["src/book.ts"]}');
    await driver.file('src/book.ts', 'import type { Book } from "catalog"; export type Title = Book;');
    const result = await new TypeScriptContext(driver.context, { configFile: 'tsconfig.json' }).readSnapshot();
    expect(result.complete).toBe(false); expect(result.problems.some(problem => problem.code === 'native-input-unavailable' && problem.message.includes('missing.d.ts'))).toBe(true);
  });
  it('keeps a missing triple-slash type package visible when declaration checking is skipped', async () => {
    const driver = await project();
    await driver.package('catalog', { types: 'index.d.ts' }, { 'index.d.ts': '/// <reference types="missing-types" />\nexport interface Book {}' });
    await driver.file('tsconfig.json', '{"compilerOptions":{"skipLibCheck":true,"types":[]},"files":["src/book.ts"]}');
    await driver.file('src/book.ts', 'import type { Book } from "catalog"; export type Title = Book;');
    const result = await new TypeScriptContext(driver.context, { configFile: 'tsconfig.json' }).readSnapshot();
    expect(result.complete).toBe(false); expect(result.problems.some(problem => problem.code === 'native-input-unavailable' && problem.message.includes('missing-types'))).toBe(true);
  });
  it('keeps an unavailable triple-slash compiler library visible when declaration checking is skipped', async () => {
    const driver = await project();
    await driver.package('catalog', { types: 'index.d.ts' }, { 'index.d.ts': '/// <reference lib="es9999" />\nexport interface Book {}' });
    await driver.file('tsconfig.json', '{"compilerOptions":{"skipLibCheck":true,"types":[]},"files":["src/book.ts"]}');
    await driver.file('src/book.ts', 'import type { Book } from "catalog"; export type Title = Book;');
    const result = await new TypeScriptContext(driver.context, { configFile: 'tsconfig.json' }).readSnapshot();
    expect(result.complete).toBe(false); expect(result.problems.some(problem => problem.code === 'native-input-unavailable' && problem.message.includes('es9999'))).toBe(true);
  });
  it('does not let skipLibCheck hide a missing transitive native declaration', async () => {
    const driver = await project();
    await driver.package('catalog', { types: 'index.d.ts' }, { 'index.d.ts': 'export type { Book } from "./missing.js";' });
    await driver.file('tsconfig.json', '{"compilerOptions":{"target":"ES2022","module":"NodeNext","skipLibCheck":true,"types":[]},"include":["src/**/*.ts"]}');
    await driver.file('src/book.ts', 'import type { Book } from "catalog"; export type Title = Book;');
    const result = await new TypeScriptContext(driver.context, { configFile: 'tsconfig.json' }).readSnapshot();
    expect(result.complete).toBe(false); expect(result.problems.some(problem => problem.code === 'native-input-unavailable' && problem.message.includes('./missing.js'))).toBe(true);
  });
  it('retains an unavailable side-effect import even when native semantic checking ignores it', async () => {
    const driver = await project(); await driver.file('src/setup.ts', 'import "missing-setup"; export {};');
    const result = await new TypeScriptContext(driver.context).readSnapshot();
    expect(result.complete).toBe(false); expect(result.problems.some(problem => problem.code === 'native-input-unavailable' && problem.message.includes('missing-setup'))).toBe(true);
  });
  it('accepts a real ambient module and preserves skipped declaration semantics in project queries', async () => {
    const driver = await project();
    await driver.package('catalog', { types: 'index.d.ts' }, { 'index.d.ts': 'declare module "virtual-book" { export interface Book { title: string } }\ndeclare const invalid: MissingType;' });
    await driver.file('src/book.ts', 'import "catalog"; import type { Book } from "virtual-book"; export type Title = Book;');
    await driver.file('tsconfig.json', '{"compilerOptions":{"skipLibCheck":true,"types":[]},"files":["src/book.ts"]}');
    const result = await new TypeScriptContext(driver.context, { configFile: 'tsconfig.json' }).readSnapshot();
    expect(result.complete).toBe(true); expect(result.problems).toEqual([]);
    const query = new TypeScriptProject({ outputId: 'native', configFile: 'tsconfig.json' }, [{ specId: 'title', locator: { outputId: 'native', format: 'typescript-symbol-1', value: { file: 'src/book.ts', declaration: [{ kind: 'type', name: 'Title' }] } } }]);
    expect(query.read('title', result).problems).toEqual([]);
  });
  it('refuses two demanded hard links as independent native declaration inputs', async () => {
    const driver = await project();
    await driver.package('catalog', { types: 'index.d.ts' }, { 'index.d.ts': 'export type { Book as Left } from "./left.js"; export type { Book as Right } from "./right.js";', 'left.d.ts': 'export interface Book { title: string }' });
    fs.linkSync(driver.path('node_modules/catalog/left.d.ts'), driver.path('node_modules/catalog/right.d.ts'));
    const left = fs.statSync(driver.path('node_modules/catalog/left.d.ts'), { bigint: true }), right = fs.statSync(driver.path('node_modules/catalog/right.d.ts'), { bigint: true });
    expect([left.dev, left.ino]).toEqual([right.dev, right.ino]);
    const result = await new TypeScriptContext(driver.context, { imports: ['catalog'] }).readSnapshot();
    expect(result.complete).toBe(false); expect(result.problems.some(problem => problem.code === 'unsupported-native-input')).toBe(true);
  });
  it('keeps native package augmentations out of owned project definitions', async () => {
    const driver = await project(); await driver.file('src/shop.ts', 'export class Shop { save(): void {} }');
    await driver.package('extension', { types: 'index.d.ts' }, { 'index.d.ts': 'import "../../src/shop.js"; declare module "../../src/shop.js" { interface Shop { external(): void; } } export {};' });
    await driver.file('src/extension.ts', 'import "extension";'); driver.select('shop', 'src/shop.ts', [{ kind: 'class', name: 'Shop' }]);
    const consumer = 'import { Shop } from "./shop.js"; new Shop().external();'; await driver.file('src/manual.ts', consumer);
    await driver.capture(); expect(driver.snapshot.complete).toBe(true); driver.search('shop');
    expect(driver.found.definitions.map(at => (at.value as { file: string }).file)).toEqual(['src/shop.ts']);
    expect(driver.found.incoming.coverage.complete).toBe(true);
    expect(driver.found.incoming.uses.some(use => { const site = use.at.value as { file: string; start: number; end: number }; return site.file === 'src/manual.ts' && consumer.slice(site.start, site.end) === 'external'; })).toBe(true);
    expect(driver.query().read('shop', driver.snapshot).artifacts.every(artifact => artifact.file.path === 'src/shop.ts')).toBe(true);
  });
  it('accepts a declared import branch without acquiring an optional runtime-only require branch', async () => {
    const driver = await project();
    await driver.package('catalog', { type: 'module', exports: { '.': { import: { types: './index.d.mts' }, require: './runtime.cjs' } } }, {
      'index.d.mts': 'export interface Book { title: string }', 'runtime.cjs': 'throw Error("must never execute");',
    });
    const context = new TypeScriptContext(driver.context, { imports: ['catalog'] });
    const result = await context.readSnapshot(); expect(result.problems).toEqual([]); expect(result.complete).toBe(true);
    expect(result.readOnlyFiles?.map(file => file.path)).toEqual(['node_modules/catalog/index.d.mts', 'node_modules/catalog/package.json']);
    await driver.file('src/use.cts', 'import catalog = require("catalog"); export const value = catalog;');
    const unavailable = await context.readSnapshot(); expect(unavailable.complete).toBe(false);
    expect(unavailable.problems.some(problem => ['native-input-unavailable', 'unsupported-native-input'].includes(problem.code))).toBe(true);
    expect(unavailable.readOnlyFiles?.some(file => file.path.endsWith('runtime.cjs'))).toBe(false);
  });
  it('keeps absent and empty dependency evidence compatible with existing project queries', () => {
    const baseline = snapshot(), query = reader();
    expect(query.search('store', baseline)).toEqual(query.search('store', { ...baseline, readOnlyFiles: [] }));
  });
  it('rejects a read-only hash that does not describe the supplied bytes', () => {
    expect(() => reader().read('store', { ...snapshot(), readOnlyFiles: [{ ...book, bytes: Buffer.from('different') }] })).toThrow(TypeError);
  });
  it('rejects duplicate supplemental paths instead of selecting the last declaration', () => {
    expect(() => reader().read('store', { ...snapshot(), readOnlyFiles: [book, book] })).toThrow(TypeError);
  });
  it('rejects dependency bytes disguised as editable project files', () => {
    expect(() => reader().read('store', { ...snapshot(), files: [book] })).toThrow(TypeError);
  });
  it('rejects a captured file that is also a parent of another captured path', () => {
    expect(() => reader().read('store', { ...snapshot(), readOnlyFiles: [file('node_modules/catalog.json', '{}'), file('node_modules/catalog.json-z.json', '{}'), file('node_modules/catalog.json/child.d.ts', 'export {};')] })).toThrow(TypeError);
  });
  it('rejects dependency content outside the installed declaration profile', () => {
    expect(() => reader().read('store', { ...snapshot(), readOnlyFiles: [file('outside/index.d.ts', 'export {};')] })).toThrow(TypeError);
    expect(() => reader().read('store', { ...snapshot(), readOnlyFiles: [file('node_modules/catalog/index.js', 'export {};')] })).toThrow(TypeError);
  });
  it('does not treat an unused supplied declaration as a project root or global input', () => {
    const result = reader().read('store', { ...snapshot(), readOnlyFiles: [file('node_modules/unused/index.d.ts', 'declare const broken: MissingType;')] });
    expect(result.problems).toEqual([]); expect(result.coverage.complete).toBe(true);
  });
  it('does not adopt a read-only declaration through a writable symbol locator', () => {
    const query = new TypeScriptProject({ outputId: 'typescript' }, [{ specId: 'book', locator: { outputId: 'typescript', format: 'typescript-symbol-1', value: { file: book.path, declaration: [{ kind: 'interface', name: 'Book' }] } } }]);
    const result = query.read('book', { ...snapshot(), readOnlyFiles: [book] });
    expect(result.artifacts).toEqual([]); expect(result.problems.some(problem => problem.code === 'missing-project-artifact')).toBe(true); expect(result.coverage.complete).toBe(false);
  });
  it('rejects native case aliases on a case-insensitive host', () => {
    const input = { ...snapshot(), readOnlyFiles: [book, { ...book, path: 'node_modules/CATALOG/index.d.ts' }] };
    if (process.platform === 'win32') expect(() => reader().read('store', input)).toThrow(TypeError);
    else expect(reader().read('store', input).problems).toEqual([]);
  });
  it('constructs without reading a project and captures a copy of import options', async () => {
    const driver = await project(); await driver.package('catalog', { types: 'index.d.ts' }, { 'index.d.ts': 'export interface Book {}' });
    const read = vi.spyOn(driver.context, 'readSnapshot'), imports = ['catalog'];
    const context = new TypeScriptContext(driver.context, { imports }); imports[0] = 'missing';
    expect(read).not.toHaveBeenCalled();
    const captured = await context.readSnapshot(); expect(captured.problems).toEqual([]); expect(captured.readOnlyFiles?.map(file => file.path)).toContain(book.path);
  });
  it('rejects unknown options, duplicate seeds and paths that are not native bare imports', async () => {
    const driver = await project();
    expect(() => new TypeScriptContext(driver.context, { configFile: '../tsconfig.json' })).toThrow(TypeError);
    expect(() => new TypeScriptContext(driver.context, { imports: ['catalog', 'catalog'] })).toThrow(TypeError);
    expect(() => new TypeScriptContext(driver.context, { imports: ['../catalog'] })).toThrow(TypeError);
    expect(() => new TypeScriptContext(driver.context, { imports: ['https://example.invalid/catalog'] })).toThrow(TypeError);
    expect(() => new TypeScriptContext(driver.context, { future: true } as never)).toThrow(TypeError);
    expect(() => new TypeScriptContext(driver.context, [] as never)).toThrow(TypeError);
  });
  it('returns an unsupported snapshot when a normal connector includes installed packages as editable files', async () => {
    const driver = await project(), captured = await driver.context.readSnapshot();
    const context = { root: captured.root, readSnapshot: async () => ({ ...captured, excludeNames: [], files: [...captured.files, book] }) };
    const result = await new TypeScriptContext(context).readSnapshot();
    expect(result.complete).toBe(false); expect(result.problems.some(problem => problem.code === 'unsupported-native-input')).toBe(true);
    expect(result.files).toContainEqual(expect.objectContaining({ path: book.path }));
  });
  it('reports an explicitly outside-root native import as unsupported without reading it', async () => {
    const driver = await project(); await driver.file('src/store.ts', 'import type { Book } from "../../outside.js"; export type Title = Book["title"];');
    await driver.file('../outside.d.ts', 'export interface Book { title: string }');
    const read = fs.readFileSync.bind(fs);
    const spy = vi.spyOn(fs, 'readFileSync').mockImplementation(((path: fs.PathOrFileDescriptor, ...args: unknown[]) => {
      if (String(path) === driver.path('../outside.d.ts')) throw Error('Outside declaration must not be read.');
      return Reflect.apply(read, fs, [path, ...args]);
    }) as typeof fs.readFileSync);
    const result = await new TypeScriptContext(driver.context).readSnapshot();
    expect(result.complete).toBe(false); expect(result.problems.some(problem => problem.code === 'unsupported-native-input')).toBe(true);
    expect(spy.mock.calls.some(call => String(call[0]) === driver.path('../outside.d.ts'))).toBe(false);
  });
  it('keeps a finally missing native config incomplete', async () => {
    const driver = await project(); await driver.file('store.ts', 'export class Store {}');
    const result = await new TypeScriptContext(driver.context, { configFile: 'missing.json' }).readSnapshot();
    expect(result.complete).toBe(false); expect(result.problems.some(problem => problem.code === 'native-input-unavailable' && problem.message.includes('configured'))).toBe(true);
  });
  it('does not accept changed bytes while a selected declaration is read', async () => {
    const driver = await project(); await driver.package('catalog', { types: 'index.d.ts' }, { 'index.d.ts': 'export interface Book {}' });
    const open = fs.openSync.bind(fs), read = fs.readFileSync.bind(fs); let selected: number | undefined;
    vi.spyOn(fs, 'openSync').mockImplementation(((path: fs.PathLike, ...args: unknown[]) => { const handle = Reflect.apply(open, fs, [path, ...args]); if (String(path) === driver.path(book.path)) selected = handle; return handle; }) as typeof fs.openSync);
    vi.spyOn(fs, 'readFileSync').mockImplementation(((path: fs.PathOrFileDescriptor, ...args: unknown[]) => {
      const bytes = Reflect.apply(read, fs, [path, ...args]);
      if (path === selected) { selected = undefined; fs.writeFileSync(driver.path(book.path), 'export interface ChangedBook {}'); }
      return bytes;
    }) as typeof fs.readFileSync);
    const result = await new TypeScriptContext(driver.context, { imports: ['catalog'] }).readSnapshot();
    expect(result.complete).toBe(false); expect(result.problems.some(problem => problem.code === 'stale-project')).toBe(true);
  });
  it('observes a newly appearing higher-priority declaration candidate during acquisition', async () => {
    const driver = await project(); await driver.package('catalog', { types: 'index.d.ts' }, { 'index.d.ts': 'export type { Book } from "./book";', 'book/index.d.ts': 'export interface Book {}' });
    const open = fs.openSync.bind(fs), read = fs.readFileSync.bind(fs); let selected: number | undefined, changed = false;
    vi.spyOn(fs, 'openSync').mockImplementation(((path: fs.PathLike, ...args: unknown[]) => { const handle = Reflect.apply(open, fs, [path, ...args]); if (String(path) === driver.path('node_modules/catalog/book/index.d.ts')) selected = handle; return handle; }) as typeof fs.openSync);
    vi.spyOn(fs, 'readFileSync').mockImplementation(((path: fs.PathOrFileDescriptor, ...args: unknown[]) => {
      const bytes = Reflect.apply(read, fs, [path, ...args]);
      if (path === selected) { selected = undefined; changed = true; fs.writeFileSync(driver.path('node_modules/catalog/book.d.ts'), 'export interface Book { changed: true }'); }
      return bytes;
    }) as typeof fs.readFileSync);
    const result = await new TypeScriptContext(driver.context, { imports: ['catalog'] }).readSnapshot();
    expect(changed).toBe(true); expect(result.complete).toBe(false); expect(result.problems.some(problem => problem.code === 'stale-project')).toBe(true);
  });
  it('refuses a replacement root even when its source bytes are identical', async () => {
    const driver = await project(); await driver.file('store.ts', 'export class Store {}'); let replaced = false;
    const context = new TypeScriptContext({ root: driver.context.root, readSnapshot: async () => {
      const result = await driver.context.readSnapshot();
      if (!replaced) { replaced = true; fs.renameSync(driver.root, driver.path('../old')); fs.mkdirSync(driver.root); fs.writeFileSync(driver.path('store.ts'), 'export class Store {}'); }
      return result;
    } });
    const result = await context.readSnapshot(); expect(result.complete).toBe(false); expect(result.problems.some(problem => problem.code === 'stale-project')).toBe(true);
  });
  it('keeps previously supplied valid evidence and rejects its changed installed bytes', async () => {
    const driver = await project(); await driver.package('catalog', { types: 'index.d.ts' }, { 'index.d.ts': 'export interface Book {}' });
    const first = await new TypeScriptContext(driver.context, { imports: ['catalog'] }).readSnapshot();
    const decorated = { root: driver.context.root, readSnapshot: async () => ({ ...await driver.context.readSnapshot(), readOnlyFiles: first.readOnlyFiles! }) };
    expect((await new TypeScriptContext(decorated).readSnapshot()).complete).toBe(true);
    await driver.file(book.path, 'export interface NewBook {}');
    const result = await new TypeScriptContext(decorated).readSnapshot(); expect(result.complete).toBe(false); expect(result.problems.some(problem => problem.code === 'stale-project')).toBe(true);
  });
  it('protects uncaptured and nested package paths even with a misleading exclusion list', async () => {
    const driver = await project(), baseline = { ...await driver.context.readSnapshot(), excludeNames: [] };
    for (const path of ['node_modules/unseen/index.d.ts', 'vendor/node_modules/unseen/index.d.ts']) {
      const result = await new FileProjectWriter({ root: baseline.root, readSnapshot: async () => baseline }).apply({ basedOn: baseline, changes: [{ kind: 'write', path, bytes: Buffer.from('export {};') }] });
      expect(result.status).toBe('stopped'); expect(result.problems.some(problem => problem.code === 'invalid-change')).toBe(true); expect(fs.existsSync(driver.path(path))).toBe(false);
    }
  });
});
