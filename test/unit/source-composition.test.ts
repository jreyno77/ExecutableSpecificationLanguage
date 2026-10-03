import { describe, expect, it } from 'vitest';
import {
  Compiler, ExternalModel, LangiumModel, LangiumReader, Resolver, SourceComposer,
  type ModuleLocator, type ModuleModel,
} from '../../src/index.js';

function module(locator: string, text: string, sourceId = locator + '.expec'): ModuleModel {
  const result = new LangiumReader().read({ sourceId, text });
  if (result.status !== 'accepted') throw new Error(JSON.stringify(result.diagnostics));
  return new LangiumModel(locator, result.document);
}
const dependencies = (...modules: ModuleModel[]) => ({ modules, packages: [] });

describe('a supplied-source host selects module keys deliberately', () => {
  it('uses exact keys when no locator policy is supplied', () => {
    const entry = module('entry', 'include "shared.expec"'), shared = module('shared.expec', 'type Shared {}');
    const resolution = new SourceComposer().compose(entry, dependencies(shared));
    expect(new Compiler().compile({ resolution }).value).toBeDefined();
    expect(resolution.model.node(shared.roots()[0]!).id).toBe(shared.roots()[0]);
  });
  it('does not repair an undefined mapping with a same-spelling supplied module', () => {
    const result = new SourceComposer(() => undefined).compose(module('entry', 'use Shared from "shared"'),
      dependencies(module('shared', 'type Shared {}')));
    expect(result.problems).toContainEqual(expect.objectContaining({ code: 'unavailable-module' }));
    expect(new Compiler().compile({ resolution: result }).value).toBeUndefined();
  });
  it('propagates a locator collaborator exception', () => {
    const failure = new Error('Host mapping failed');
    expect(() => new SourceComposer(() => { throw failure; }).compose(
      module('entry', 'include "shared"'), dependencies())).toThrow(failure);
  });
  it('rejects blank mapped keys as collaborator misuse', () => {
    expect(() => new SourceComposer(() => '  ').compose(module('entry', 'include "shared"'), dependencies())).toThrow(TypeError);
  });
  it('rejects a promise returned in place of a mapped key', () => {
    const asynchronous = (() => Promise.resolve('shared')) as unknown as ModuleLocator;
    expect(() => new SourceComposer(asynchronous).compose(module('entry', 'include "shared"'), dependencies())).toThrow(TypeError);
  });
  it('rejects a non-callable locator policy', () => {
    expect(() => new SourceComposer('shared' as unknown as ModuleLocator)).toThrow(TypeError);
  });
  it('retains duplicate inventory failures even for an unused locator', () => {
    const result = new SourceComposer().compose(module('entry', 'type Entry {}'),
      dependencies(module('unused', 'type First {}'), module('unused', 'type Second {}')));
    expect(result.problems).toContainEqual(expect.objectContaining({ code: 'invalid-dependency-input' }));
    expect(new Compiler().compile({ resolution: result }).value).toBeUndefined();
  });
  it('retains conflicting source identity failures for unused modules', () => {
    const result = new SourceComposer().compose(module('entry', 'type Entry {}'),
      dependencies(module('first', 'type First {}', 'same.expec'), module('second', 'type Second {}', 'same.expec')));
    expect(result.problems).toContainEqual(expect.objectContaining({ code: 'invalid-dependency-input' }));
  });
});

