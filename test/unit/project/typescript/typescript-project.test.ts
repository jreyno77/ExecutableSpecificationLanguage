import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TypeScriptProject, type ArtifactAssociation, type ProjectSnapshot, type ProjectSearch } from '../../../../src/index.js';

const snapshot = (files: Record<string, string | Uint8Array>): ProjectSnapshot => ({ root: { path: process.cwd(), identity: 'captured-root' },
  complete: true, problems: [], excludeNames: [], excluded: [], files: Object.entries(files).map(([path, text]) => {
    const bytes = typeof text === 'string' ? new TextEncoder().encode(text) : text;
    return { path, bytes, version: createHash('sha256').update(bytes).digest('hex') };
  }) });
const association = (id: string, file: string, declaration: { kind: string; name: string; static?: boolean }[]): ArtifactAssociation => ({ specId: id,
  locator: { outputId: 'typescript', format: 'typescript-symbol-1', value: { file, declaration } } });
const subject = association('store', 'store.ts', [{ kind: 'class', name: 'Store' }]);
const query = (files: Record<string, string>, associations: ArtifactAssociation[] = [subject], id = 'store', configFile?: string): ProjectSearch =>
  new TypeScriptProject({ outputId: 'typescript', ...(configFile ? { configFile } : {}) }, associations).search(id, snapshot(files));
const nativeQuery = (files: Record<string, string>): ProjectSearch => {
  const captured = snapshot(files);
  return new TypeScriptProject({ outputId: 'typescript', configFile: 'tsconfig.json' }, [subject]).search('store', { ...captured,
    files: captured.files.filter(file => !file.path.startsWith('node_modules/')), readOnlyFiles: captured.files.filter(file => file.path.startsWith('node_modules/')) });
};
const texts = (result: ProjectSearch, files: Record<string, string>, direction: 'incoming' | 'outgoing'): string[] => result[direction].uses.map(use => {
  const site = use.at.value as { file: string; start: number; end: number }; return files[site.file]!.slice(site.start, site.end);
});

