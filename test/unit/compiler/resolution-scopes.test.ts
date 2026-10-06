import { describe, expect, it } from 'vitest';
import { LangiumReader } from '../../../src/language/langium/reader.js';
import { LangiumModel, ExternalModel, type ModuleModel } from '../../../src/index.js';
import { builtinModel } from '../../../src/compiler/resolution.js';
import { ScopeGraph, type Lookup } from '../../../src/compiler/resolution/scopes.js';
import { SourceIndex } from '../../../src/compiler/resolution/source-index.js';

function source(locator: string, text: string): SourceIndex {
  const read = new LangiumReader().read({ sourceId: locator + '.expec', text });
  if (read.status !== 'accepted') throw new Error('Scope example must be grammatical: ' + JSON.stringify(read.diagnostics));
  return new SourceIndex(new LangiumModel(locator, read.document));
}
function external(inspection: ModuleModel): SourceIndex { return new SourceIndex(inspection); }
function scopes(...modules: SourceIndex[]): ScopeGraph { return new ScopeGraph(modules, builtinModel()); }
function occurrence(module: SourceIndex, path: readonly string[], index = 0) {
  const found = module.of('reference').filter(node => JSON.stringify(module.reference(node.id)) === JSON.stringify(path))[index];
  if (!found) throw new Error('Example does not contain reference ' + path.join('.'));
  return found;
}
function selectAt(graph: ScopeGraph, module: SourceIndex, path: readonly string[], index = 0): Lookup {
  return graph.lookup(graph.scope(occurrence(module, path, index).id), path);
}
function target(found: Lookup) {
  if (found.status !== 'found') throw new Error('Expected selected declaration, got ' + found.status);
  return found.declaration;
}

describe('scope consumers follow the declared public contract', () => {
  it('keeps an unlisted capability inaccessible outside its owner', () => {
    const store = source('store', 'concept Store { capability save() }');
    const graph = scopes(store);
    expect(graph.select('store', ['Store', 'save']).status).toBe('inaccessible');
  });

  it('selects a capability listed by its owner', () => {
    const store = source('store', 'concept Store { public save\ncapability save() }');
    const graph = scopes(store);
    expect(target(graph.select('store', ['Store', 'save'])).kind).toBe('capability');
  });

  it('keeps owner-local capability calls available without a public listing', () => {
    const store = source('store', `concept Store {
  capability save()
  capability exercise() { requires save() }
}`);
    const graph = scopes(store);
    expect(target(selectAt(graph, store, ['save'])).kind).toBe('capability');
  });

  it('applies the same public visibility to external and source module declarations', () => {
    const store = external(new ExternalModel('store', [{
      kind: 'concept', name: 'Store', public: ['save'],
      members: [
        { kind: 'capability', name: 'save', parameters: [] },
        { kind: 'capability', name: 'reset', parameters: [] },
      ],
    }]));
    const graph = scopes(store);
    expect(target(graph.select('store', ['Store', 'save'])).kind).toBe('capability');
    expect(graph.select('store', ['Store', 'reset']).status).toBe('inaccessible');
  });
});

describe('module scope consumers select definitions without re-exporting aliases', () => {
  it('imports two aliases as the same actual record', () => {
    const store = source('store', 'use Cart as Basket, Cart as SavedBasket from "shopping"');
    const shopping = source('shopping', 'type Cart {}');
    const graph = scopes(store, shopping);
    const bindings = [...graph.imports.values()];
    expect(bindings).toEqual([
      { status: 'bound', target: shopping.of('record-type-declaration')[0]!.id },
      { status: 'bound', target: shopping.of('record-type-declaration')[0]!.id },
    ]);
    expect(graph.problems).toEqual([]);
  });

  it('does not make an imported alias or primitive an export', () => {
    const middle = source('middle', 'use Cart as Basket from "shopping"');
    const shopping = source('shopping', 'type Cart {}');
    const graph = scopes(middle, shopping);
    expect(graph.select('middle', ['Basket']).status).toBe('missing');
    expect(graph.select('middle', ['Text']).status).toBe('missing');
  });

  it('builds all declaration scopes before either side of a cyclic import is selected', () => {
    const first = source('first', 'use Second from "second"\ntype First {}');
    const second = source('second', 'use First from "first"\ntype Second {}');
    const graph = scopes(first, second);
    expect(graph.imports.get(occurrence(first, ['Second']).id)).toEqual({
      status: 'bound', target: second.of('record-type-declaration')[0]!.id,
    });
    expect(graph.imports.get(occurrence(second, ['First']).id)).toEqual({
      status: 'bound', target: first.of('record-type-declaration')[0]!.id,
    });
    expect(graph.problems).toEqual([]);
  });

  it('retains ambiguity between two distinct imported names', () => {
    const store = source('store', 'use Cart from "one"\nuse Cart from "two"\nfunction save(cart: Cart)');
    const graph = scopes(store, source('one', 'type Cart {}'), source('two', 'type Cart {}'));
    expect(selectAt(graph, store, ['Cart'], 2).status).toBe('ambiguous');
    expect(graph.problems).toEqual([]);
  });

  it('locates the missing import at the actual authored reference', () => {
    const store = source('store', 'use Cart from "missing"');
    const graph = scopes(store);
    expect(graph.problems).toMatchObject([{
      code: 'unavailable-module', at: { kind: 'source', module: 'store', range: { start: { line: 1, column: 5 } } },
    }]);
    expect(graph.imports.get(occurrence(store, ['Cart']).id)?.status).toBe('invalid');
  });
});

