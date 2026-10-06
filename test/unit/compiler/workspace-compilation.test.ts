import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Compiler, ExternalModel, LangiumModel, LangiumReader, QueryInspection, SourceComposer, SpecificationIdentity,
  type ModuleLocator, type ModuleModel, type Resolution, type ResolutionDependencies } from '../../../src/index.js';

function source(locator: string, text: string, sourceId = locator + '.expec'): ModuleModel {
  const read = new LangiumReader().read({ sourceId, text });
  if (read.status !== 'accepted') throw Error(JSON.stringify(read.diagnostics));
  return new LangiumModel(locator, read.document);
}
const row = (entry: ModuleModel, modules: ModuleModel[] = [], packages: ResolutionDependencies['packages'] = []) => ({ entry, dependencies: { modules, packages } });
const at = (...path: (string | number)[]) => ({ kind: 'dependency', path });
function rejected(result: Resolution, path: (string | number)[], related?: (string | number)[]) {
  expect(result.problems).toContainEqual(expect.objectContaining({ code: 'invalid-dependency-input', at: at(...path),
    ...(related ? { related: expect.arrayContaining([at(...related)]) } : {}) }));
  expect(new Compiler().compile({ resolution: result }).value).toBeUndefined();
}

describe('workspace composition input contracts', () => {
  it('requires at least one selected entry', () => {
    expect(() => new SourceComposer().compose([])).toThrow(TypeError);
  });
  it('rejects a missing row instead of inventing an empty source', () => {
    expect(() => new SourceComposer().compose([null] as never)).toThrow(TypeError);
  });
  it('requires supplied module and package arrays', () => {
    const entry = source('game', 'concept Game {}');
    expect(() => new SourceComposer().compose([{ entry, dependencies: { packages: [] } }] as never)).toThrow(TypeError);
    expect(() => new SourceComposer().compose([{ entry, dependencies: { modules: [] } }] as never)).toThrow(TypeError);
  });
  it('requires a complete module collaborator rather than only a locator', () => {
    expect(() => new SourceComposer().compose([row({ locator: 'game' } as ModuleModel)])).toThrow(TypeError);
  });
  it('requires package aliases with actual phase arrays', () => {
    expect(() => new SourceComposer().compose([row(source('game', 'concept Game {}'), [], [{ alias: 'vite' }] as never)])).toThrow(TypeError);
  });
  it('rejects a selected root repeated across input rows', () => {
    const game = source('game', 'concept Game {}');
    rejected(new SourceComposer().compose([row(game), row(game)]),
      ['entries', 1, 'entry', 'locator'], ['entries', 0, 'entry', 'locator']);
  });
  it('retains the single-row duplicate rule even for the same captured model', () => {
    const game = source('game', 'concept Game {}');
    rejected(new SourceComposer().compose([row(game, [game])]),
      ['entries', 0, 'dependencies', 'modules', 0, 'locator'], ['entries', 0, 'entry', 'locator']);
  });
  it('retains duplicate dependency indexes after the model was seen in an earlier row', () => {
    const a = source('a', 'concept A {}'), b = source('b', 'concept B {}'), shared = source('shared', 'type Shared {}');
    rejected(new SourceComposer().compose([row(a, [shared]), row(b, [shared, shared])]),
      ['entries', 1, 'dependencies', 'modules', 1, 'locator'], ['entries', 0, 'dependencies', 'modules', 0, 'locator']);
  });
  it('does not accept separately captured unused models with one locator', () => {
    const result = new SourceComposer().compose([
      row(source('z', 'concept Z {}'), [source('unused', 'type Shared {}', 'one.expec')]),
      row(source('a', 'concept A {}'), [source('unused', 'type Shared {}', 'two.expec')]),
    ]);
    rejected(result, ['entries', 1, 'dependencies', 'modules', 0, 'locator'], ['entries', 0, 'dependencies', 'modules', 0, 'locator']);
    expect(result.entry).toBe('a');
  });
  it('preserves caller row indexes when an earlier-sorted root has a duplicate source identity', () => {
    const result = new SourceComposer().compose([
      row(source('z', 'concept Z {}', 'shared.expec')), row(source('a', 'concept A {}', 'shared.expec')),
    ]);
    rejected(result, ['entries', 1, 'entry', 'locator'], ['entries', 0, 'entry', 'locator']);
  });
  it('refuses an omitted alias rather than sharing another entry authorization', () => {
    const result = new SourceComposer().compose([
      row(source('z', 'concept Z {}'), [], [{ alias: 'vite', phases: ['build'] }]), row(source('a', 'concept A {}')),
    ]);
    rejected(result, ['entries', 1, 'dependencies', 'packages'], ['entries', 0, 'dependencies', 'packages', 0, 'alias']);
  });
  it('locates a package alias supplied only by a later row', () => {
    const result = new SourceComposer().compose([
      row(source('z', 'concept Z {}')), row(source('a', 'concept A {}'), [], [{ alias: 'vite', phases: ['build'] }]),
    ]);
    rejected(result, ['entries', 1, 'dependencies', 'packages', 0, 'alias'], ['entries', 0, 'dependencies', 'packages']);
  });
  it('reports duplicate package aliases in the first caller catalog', () => {
    const result = new SourceComposer().compose([row(source('z', 'concept Z {}'), [], [
      { alias: 'vite', phases: ['build'] }, { alias: 'vite', phases: ['test'] },
    ]), row(source('a', 'concept A {}'))]);
    rejected(result, ['entries', 0, 'dependencies', 'packages', 1, 'alias'], ['entries', 0, 'dependencies', 'packages', 0, 'alias']);
  });
  it('retains repeated phases in later catalogs as invalid authored facts', () => {
    const result = new SourceComposer().compose([row(source('z', 'concept Z {}')), row(source('a', 'concept A {}'), [], [
      { alias: 'vite', phases: ['build', 'build'] },
    ])]);
    rejected(result, ['entries', 1, 'dependencies', 'packages', 0, 'phases', 1], ['entries', 1, 'dependencies', 'packages', 0, 'phases', 0]);
  });
  it('reports unknown later package phases without authorizing them', () => {
    const result = new SourceComposer().compose([row(source('z', 'concept Z {}')), row(source('a', 'concept A {}'), [], [
      { alias: 'vite', phases: ['deploy'] } as never,
    ])]);
    rejected(result, ['entries', 1, 'dependencies', 'packages', 0, 'phases', 0]);
  });
  it('locates package prerequisite causes using the new overload input paths', () => {
    const game = source('game', 'concept Game { requires package "vite" for test }');
    const result = new SourceComposer().compose([row(game, [], [{ alias: 'vite', phases: ['build'] }])]);
    expect(result.problems).toContainEqual(expect.objectContaining({ code: 'unavailable-package',
      related: [at('entries', 0, 'dependencies', 'packages', 0, 'phases')] }));
  });
  it('leaves the original overload diagnostic paths unchanged', () => {
    const game = source('game', 'concept Game { requires package "vite" for test }');
    const result = new SourceComposer().compose(game, row(game, [], [{ alias: 'vite', phases: ['build'] }]).dependencies);
    expect(result.problems).toContainEqual(expect.objectContaining({ code: 'unavailable-package', related: [at('packages', 0, 'phases')] }));
  });
});