describe('exact TypeScript project inputs and selectors', () => {
  it('rejects unsafe paths, malformed selectors and duplicate locators', () => {
    expect(() => new TypeScriptProject({ outputId: '' }, [])).toThrow(TypeError);
    expect(() => new TypeScriptProject({ outputId: 'typescript', configFile: '../tsconfig.json' }, [])).toThrow(TypeError);
    expect(() => new TypeScriptProject({ outputId: 'typescript' }, [association('store', 'src\\store.ts', [{ kind: 'class', name: 'Store' }])])).toThrow(TypeError);
    expect(() => new TypeScriptProject({ outputId: 'typescript' }, [subject, subject])).toThrow(TypeError);
    expect(() => new TypeScriptProject({ outputId: 'typescript' }, [association('save', 'store.ts', [{ kind: 'class', name: 'Store' }, { kind: 'method', name: 'save' }])])).toThrow(TypeError);
    expect(() => new TypeScriptProject({ outputId: 'typescript' }, [association('store', 'store.ts', [{ kind: 'class', name: 'Store', static: false }])])).toThrow(TypeError);
  });
  it('keeps unknown identities and other output namespaces unassociated', () => {
    const result = query({ 'store.ts': 'export class Store {}' }, [{ ...subject, locator: { ...subject.locator, outputId: 'markdown' } }]);
    expect(result.problems.map(problem => problem.code)).toContain('unassociated-subject'); expect(result.definitions).toEqual([]);
  });
  it('retains unsupported target locators instead of guessing a declaration', () => {
    const result = query({ 'store.ts': 'export class Store {}' }, [{ specId: 'store', locator: { outputId: 'typescript', format: 'future-1', value: { file: 'store.ts' } } }]);
    expect(result.problems.map(problem => problem.code)).toContain('unsupported-project-locator'); expect(result.definitions).toEqual([]);
  });
  it('rejects contradictory and unsafe snapshots while accepting changed bytes with captured version provenance', () => {
    const reader = new TypeScriptProject({ outputId: 'typescript' }, [subject]), valid = snapshot({ 'store.ts': 'export class Store {}' });
    expect(() => reader.read('store', { ...valid, complete: false })).toThrow(TypeError);
    expect(() => reader.read('store', { ...valid, files: [valid.files[0]!, valid.files[0]!] })).toThrow(TypeError);
    expect(() => reader.read('store', { ...valid, files: [{ ...valid.files[0]!, path: '../store.ts' }] })).toThrow(TypeError);
    const changed = { ...valid, files: [{ ...valid.files[0]!, bytes: new TextEncoder().encode('export class Renamed {}') }] };
    const result = reader.read('store', changed);
    expect(result.artifacts[0]?.file.version).toBe(valid.files[0]!.version);
    expect(result.problems.map(problem => problem.code)).toContain('missing-project-symbol');
  });
  it('owns association data after construction', () => {
    const copied = structuredClone(subject), reader = new TypeScriptProject({ outputId: 'typescript' }, [copied]);
    Object.assign(copied.locator.value as object, { file: 'renamed.ts' });
    expect(reader.search('store', snapshot({ 'store.ts': 'export class Store {}' })).definitions).toHaveLength(1);
  });
  it('retains invalid UTF-8 bytes as a readable artifact with an explicit semantic gap', () => {
    const bytes = Uint8Array.from([0xff, 0xfe]), reader = new TypeScriptProject({ outputId: 'typescript' }, [subject]);
    const read = reader.read('store', snapshot({ 'store.ts': bytes }));
    expect(Array.from(read.artifacts[0]!.file.bytes)).toEqual([255, 254]);
    expect(read.problems.map(problem => problem.code)).toContain('invalid-project-encoding'); expect(read.coverage.complete).toBe(false);
  });
  it('does not walk a nested namesake while selecting a top-level declaration', () => {
    const result = query({ 'store.ts': 'export namespace Nested { export class Store {} }' });
    expect(result.problems.map(problem => problem.code)).toContain('missing-project-symbol'); expect(result.definitions).toEqual([]);
  });
  it('does not cross an anonymous function to satisfy a top-level selector', () => {
    const result = query({ 'store.ts': 'export default function() { class Store {} return Store; }' });
    expect(result.definitions).toEqual([]); expect(result.problems.map(problem => problem.code)).toContain('missing-project-symbol');
  });
  it('does not cross a block scope to satisfy a top-level selector', () => {
    const result = query({ 'store.ts': '{ class Store {} }' });
    expect(result.definitions).toEqual([]); expect(result.problems.map(problem => problem.code)).toContain('missing-project-symbol');
  });
  it('does not cross an arrow function to satisfy a top-level selector', () => {
    const result = query({ 'store.ts': 'export const factory = () => { class Store {} return Store; };' });
    expect(result.definitions).toEqual([]); expect(result.problems.map(problem => problem.code)).toContain('missing-project-symbol');
  });
  it('selects an explicit parameter property through its native class ownership', () => {
    const source = 'export class Store { constructor(public title: string) {} }\nconst store = new Store("Dune"); store.title;';
    const result = query({ 'store.ts': source }, [association('title', 'store.ts', [{ kind: 'class', name: 'Store' }, { kind: 'property', name: 'title', static: false }])], 'title');
    expect(result.problems).toEqual([]); expect(result.definitions).toHaveLength(1);
    const site = result.definitions[0]!.value as { start: number; end: number };
    expect(source.slice(site.start, site.end)).toBe('public title: string');
    expect(texts(result, { 'store.ts': source }, 'incoming')).toEqual(['title']);
  });
  it('does not turn an ordinary constructor parameter into a class property', () => {
    const result = query({ 'store.ts': 'export class Store { constructor(title: string) { title.trim(); } }' }, [association('title', 'store.ts', [{ kind: 'class', name: 'Store' }, { kind: 'property', name: 'title', static: false }])], 'title');
    expect(result.definitions).toEqual([]); expect(result.problems.map(problem => problem.code)).toContain('missing-project-symbol');
  });
  it('selects one comma-separated or destructured variable binding', () => {
    const files = { 'store.ts': 'export const a = 1, b = 2;\nexport const { title, copies } = { title: "Dune", copies: 1 };\nexport const value = b + copies;' };
    for (const name of ['b', 'copies']) {
      const result = query(files, [association(name, 'store.ts', [{ kind: 'variable', name }])], name);
      expect(result.definitions).toHaveLength(1); expect(texts(result, files, 'incoming')).toEqual([name]);
    }
  });
  it('selects a literal computed method and keeps a dynamic member lookup unresolved', () => {
    const files = { 'store.ts': 'export class Store { ["save"]() {} }\nconst store = new Store(); store["save"]();\nexport function invoke(name: string) { return store[name as "save"](); }' };
    const result = query(files, [association('save', 'store.ts', [{ kind: 'class', name: 'Store' }, { kind: 'method', name: 'save', static: false }])], 'save');
    expect(texts(result, files, 'incoming')).toContain('"save"');
    expect(result.incoming.unresolved).toContainEqual(expect.objectContaining({ reason: expect.stringContaining('Computed') }));
    expect(result.incoming.coverage.complete).toBe(false);
  });
  it('retains native duplicate errors rather than certifying declarations as valid merging', () => {
    const result = query({ 'store.ts': 'export class Store {}\nexport class Store {}' });
    expect(result.problems.some(problem => problem.code === 'typescript-2300')).toBe(true); expect(result.incoming.coverage.complete).toBe(false);
  });
  it('observes an indexed-access type property without treating an unrelated literal type as a reference', () => {
    const files = { 'store.ts': 'export class Store { title = "Dune"; }\nexport type Title = Store["title"];\nexport type Other = "title";' };
    const associations = [association('property', 'store.ts', [{ kind: 'class', name: 'Store' }, { kind: 'property', name: 'title', static: false }]),
      association('title', 'store.ts', [{ kind: 'type', name: 'Title' }]), association('other', 'store.ts', [{ kind: 'type', name: 'Other' }])];
    const incoming = query(files, associations, 'property'), outgoing = query(files, associations, 'title'), other = query(files, associations, 'other');
    expect(incoming.problems).toEqual([]); expect(texts(incoming, files, 'incoming')).toEqual(['"title"']);
    expect(incoming.incoming.uses[0]?.at.value).toMatchObject({ role: 'type', start: files['store.ts'].indexOf('["title"]') + 1 });
    expect(outgoing.outgoing.uses).toContainEqual(expect.objectContaining({ target: { kind: 'specified', id: 'property' } }));
    expect(other.outgoing.uses).toEqual([]); expect(other.outgoing.unresolved).toEqual([]);
    expect(incoming.incoming.coverage.complete).toBe(true); expect(outgoing.outgoing.coverage.complete).toBe(true);
  });
  it('keeps an instantiated generic union member linked to its single original declaration', () => {
    const files = { 'store.ts': 'export interface Box<T> { value: T }\nexport function read(box: Box<string> | Box<number>) { const { value } = box; return box.value; }' };
    const associations = [association('value', 'store.ts', [{ kind: 'interface', name: 'Box' }, { kind: 'property', name: 'value' }]),
      association('read', 'store.ts', [{ kind: 'function', name: 'read' }])];
    const result = query(files, associations, 'read');
    const starts = [files['store.ts'].indexOf('{ value }') + 2, files['store.ts'].lastIndexOf('value')];
    expect(result.problems).toEqual([]); expect(result.outgoing.unresolved).toEqual([]);
    expect(result.outgoing.uses.filter(use => (use.at.value as { role: string }).role === 'value').map(use => ({
      target: use.target, start: (use.at.value as { start: number }).start,
    }))).toEqual(starts.map(start => ({ target: { kind: 'specified', id: 'value' }, start })));
    expect(result.outgoing.coverage.complete).toBe(true);
  });
  it('does not choose one declaration for an intersection member with distinct native roots', () => {
    const files = { 'store.ts': 'export interface A { title: string }\nexport interface B { title: string }\nexport function read(value: A & B) { return value.title; }' };
    const associations = [association('a-title', 'store.ts', [{ kind: 'interface', name: 'A' }, { kind: 'property', name: 'title' }]),
      association('b-title', 'store.ts', [{ kind: 'interface', name: 'B' }, { kind: 'property', name: 'title' }]),
      association('read', 'store.ts', [{ kind: 'function', name: 'read' }])];
    const result = query(files, associations, 'read');
    expect(result.problems).toEqual([]);
    expect(result.outgoing.uses.filter(use => (use.at.value as { role: string }).role === 'value')).toEqual([]);
    expect(result.outgoing.unresolved).toContainEqual(expect.objectContaining({
      at: expect.objectContaining({ value: expect.objectContaining({ start: files['store.ts'].lastIndexOf('title'), end: files['store.ts'].length - 3 }) }),
    }));
    expect(result.outgoing.coverage.complete).toBe(false);
  });
  it('keeps ambiguous destructured intersection properties unresolved without confusing their local binding', () => {
    const files = { 'store.ts': 'export interface A { title: string }\nexport interface B { title: string }\nexport function read(value: A & B) { const { title } = value; return title; }' };
    const result = query(files, [association('read', 'store.ts', [{ kind: 'function', name: 'read' }])], 'read');
    expect(result.problems).toEqual([]);
    expect(result.outgoing.uses.filter(use => (use.at.value as { role: string }).role === 'value')).toEqual([]);
    expect(result.outgoing.unresolved).toHaveLength(1);
    const at = result.outgoing.unresolved[0]!.at.value as { start: number; end: number };
    expect(files['store.ts'].slice(at.start, at.end)).toBe('title'); expect(at.start).toBe(files['store.ts'].indexOf('{ title }') + 2);
    expect(result.outgoing.coverage.complete).toBe(false);
  });
  it('observes numeric literal method calls in both relationship directions', () => {
    const files = { 'store.ts': 'export class Store { [0]() {} }\nexport function invoke(store: Store) { store[0](); }' };
    const associations = [association('zero', 'store.ts', [{ kind: 'class', name: 'Store' }, { kind: 'method', name: '0', static: false }]),
      association('invoke', 'store.ts', [{ kind: 'function', name: 'invoke' }])];
    const incoming = query(files, associations, 'zero'), outgoing = query(files, associations, 'invoke');
    expect(incoming.problems).toEqual([]); expect(texts(incoming, files, 'incoming')).toEqual(['0']);
    expect(incoming.incoming.uses[0]?.at.value).toMatchObject({ role: 'call', start: files['store.ts'].lastIndexOf('0') });
    expect(outgoing.outgoing.uses).toContainEqual(expect.objectContaining({ target: { kind: 'specified', id: 'zero' } }));
    expect(incoming.incoming.coverage.complete).toBe(true); expect(outgoing.outgoing.coverage.complete).toBe(true);
  });
  it('retains an outgoing read of another class parameter property', () => {
    const files = { 'store.ts': 'export class Store { constructor(public title: string) {} }\nexport class Reader { read(store: Store) { return store.title; } }' };
    const associations = [subject, association('title', 'store.ts', [{ kind: 'class', name: 'Store' }, { kind: 'property', name: 'title', static: false }]),
      association('reader', 'store.ts', [{ kind: 'class', name: 'Reader' }])];
    const result = query(files, associations, 'reader');
    expect(result.problems).toEqual([]);
    expect(result.outgoing.uses).toContainEqual(expect.objectContaining({ target: { kind: 'specified', id: 'title' },
      at: expect.objectContaining({ value: expect.objectContaining({ start: files['store.ts'].lastIndexOf('title'), role: 'value' }) }) }));
    expect(result.outgoing.coverage.complete).toBe(true);
  });
  it('observes shorthand and renamed destructuring as reads of their native source property', () => {
    const files = { 'store.ts': 'export class Store { title = "Dune"; }\nexport function read(store: Store) { const { title } = store; const { title: renamed } = store; return title + renamed; }' };
    const associations = [association('title', 'store.ts', [{ kind: 'class', name: 'Store' }, { kind: 'property', name: 'title', static: false }]),
      association('read', 'store.ts', [{ kind: 'function', name: 'read' }])];
    const incoming = query(files, associations, 'title'), outgoing = query(files, associations, 'read');
    const starts = [files['store.ts'].indexOf('{ title }') + 2, files['store.ts'].indexOf('{ title:') + 2];
    expect(incoming.problems).toEqual([]); expect(texts(incoming, files, 'incoming')).toEqual(['title', 'title']);
    expect(incoming.incoming.uses.map(use => (use.at.value as { start: number }).start)).toEqual(starts);
    expect(outgoing.outgoing.uses.filter(use => use.target.kind === 'specified' && use.target.id === 'title')
      .map(use => (use.at.value as { start: number }).start)).toEqual(starts);
    expect(incoming.incoming.coverage.complete).toBe(true); expect(outgoing.outgoing.coverage.complete).toBe(true);
  });
  it('does not invent an implicit constructor facet', () => {
    const result = query({ 'store.ts': 'export class Store {}' }, [association('constructor', 'store.ts', [{ kind: 'class', name: 'Store' }, { kind: 'constructor', name: 'constructor' }])], 'constructor');
    expect(result.definitions).toEqual([]); expect(result.problems.map(problem => problem.code)).toContain('missing-project-symbol');
  });
  it('collects explicit constructor overloads and native super/new calls without class-type references', () => {
    const files = { 'store.ts': 'export class Store { constructor(value: string); constructor(value: number); constructor(value: string | number) {} }\nexport class Special extends Store { constructor() { super("Dune"); } }\nexport const store: Store = new Store(1);' };
    const result = query(files, [association('constructor', 'store.ts', [{ kind: 'class', name: 'Store' }, { kind: 'constructor', name: 'constructor' }])], 'constructor');
    expect(result.definitions).toHaveLength(3); expect(texts(result, files, 'incoming')).toEqual(['super', 'Store']);
  });
  it('treats separate explicitly associated symbols as internal fragments of one subject', () => {
    const files = { 'store.ts': 'export class Store { helper = new Storage(); }\nexport class Storage {}' };
    const result = query(files, [subject, association('store', 'store.ts', [{ kind: 'class', name: 'Storage' }])]);
    expect(result.definitions).toHaveLength(2); expect(result.outgoing.uses).toEqual([]);
  });
  it('retains a default re-export as an export occurrence', () => {
    const files = { 'store.ts': 'export class Store {}', 'index.ts': 'import { Store } from "./store.js"; export default Store;' }, result = query(files);
    expect(result.incoming.uses).toContainEqual(expect.objectContaining({ at: expect.objectContaining({ value: expect.objectContaining({ file: 'index.ts', role: 'export', start: files['index.ts'].lastIndexOf('Store') }) }) }));
  });
  it('observes the native value behind a shorthand object property', () => {
    const files = { 'store.ts': 'export class Storage {}\nexport function create() { return { Storage }; }' };
    const result = query(files, [association('create', 'store.ts', [{ kind: 'function', name: 'create' }]), association('storage', 'store.ts', [{ kind: 'class', name: 'Storage' }])], 'create');
    expect(result.outgoing.uses).toContainEqual(expect.objectContaining({ target: { kind: 'specified', id: 'storage' },
      at: expect.objectContaining({ value: expect.objectContaining({ start: files['store.ts'].lastIndexOf('Storage'), role: 'value' }) }) }));
  });
  it('includes actual enum member uses in a query for the enum', () => {
    const files = { 'store.ts': 'export enum State { Ready, Saved }\nexport const state = State.Ready;' };
    const result = query(files, [association('state', 'store.ts', [{ kind: 'enum', name: 'State' }])], 'state');
    expect(texts(result, files, 'incoming')).toContain('Ready');
  });
});