describe('lexical scope consumers retain local and generic identity', () => {
  it('keeps each owners generic parameter separate', () => {
    const library = source('library', 'type Pair<T> { value: T }\ntype Page<T> { value: T }');
    const graph = scopes(library);
    const pairT = target(selectAt(graph, library, ['T'], 0));
    const pageT = target(selectAt(graph, library, ['T'], 1));
    expect(pairT.kind).toBe('type-parameter');
    expect(pageT.kind).toBe('type-parameter');
    expect(pairT.id).not.toBe(pageT.id);
    expect(graph.select('library', ['Pair', 'T']).status).toBe('missing');
  });

  it('retains a same-spelled ordinary type so the caller can reject its kind', () => {
    const library = source('library', 'type T {}\nfunction save(item: T)');
    const graph = scopes(library);
    const where = graph.scope(occurrence(library, ['T']).id);
    expect(target(graph.lookup(where, ['T'])).kind).toBe('record-type-declaration');
  });

  it('keeps local declarations visible within their owner and inaccessible outside', () => {
    const library = source('library', `concept Store {
  local type SessionState {}
  capability save(value: SessionState)
}`);
    const graph = scopes(library);
    expect(target(selectAt(graph, library, ['SessionState'])).kind).toBe('record-type-declaration');
    expect(graph.select('library', ['Store', 'SessionState']).status).toBe('inaccessible');
  });

  it('records both duplicate origins while preserving the primitive for explicit builtin lookup', () => {
    const library = source('library', 'type Text {}');
    const graph = scopes(library);
    expect(graph.problems).toMatchObject([{ code: 'duplicate-declaration', related: [{ kind: 'builtin', name: 'Text' }] }]);
    expect(target(graph.builtin('Text')).kind).toBe('builtin-type');
  });

  it('does not introduce construction parameters throughout capabilities', () => {
    const library = source('library', `concept Store {
  construction(value: Text)
  capability save() { requires value }
}`);
    const graph = scopes(library);
    expect(selectAt(graph, library, ['value']).status).toBe('missing');
  });
});

describe('example scope consumers retain subject ownership without merging blocks', () => {
  it('attaches a forward same-module subject and keeps its local types available', () => {
    const store = source('store', `examples for Store {
  action exercise(snapshot: SessionState) returns Nothing { do save(snapshot) }
}
concept Store {
  local type SessionState {}
  capability save(snapshot: SessionState) returns Nothing
}`);
    const graph = scopes(store);
    expect(target(selectAt(graph, store, ['save'])).kind).toBe('capability');
    expect(target(selectAt(graph, store, ['SessionState'], 0)).id)
      .toBe(target(selectAt(graph, store, ['SessionState'], 1)).id);
    const exercise = store.of('action')[0]!;
    expect(graph.scope(exercise.id).owner).toBe(store.of('concept')[0]!.id);
  });

  it('keeps helpers from separate blocks invisible to one another', () => {
    const store = source('store', `concept Store {}
examples for Store { action prepare() returns Nothing }
examples for Store { action exercise() returns Nothing { do prepare() } }`);
    const graph = scopes(store);
    expect(selectAt(graph, store, ['prepare']).status).toBe('missing');
  });

  it('retains missing subject context instead of selecting an unrelated outer function', () => {
    const store = source('store', `function save() returns Nothing
examples for Missing { action exercise() returns Nothing { do save() } }`);
    const graph = scopes(store);
    expect(selectAt(graph, store, ['save'])).toEqual({
      status: 'subject-context', subject: occurrence(store, ['Missing']).id,
    });
    expect(target(selectAt(graph, store, ['Nothing'], 1)).kind).toBe('builtin-type');
  });

  it('does not bypass a local subject accessibility to attach its examples', () => {
    const store = source('store', `concept Store { local concept Hidden { capability save() } }
examples for Store.Hidden { action exercise() returns Nothing { do save() } }`);
    const graph = scopes(store);
    expect(selectAt(graph, store, ['Store', 'Hidden']).status).toBe('inaccessible');
    expect(selectAt(graph, store, ['save']).status).toBe('subject-context');
  });

  it('does not discard a qualified suffix when a primitive bypasses a missing subject', () => {
    const store = source('store', 'examples for Missing { action exercise(value: Text.Item) }');
    const graph = scopes(store);
    expect(selectAt(graph, store, ['Text', 'Item']).status).toBe('missing');
  });

  it('requires composition for a subject imported from another module', () => {
    const examples = source('examples', `use Store from "store"
examples for Store { action exercise() returns Nothing { do save() } }`);
    const store = source('store', 'concept Store { public save\ncapability save() }');
    const graph = scopes(examples, store);
    expect(selectAt(graph, examples, ['save']).status).toBe('subject-context');
    expect(target(selectAt(graph, examples, ['Nothing'])).kind).toBe('builtin-type');
  });

  it('keeps extension composition scoped to the extension', () => {
    const store = source('store', `concept Store {}
extend Store { capability save(snapshot: Missing) }
function unrelated(snapshot: Typo)`);
    const graph = scopes(store);
    expect(graph.scope(occurrence(store, ['Missing']).id).composition).toBe(true);
    expect(graph.scope(occurrence(store, ['Typo']).id).composition).toBe(false);
  });
});