describe('include visibility remains separate from declaration ownership', () => {
  it('consumes only the include and its locator while preserving the original query handles', () => {
    const entry = module('entry', 'include "shared"'), shared = module('shared', 'type Shared { count: Number }');
    const include = entry.nodes('include')[0]!, declaration = shared.nodes('record-type-declaration')[0]!;
    const result = new SourceComposer().compose(entry, dependencies(shared));
    expect(new Compiler().compile({ resolution: result }).value).toBeDefined();
    for (const id of [include.id, include.locator]) {
      expect(() => result.model.node(id)).toThrowError(expect.objectContaining({ code: 'not-analyzed' }));
      expect(entry.node(id).id).toBe(id);
    }
    expect(result.model.node(declaration.id).id).toBe(declaration.id);
    expect(result.model.parent(declaration.fields[0]!)).toBe(declaration.id);
    expect(result.model.node(declaration.id).origin).toEqual(declaration.origin);
  });
  it('repeated includes introduce one declaration rather than duplicate names', () => {
    const entry = module('entry', 'include "shared"\ninclude "shared"');
    const result = new SourceComposer().compose(entry, dependencies(module('shared', 'type Shared {}')));
    expect(new Compiler().compile({ resolution: result }).value).toBeDefined();
    expect(result.model.nodes('record-type-declaration')).toHaveLength(1);
  });
  it('does not export a local declaration from external metadata through an include', () => {
    const hidden = new ExternalModel('shared', [{ kind: 'record-type', name: 'Secret', local: true, fields: [] }]);
    const result = new SourceComposer().compose(module('entry', 'include "shared"\nfunction reveal(value: Secret)'), dependencies(hidden));
    expect(result.problems).toContainEqual(expect.objectContaining({ code: 'unresolved-reference' }));
    expect(new Compiler().compile({ resolution: result }).value).toBeUndefined();
  });
  it('allows a public capability to be selected through a re-exported concept', () => {
    const result = new SourceComposer().compose(module('entry', 'use Store.save from "catalog"'),
      dependencies(module('catalog', 'include "store"'), module('store', 'concept Store {\n public save\n capability save() returns Nothing\n}')));
    expect(new Compiler().compile({ resolution: result }).value).toBeDefined();
    const reference = result.model.nodes('import-item')[0]!.imported;
    const binding = result.model.resolution(reference);
    expect(binding.status).toBe('bound');
    if (binding.status === 'bound') expect(result.model.node(binding.target).kind).toBe('capability');
  });
  it('does not relax duplicate explicit imports when their target is also included', () => {
    const result = new SourceComposer().compose(module('entry', 'include "shared"\nuse Shared from "shared"'),
      dependencies(module('shared', 'type Shared {}')));
    expect(result.problems).toContainEqual(expect.objectContaining({ code: 'duplicate-declaration' }));
  });
  it('orders reached modules independently of supplied inventory order', () => {
    const entry = module('entry', 'include "z"\ninclude "a"'), a = module('a', 'type A {}'), z = module('z', 'type Z {}');
    const composer = new SourceComposer(), first = composer.compose(entry, dependencies(z, a)), second = composer.compose(entry, dependencies(a, z));
    const records = first.model.nodes('record-type-declaration');
    expect(records.map(node => node.origin.kind === 'source' && node.origin.module)).toEqual(['a', 'z']);
    expect(second.model.nodes('record-type-declaration')).toHaveLength(2);
    records.forEach((node, index) => expect(second.model.nodes('record-type-declaration')[index]!.id).toBe(node.id));
    expect(first.model.roots().indexOf(a.roots()[0]!)).toBeLessThan(first.model.roots().indexOf(z.roots()[0]!));
    expect(second.model.roots().indexOf(a.roots()[0]!)).toBeLessThan(second.model.roots().indexOf(z.roots()[0]!));
  });
});

describe('the prepared compiler retains the real checking boundary', () => {
  it('reports a self include cycle even when the file declares nothing', () => {
    const result = new SourceComposer().compose(module('entry', 'include "entry"'), dependencies());
    expect(result.problems).toContainEqual(expect.objectContaining({ code: 'include-cycle' }));
    expect(new Compiler().compile({ resolution: result }).value).toBeUndefined();
  });
  it('allows a mixed import/include cycle whose include edges are acyclic', () => {
    const result = new SourceComposer().compose(module('a', 'include "b"\ntype A {}'),
      dependencies(module('b', 'use A from "a"\ntype B { value: A }')));
    expect(new Compiler().compile({ resolution: result }).value).toBeDefined();
  });
  it('keeps alias cycle checking after name composition', () => {
    const result = new SourceComposer().compose(module('entry', 'include "aliases"'),
      dependencies(module('aliases', 'type A = B\ntype B = A')));
    const checked = new Compiler().compile({ resolution: result });
    expect(checked.problems).toContainEqual(expect.objectContaining({ code: 'circular-alias' }));
    expect(checked.value).toBeUndefined();
  });
  it('keeps a supplied Resolution pending when its caller has skipped composition', () => {
    const entry = module('entry', 'include "shared"'), supplied = dependencies(module('shared', 'type Shared {}'));
    const checked = new Compiler().compile({ resolution: new Resolver().resolve(entry, supplied) });
    expect(checked.problems).toContainEqual(expect.objectContaining({ code: 'composition-required' }));
    expect(checked.value).toBeUndefined();
  });
  it('shares semantic type and default checks with ordinary compilation', () => {
    const text = 'type Settings { count: Number = "many" }', entry = module('entry', text);
    const compiler = new Compiler(), prepared = compiler.compile({ resolution: new SourceComposer().compose(entry, dependencies()) });
    const ordinary = compiler.compile({ source: { sourceId: 'entry.expec', text }, locator: 'entry', dependencies: dependencies() });
    expect(prepared.problems).toEqual(ordinary.problems);
    expect(prepared.problems).toContainEqual(expect.objectContaining({ code: 'incompatible-type' }));
    expect(prepared.value).toBeUndefined();
  });
});