describe('one immutable workspace view', () => {
  it('orders selected roots ordinally and retains authored declaration order', () => {
    const z = source('z', 'function second() returns Text\nfunction first() returns Number');
    const a = source('a', 'function alpha() returns Boolean');
    const result = new SourceComposer().compose([row(z, [a]), row(a, [z])]);
    expect(result.problems).toEqual([]);
    expect(result.entry).toBe('a');
    expect([...new QueryInspection(result.model).query('function')].map(item => item.name)).toEqual(['alpha', 'second', 'first']);
  });
  it('retains a shared external declaration and its metadata provenance once', () => {
    const library = new ExternalModel('library', [{ kind: 'record-type', name: 'Book', fields: [
      { kind: 'field', name: 'title', type: { kind: 'builtin', name: 'Text' } },
    ] }]);
    const result = new SourceComposer().compose([
      row(source('game', 'use Book from "library"\nfunction save(book: Book) returns Nothing'), [library]),
      row(source('shop', 'use Book from "library"\nfunction buy(book: Book) returns Number'), [library]),
    ]);
    const compiled = new Compiler().compile({ resolution: result });
    expect(compiled.problems).toEqual([]); expect(compiled.value).toBeDefined();
    const inspection = compiled.value!.inspection, book = [...inspection.query('record-type-declaration')][0]!;
    expect([...inspection.query('record-type-declaration')]).toHaveLength(1);
    expect(book.id).toBe(library.roots()[0]);
    expect(book.origin).toEqual({ kind: 'external', module: 'library', path: [0] });
    const type = compiled.value!.types.declaredType(book.id);
    for (const callable of inspection.query('function')) expect(compiled.value!.types.callable(callable.id).parameters[0]!.type).toEqual({ status: 'known', value: type });
    expect(book.fields[0]!.origin).toEqual({ kind: 'external', module: 'library', path: [0, 'fields', 0] });
  });
  it('calls the locator with the declaring root and never substitutes a same-spelling module', () => {
    const game = source('game', 'use Book from "./book"'), shop = source('shop', 'use Book from "./book"');
    const left = source('left', 'type Book {}'), right = source('right', 'type Book {}');
    const result = new SourceComposer((owner, authored) => authored === './book' ? owner === 'game' ? 'left' : 'right' : undefined)
      .compose([row(game, [left]), row(shop, [right])]);
    expect(result.problems).toEqual([]);
    expect(result.model.resolution(game.nodes('import-item')[0]!.imported)).toEqual({ status: 'bound', target: left.roots()[0] });
    expect(result.model.resolution(shop.nodes('import-item')[0]!.imported)).toEqual({ status: 'bound', target: right.roots()[0] });
  });
  it('propagates locator failure from a later selected root', () => {
    const failure = Error('Unavailable host locator');
    expect(() => new SourceComposer(() => { throw failure; }).compose([
      row(source('a', 'concept A {}')), row(source('z', 'include "shared"')),
    ])).toThrow(failure);
  });
  it('rejects an asynchronous locator instead of treating its promise as a module', () => {
    const locate = (() => Promise.resolve('shared')) as unknown as ModuleLocator;
    expect(() => new SourceComposer(locate).compose([row(source('a', 'include "shared"'))])).toThrow(TypeError);
  });
  it('preserves the frozen single-entry baseline captured from unmodified main', () => {
    const game = source('game', 'use Book from "catalog"\nfunction save(book: Book) returns Nothing');
    const catalog = source('catalog', 'type Book { title: Text }');
    const resolution = new SourceComposer().compose([row(game, [catalog])]);
    const compiled = new Compiler().compile({ resolution });
    expect(compiled.problems).toEqual([]); expect(compiled.value).toBeDefined();
    let next = 0;
    const identified = new SpecificationIdentity(() => 'frozen-main-' + ++next).associate(compiled.value!);
    expect(identified.problems).toEqual([]);
    // Produced before CORE-33 from main ae2c6e0, 2026-10-03T19:22:23.810Z; never regenerated by this test.
    expect(identified.value!.baseline).toEqual(JSON.parse(readFileSync(new URL('../../resources/workspace-compilation/single-entry-baseline.json', import.meta.url), 'utf8')));
  });
});