describe('captured native configuration and honest reference coverage', () => {
  it('keeps native UTF-16 offsets against BOM-prefixed original source bytes', () => {
    const source = '\uFEFFconst title = "📚";\nexport class Store {}\nnew Store();';
    const result = query({ 'store.ts': source });
    const definition = result.definitions[0]!.value as { start: number; end: number };
    expect(source.slice(definition.start, definition.end)).toBe('export class Store {}');
    expect(definition.start).toBe(source.indexOf('export class Store'));
    const use = result.incoming.uses.find(item => (item.at.value as { role: string }).role === 'construct')!.at.value as { start: number; end: number };
    expect(source.slice(use.start, use.end)).toBe('Store'); expect(use.start).toBe(source.lastIndexOf('Store'));
  });
  it('resolves a captured package-based extends and package exports', () => {
    const files = { 'tsconfig.json': '{"extends":"settings/base.json","files":["store.ts"]}',
      'node_modules/settings/package.json': '{"name":"settings"}', 'node_modules/settings/base.json': '{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext"}}',
      'node_modules/storage/package.json': '{"name":"storage","exports":{".":{"types":"./types.d.ts"}}}',
      'node_modules/storage/types.d.ts': 'export declare class Storage {}',
      'store.ts': 'import { Storage } from "storage"; export class Store { storage = new Storage(); }' };
    const result = nativeQuery(files);
    expect(result.problems).toEqual([]); expect(result.outgoing.uses.some(use => use.target.kind === 'project')).toBe(true);
  });
  it('reports missing extended configuration rather than silently completing', () => {
    const result = query({ 'tsconfig.json': '{"extends":"./missing.json","files":["store.ts"]}', 'store.ts': 'export class Store {}' }, [subject], 'store', 'tsconfig.json');
    expect(result.problems.some(problem => problem.code.startsWith('typescript-'))).toBe(true); expect(result.incoming.coverage.complete).toBe(false);
  });
  it('admits JavaScript only through actual allowJs configuration', () => {
    const files = { 'tsconfig.json': '{"compilerOptions":{"allowJs":true,"target":"ES2022"},"files":["store.ts","run.js"]}',
      'store.ts': 'export class Store {}', 'run.js': 'import { Store } from "./store.js"; new Store();' };
    const configured = query(files, [subject], 'store', 'tsconfig.json'), defaulted = query(files);
    expect(texts(configured, files, 'incoming')).toContain('Store'); expect(defaulted.incoming.uses).toEqual([]);
  });
  it('loads explicitly captured typeRoots without an ambient type package', () => {
    const result = query({ 'tsconfig.json': '{"compilerOptions":{"typeRoots":["./types"],"types":["catalog"]},"files":["store.ts"]}',
      'types/catalog/index.d.ts': 'declare interface Book { title: string }', 'store.ts': 'export class Store { read(book: Book) { return book.title; } }' }, [subject], 'store', 'tsconfig.json');
    expect(result.problems).toEqual([]);
  });
  it('retains plugin configuration as unsupported without executing it', () => {
    const result = query({ 'tsconfig.json': '{"compilerOptions":{"plugins":[{"name":"never-execute"}]},"files":["store.ts"]}', 'store.ts': 'export class Store {}' }, [subject], 'store', 'tsconfig.json');
    expect(result.problems.map(problem => problem.code)).toContain('unsupported-project-config'); expect(result.definitions).toHaveLength(1);
  });
  it('discovers configured ambient type packages from captured node_modules', () => {
    const files = { 'tsconfig.json': '{"compilerOptions":{"target":"ES2022"},"files":["store.ts"]}',
      'node_modules/@types/catalog/package.json': '{"name":"@types/catalog","types":"index.d.ts"}',
      'node_modules/@types/catalog/index.d.ts': 'declare interface Book { title: string }',
      'store.ts': 'export class Store { read(book: Book) { return book.title; } }' };
    const result = nativeQuery(files);
    expect(result.problems).toEqual([]); expect(result.outgoing.coverage.complete).toBe(true);
    expect(result.outgoing.coverage.scope).toContainEqual(expect.objectContaining({ format: 'typescript-native-file-1', value: expect.objectContaining({ file: 'node_modules/@types/catalog/index.d.ts', version: createHash('sha256').update(files['node_modules/@types/catalog/index.d.ts']).digest('hex') }) }));
  });
  it('discovers packages under configured typeRoots without a manual types list', () => {
    const result = query({ 'tsconfig.json': '{"compilerOptions":{"typeRoots":["./types"]},"files":["store.ts"]}',
      'types/catalog/index.d.ts': 'declare interface Book { title: string }',
      'store.ts': 'export class Store { read(book: Book) { return book.title; } }' }, [subject], 'store', 'tsconfig.json');
    expect(result.problems).toEqual([]); expect(result.outgoing.coverage.complete).toBe(true);
  });
  it('honors an explicit empty types list instead of automatically discovering captured packages', () => {
    const result = nativeQuery({ 'tsconfig.json': '{"compilerOptions":{"types":[]},"files":["store.ts"]}',
      'node_modules/@types/catalog/index.d.ts': 'declare interface Book { title: string }',
      'store.ts': 'export class Store { read(book: Book) { return book.title; } }' });
    expect(result.problems.map(problem => problem.code)).toContain('typescript-2304');
    expect(result.outgoing.coverage.scope).not.toContainEqual(expect.objectContaining({ format: 'typescript-native-file-1', value: expect.objectContaining({ file: 'node_modules/@types/catalog/index.d.ts' }) }));
  });
  it('retains unresolved values and their exact native cause', () => {
    const files = { 'store.ts': 'export class Store { save() { return missing(); } }' }, result = query(files);
    expect(result.problems.map(problem => problem.code)).toContain('typescript-2304');
    expect(result.outgoing.unresolved).toContainEqual(expect.objectContaining({ at: expect.objectContaining({ value: expect.objectContaining({ start: files['store.ts'].indexOf('missing'), end: files['store.ts'].indexOf('missing') + 7 }) }) }));
  });
  it('orders observations independently of association or capture order', () => {
    const files = { 'store.ts': 'export class Store {}', 'b.ts': 'import { Store } from "./store.js"; export const b = new Store();', 'a.ts': 'import { Store } from "./store.js"; export const a = new Store();' };
    const a = association('a', 'a.ts', [{ kind: 'variable', name: 'a' }]);
    expect(query(files, [subject, a])).toEqual(query(Object.fromEntries(Object.entries(files).reverse()), [a, subject]));
  });
});
