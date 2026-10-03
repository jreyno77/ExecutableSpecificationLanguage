import { describe, expect, it } from 'vitest';
import {
  Compiler, ExternalModel, LangiumModel, LangiumReader, QueryInspection, Resolver, SourceComposer, TypeDescriber,
  type Model, type ModelNode, type ModuleLocator, type ModuleModel, type NodeId, type NodeKind, type Origin, type Resolution,
} from '../../src/index.js';

function source(locator: string, text: string): ModuleModel {
  const read = new LangiumReader().read({ sourceId: locator + '.expec', text });
  if (read.status !== 'accepted') throw new Error(JSON.stringify(read.diagnostics));
  return new LangiumModel(locator, read.document);
}
const dependencies = (...modules: ModuleModel[]) => ({ modules, packages: [] });
const compose = (entry: ModuleModel, ...modules: ModuleModel[]) => new SourceComposer().compose(entry, dependencies(...modules));
function named<K extends NodeKind>(model: Model, kind: K, name: string) {
  const node = [...new QueryInspection(model).query(kind)].find(node => 'name' in node && node.name === name);
  if (!node) throw new Error(`Missing ${kind} ${name} in test input.`);
  return node;
}
function expectIssue(result: { problems: readonly { code: string; at: unknown; related: readonly unknown[] }[] },
  code: string, at: Origin, related?: Origin) {
  const problem = result.problems.find(problem => problem.code === code && JSON.stringify(problem.at) === JSON.stringify(at));
  expect(problem, `${code} at ${JSON.stringify(at)}`).toBeDefined();
  if (related) expect(problem!.related).toContainEqual(related);
}
function expectUnanalyzed(model: Model, authored: Model, id: NodeId): void {
  expect(() => model.node(id)).toThrowError(expect.objectContaining({ code: 'not-analyzed' }));
  for (const child of authored.children(id)) expectUnanalyzed(model, authored, child);
}
function expectCompiled(resolution: Resolution): void {
  const checked = new Compiler().compile({ resolution });
  expect(checked.problems).toEqual([]);
  expect(checked.deferred).toEqual([]);
  expect(checked.value).toBeDefined();
}

describe('one effective owner keeps its contract rules across extensions', () => {
  it('reports duplicate construction across files and leaves its type query invalid', () => {
    const entry = source('store', 'include "saving"\nconcept Store { construction() }');
    const saving = source('saving', 'use Store from "store"\nextend Store { construction(value: Text) }');
    const result = compose(entry, saving);
    expectIssue(result, 'duplicate-declaration', saving.nodes('construction')[0]!.origin, entry.nodes('construction')[0]!.origin);
    const construction = new TypeDescriber().describe(result).construction(named(entry, 'concept', 'Store').id);
    expect(construction.status).toBe('invalid');
    expect(new Compiler().compile({ resolution: result }).value).toBeUndefined();
  });

  it('reports a public name listed twice across the combined owner', () => {
    const entry = source('store', 'include "saving"\nconcept Store {\n public save\n capability save() returns Nothing\n}');
    const saving = source('saving', 'use Store from "store"\nextend Store { public save }');
    const result = compose(entry, saving);
    expectIssue(result, 'duplicate-declaration', saving.node(saving.nodes('public')[0]!.references[0]!).origin,
      entry.node(entry.nodes('public')[0]!.references[0]!).origin);
    expect(new Compiler().compile({ resolution: result }).value).toBeUndefined();
  });

  it('checks private type exposure in an added public signature', () => {
    const entry = source('store', 'include "saving"\nconcept Store { local type Secret {} }');
    const saving = source('saving', 'use Store from "store"\nextend Store {\n public save\n capability save(value: Secret) returns Nothing\n}');
    const result = new Compiler().compile({ resolution: compose(entry, saving) });
    expectIssue(result, 'private-type-exposure', saving.nodes('named-type')[0]!.origin, named(entry, 'record-type-declaration', 'Secret').origin);
    expect(result.value).toBeUndefined();
  });

  it('can expose an existing capability without declaring it again', () => {
    const entry = source('caller', 'use Store.save from "store"');
    const store = source('store', 'include "saving"\nconcept Store { capability save() returns Nothing }');
    const saving = source('saving', 'use Store from "store"\nextend Store { public save }');
    const result = compose(entry, store, saving);
    expectCompiled(result);
    expect(result.model.resolution(entry.nodes('import-item')[0]!.imported)).toEqual({ status: 'bound', target: named(store, 'capability', 'save').id });
  });

  it('does not silently accept a missing public name from an extension', () => {
    const entry = source('store', 'concept Store {}\nextend Store { public missing }');
    const result = compose(entry);
    expectIssue(result, 'unresolved-reference', entry.node(entry.nodes('public')[0]!.references[0]!).origin);
    expect(new Compiler().compile({ resolution: result }).value).toBeUndefined();
  });

  it('prefers the owner local type to an extension file import', () => {
    const entry = source('store', 'include "saving"\nconcept Store { local type State {} }');
    const saving = source('saving', 'use Store from "store"\nuse State from "models"\nextend Store { capability save(value: State) }\nfunction outside(value: State)');
    const models = source('models', 'type State {}');
    const result = compose(entry, saving, models);
    expectCompiled(result);
    const [inside, outside] = saving.nodes('named-type');
    expect(result.model.resolution(inside!.reference)).toEqual({ status: 'bound', target: named(entry, 'record-type-declaration', 'State').id });
    expect(result.model.resolution(outside!.reference)).toEqual({ status: 'bound', target: named(models, 'record-type-declaration', 'State').id });
  });

  it('keeps an owner member conflict instead of falling back to an imported name', () => {
    const entry = source('store', 'include "saving"\nconcept Store { local type State {} }');
    const saving = source('saving', 'use Store from "store"\nuse State from "models"\nextend Store {\n local type State {}\n capability save(value: State)\n}');
    const result = compose(entry, saving, source('models', 'type State {}'));
    const reference = saving.nodes('named-type')[0]!.reference;
    expect(result.model.resolution(reference).status).toBe('invalid');
    expectIssue(result, 'duplicate-declaration', named(saving, 'record-type-declaration', 'State').origin,
      named(entry, 'record-type-declaration', 'State').origin);
  });

  it('does not grant access to a local concept before selecting the extension target', () => {
    const entry = source('store', 'concept Store { local concept Hidden {} }\nextend Store.Hidden { capability save() }');
    const result = compose(entry);
    expectIssue(result, 'inaccessible-reference', entry.node(entry.nodes('extend')[0]!.target).origin,
      named(entry, 'concept', 'Hidden').origin);
    expectUnanalyzed(result.model, entry, entry.nodes('extend')[0]!.id);
  });

  it('does not unwrap an alias into an extendable owner', () => {
    const entry = source('store', 'concept Store {}\ntype Alias = Store\nextend Alias { capability save() }');
    const result = compose(entry);
    expectIssue(result, 'wrong-reference-kind', entry.node(entry.nodes('extend')[0]!.target).origin,
      named(entry, 'alias-type-declaration', 'Alias').origin);
    expectUnanalyzed(result.model, entry, entry.nodes('extend')[0]!.id);
  });
});

describe('example subjects grant only the declared lexical context', () => {
  it('cannot use attachment to obtain access to a private capability', () => {
    const entry = source('store', 'concept Store { capability save() }\nexamples for Store.save { example "number": 1 => 1 }');
    const result = compose(entry), block = entry.nodes('examples')[0]!;
    expectIssue(result, 'inaccessible-reference', entry.node(block.subject!).origin, named(entry, 'capability', 'save').origin);
    expectUnanalyzed(result.model, entry, block.id);
  });

  it('does not treat a record field as an examples subject', () => {
    const entry = source('books', 'type Book { copies: Number }\nexamples for Book.copies { example "count": 1 => 1 }');
    const result = compose(entry), block = entry.nodes('examples')[0]!;
    expectIssue(result, 'wrong-reference-kind', entry.node(block.subject!).origin, named(entry, 'field', 'copies').origin);
    expectUnanalyzed(result.model, entry, block.id);
  });

  it('does not repair a named block using the enclosing attachment subject', () => {
    const entry = source('store', 'concept Store {}\nexamples for Store from "saving"');
    const saving = source('saving', 'examples for Missing { fixture number: Number = 1 }');
    const result = compose(entry, saving), block = saving.nodes('examples')[0]!;
    expectIssue(result, 'unresolved-reference', saving.node(block.subject!).origin);
    expectUnanalyzed(result.model, saving, block.id);
  });

  it('keeps alias examples owned by that alias rather than its underlying type', () => {
    const entry = source('types', 'type Book {}\ntype Alias = Book\nexamples for Alias { example "number": 1 => 1 }');
    const result = compose(entry), block = entry.nodes('examples')[0]!;
    expectCompiled(result);
    expect(result.model.parent(block.id)).toBe(named(entry, 'alias-type-declaration', 'Alias').id);
    expect(result.model.children(named(entry, 'record-type-declaration', 'Book').id)).not.toContain(block.id);
  });

  it('allows an opaque type to own examples without inventing fields', () => {
    const entry = source('types', 'opaque type Token\nexamples for Token { example "number": 1 => 1 }');
    const result = compose(entry), owner = named(entry, 'opaque-type-declaration', 'Token'), block = entry.nodes('examples')[0]!;
    expectCompiled(result);
    expect(result.model.parent(block.id)).toBe(owner.id);
    expect(result.model.children(owner.id)).toContain(block.id);
    expect(result.model.node(owner.id)).not.toHaveProperty('fields');
  });

  it('does not give a callable parameter a value by attaching examples to it', () => {
    const entry = source('functions', 'function double(amount: Number) returns Number\nexamples for double { example "amount": amount => 2 }');
    const result = compose(entry), owner = named(entry, 'function', 'double'), block = entry.nodes('examples')[0]!;
    expect(result.model.children(owner.id)).toContain(block.id);
    expect(result.model.node(owner.id, 'function').parameters).toEqual(entry.node(owner.id, 'function').parameters);
    expect(result.model.node(owner.id, 'function').body).toEqual({ kind: 'absent' });
    const checked = new Compiler().compile({ resolution: result });
    expectIssue(checked, 'unavailable-value', entry.node(entry.nodes('name-expression')[0]!.reference).origin);
    expect(checked.value).toBeUndefined();
  });

  it('does not give a record field a receiver value through subject ownership', () => {
    const entry = source('books', 'type Book { copies: Number }\nexamples for Book { example "copies": copies => 1 }');
    const result = compose(entry), owner = named(entry, 'record-type-declaration', 'Book'), block = entry.nodes('examples')[0]!;
    expect(result.model.children(owner.id)).toContain(block.id);
    expect(result.model.node(owner.id, 'record-type-declaration').fields).toEqual(entry.node(owner.id, 'record-type-declaration').fields);
    const checked = new Compiler().compile({ resolution: result });
    expectIssue(checked, 'unavailable-value', entry.node(entry.nodes('name-expression')[0]!.reference).origin);
    expect(checked.value).toBeUndefined();
  });

  it('does not synthesize a contract result in callable examples', () => {
    const entry = source('functions', 'function double(amount: Number) returns Number\nexamples for double { example "result": result => 2 }');
    const result = compose(entry), block = entry.nodes('examples')[0]!;
    expect(result.model.parent(block.id)).toBe(named(entry, 'function', 'double').id);
    const checked = new Compiler().compile({ resolution: result });
    expectIssue(checked, 'unresolved-reference', entry.node(entry.nodes('name-expression')[0]!.reference).origin);
    expect(checked.value).toBeUndefined();
  });

  it('allows an explicit fixture named result in callable examples', () => {
    const entry = source('functions', 'function double(amount: Number) returns Number\nexamples for double {\n fixture result: Number = 4\n example "result": result => 4\n}');
    const result = compose(entry);
    expectCompiled(result);
    expect(result.model.parent(entry.nodes('examples')[0]!.id)).toBe(named(entry, 'function', 'double').id);
    expect(result.model.resolution(entry.nodes('name-expression')[0]!.reference)).toEqual({ status: 'bound', target: named(entry, 'fixture', 'result').id });
  });
});

describe('attachment reachability and ownership remain separate', () => {
  it('attaches every direct block but keeps a concept inline block with its own owner', () => {
    const entry = source('store', 'concept Store {}\nexamples for Store from "saving"');
    const saving = source('saving', 'examples {}\nconcept Other { examples {} }\nexamples { example "one": 1 => 1 }');
    const result = compose(entry, saving), [first, inline, last] = saving.nodes('examples');
    expectCompiled(result);
    expect(result.model.parent(first!.id)).toBe(named(entry, 'concept', 'Store').id);
    expect(result.model.parent(last!.id)).toBe(named(entry, 'concept', 'Store').id);
    expect(result.model.parent(inline!.id)).toBe(named(saving, 'concept', 'Other').id);
    expect(result.model.roots()).not.toContain(first!.id);
    expect(result.model.roots()).not.toContain(last!.id);
  });

  it('reports a missing mapped attachment at its actual locator and dependency location', () => {
    const entry = source('store', 'concept Store {}\nexamples for Store from "./missing.expec"');
    const result = new SourceComposer((owner, authored) => owner === 'store' && authored === './missing.expec' ? 'mapped/missing' : undefined)
      .compose(entry, dependencies());
    const at = entry.node(entry.nodes('examples-attachment')[0]!.locator).origin;
    expectIssue(result, 'unavailable-module', at);
    expect(result.problems.find(problem => problem.code === 'unavailable-module')!.related)
      .toContainEqual({ kind: 'dependency', path: ['modules', 'mapped/missing'] });
  });

  it('reports a blank default attachment locator instead of guessing a module', () => {
    const entry = source('store', 'concept Store {}\nexamples for Store from "  "');
    const result = compose(entry);
    expectIssue(result, 'unavailable-module', entry.node(entry.nodes('examples-attachment')[0]!.locator).origin);
  });

  it('propagates attachment locator collaborator failures', () => {
    const entry = source('store', 'concept Store {}\nexamples for Store from "saving"'), failure = new Error('Host lookup failed');
    expect(() => new SourceComposer(() => { throw failure; }).compose(entry, dependencies())).toThrow(failure);
  });

  it('rejects an asynchronous attachment locator instead of accepting a promise as a key', () => {
    const entry = source('store', 'concept Store {}\nexamples for Store from "saving"');
    const locate = (() => Promise.resolve('saving')) as unknown as ModuleLocator;
    expect(() => new SourceComposer(locate).compose(entry, dependencies())).toThrow(TypeError);
  });

  it('attaches a file to itself once without an include-cycle failure', () => {
    const entry = source('store', 'concept Store {}\nexamples for Store from "store"\nexamples {}');
    const result = compose(entry), block = entry.nodes('examples')[0]!, owner = named(entry, 'concept', 'Store');
    expectCompiled(result);
    expect(result.model.parent(block.id)).toBe(owner.id);
    expect(result.model.children(owner.id).filter(id => id === block.id)).toHaveLength(1);
  });

  it('keeps equal alias claims idempotent when supplied inventory order changes', () => {
    const entry = source('store', 'include "a"\ninclude "b"\nconcept Store {}');
    const a = source('a', 'use Store as Shop from "store"\nexamples for Shop from "shared"');
    const b = source('b', 'use Store as Game from "store"\nexamples for Game from "shared"');
    const shared = source('shared', 'examples {}'), block = shared.nodes('examples')[0]!;
    const first = compose(entry, b, shared, a), second = compose(entry, a, shared, b);
    expectCompiled(first);
    expectCompiled(second);
    expect(first.model.parent(block.id)).toBe(named(entry, 'concept', 'Store').id);
    expect(second.model.parent(block.id)).toBe(named(entry, 'concept', 'Store').id);
    expect(first.model.nodes('examples').map(node => node.id)).toEqual([block.id]);
    expect(second.model.nodes('examples').map(node => node.id)).toEqual([block.id]);
  });

  it('reports the same conflicting claims in stable order without choosing an owner', () => {
    const entry = source('entry', 'include "a"\ninclude "b"');
    const a = source('a', 'concept First {}\nexamples for First from "shared"');
    const b = source('b', 'concept Second {}\nexamples for Second from "shared"');
    const shared = source('shared', 'examples { fixture value: Number = 1 }');
    const first = compose(entry, b, shared, a), second = compose(entry, a, shared, b);
    expectIssue(first, 'conflicting-example-subject', b.node(b.nodes('examples-attachment')[0]!.subject).origin,
      a.node(a.nodes('examples-attachment')[0]!.subject).origin);
    expect(first.problems).toEqual(second.problems);
    expectUnanalyzed(first.model, shared, shared.nodes('examples')[0]!.id);
    expectUnanalyzed(second.model, shared, shared.nodes('examples')[0]!.id);
  });

  it('retains a valid named block reached through a failed outer attachment', () => {
    const entry = source('entry', 'examples for Missing from "saving"');
    const saving = source('saving', 'concept Own {}\nexamples for Own { fixture value: Number = 1 }');
    const result = compose(entry, saving), block = saving.nodes('examples')[0]!;
    expectIssue(result, 'unresolved-reference', entry.node(entry.nodes('examples-attachment')[0]!.subject).origin);
    expect(result.model.parent(block.id)).toBe(named(saving, 'concept', 'Own').id);
    expect(result.model.node(named(saving, 'fixture', 'value').id).kind).toBe('fixture');
    expect(new Compiler().compile({ resolution: result }).value).toBeUndefined();
  });
});

describe('effective containment remains inspectable and original compilation stays explicit', () => {
  it('keeps query order distinct from owner member order with reciprocal unique containment', () => {
    const entry = source('entry', 'include "a"\ninclude "z"');
    const a = source('a', 'use Store from "z"\nextend Store { capability later() }');
    const z = source('z', 'concept Store { capability original() }');
    const result = compose(entry, z, a), owner = named(z, 'concept', 'Store');
    expectCompiled(result);
    const inspection = new QueryInspection(result.model);
    expect([...inspection.query('capability')].map(node => node.name)).toEqual(['later', 'original']);
    expect(inspection.read(owner.id, 'concept').members.filter(node => node.kind === 'capability').map(node => node.name)).toEqual(['original', 'later']);
    const seen = new Set<NodeId>();
    const visit = (id: NodeId): void => {
      expect(seen.has(id)).toBe(false);
      seen.add(id);
      for (const child of result.model.children(id)) {
        expect(result.model.parent(child)).toBe(id);
        visit(child);
      }
    };
    for (const root of result.model.roots()) { expect(result.model.parent(root)).toBeUndefined(); visit(root); }
    expect(seen.has(named(a, 'capability', 'later').id)).toBe(true);
    expect(seen.has(named(z, 'capability', 'original').id)).toBe(true);
    expect(a.parent(named(a, 'capability', 'later').id)).toBe(a.nodes('extend')[0]!.id);
  });

  it('keeps external typed members intact while adding source-owned examples', () => {
    const library = new ExternalModel('library', [{ kind: 'record-type', name: 'Book', fields: [
      { kind: 'field', name: 'copies', type: { kind: 'builtin', name: 'Number' } },
    ] }]);
    const entry = source('entry', 'use Book from "library"\nexamples for Book { example "one": 1 => 1 }');
    const result = compose(entry, library), owner = named(library, 'record-type-declaration', 'Book'), block = entry.nodes('examples')[0]!;
    expectCompiled(result);
    expect(result.model.children(owner.id)).toContain(block.id);
    expect(result.model.node(owner.id, 'record-type-declaration').fields).toEqual(library.node(owner.id, 'record-type-declaration').fields);
    expect(library.children(owner.id)).not.toContain(block.id);
    expect(result.model.node(block.id).origin).toEqual(block.origin);
  });

  it('leaves raw extensions pending through the ordinary resolver and source compiler', () => {
    const text = 'concept Store {}\nextend Store { capability save() }', entry = source('entry', text);
    const resolution = new Resolver().resolve(entry, dependencies());
    expect(resolution.problems).toContainEqual(expect.objectContaining({ code: 'composition-required' }));
    const compiler = new Compiler();
    expect(compiler.compile({ resolution }).value).toBeUndefined();
    const checked = compiler.compile({ source: { sourceId: 'entry.expec', text }, locator: 'entry', dependencies: dependencies() });
    expect(checked.problems).toContainEqual(expect.objectContaining({ code: 'composition-required' }));
    expect(checked.value).toBeUndefined();
  });
});

/** A conforming model may return fresh value records while keeping the same NodeIds. */
function recordViews(model: ModuleModel, view: (node: ModelNode) => ModelNode): ModuleModel {
  return {
    locator: model.locator, roots: () => model.roots(), children: id => model.children(id),
    parent: id => model.parent(id), resolution: id => model.resolution(id),
    node: ((id: NodeId, kind?: NodeKind) => view(kind ? model.node(id, kind) : model.node(id))) as Model['node'],
    nodes: <K extends NodeKind>(kind: K) => model.nodes(kind).map(node => view(node) as ModelNode<K>),
  };
}

describe('composition follows model contracts rather than record storage', () => {
  it('attaches examples when node reads return fresh records with stable identities', () => {
    const authored = source('store', 'concept Store {}\nexamples for Store from "saving"');
    const entry = recordViews(authored, node => ({ ...node }));
    const saving = source('saving', 'examples { fixture copies: Number = 1 }');
    const result = compose(entry, saving), block = saving.nodes('examples')[0]!;
    expectCompiled(result);
    expect(result.model.parent(block.id)).toBe(named(authored, 'concept', 'Store').id);
    expect(result.model.roots()).not.toContain(block.id);
  });

  it('preserves accessor-backed concept facts while adding a typed capability', () => {
    const authored = source('store', 'concept Store { capability original() returns Nothing }\nextend Store { capability save(value: Text) returns Nothing }');
    const entry = recordViews(authored, node => {
      if (node.kind !== 'concept') return node;
      return new class {
        get id() { return node.id; }
        get kind() { return node.kind; }
        get origin() { return node.origin; }
        get name() { return node.name; }
        get members() { return node.members; }
      }();
    });
    const result = compose(entry);
    expectCompiled(result);
    const inspection = new QueryInspection(result.model), owner = named(authored, 'concept', 'Store');
    expect(inspection.read(owner.id, 'concept').name).toBe('Store');
    expect(inspection.read(owner.id, 'concept').members.filter(member => member.kind === 'capability').map(member => member.name))
      .toEqual(['original', 'save']);
    const typeUse = authored.nodes('named-type').find(type => authored.node(authored.node(type.reference, 'reference').segments[0]!, 'name').decoded === 'Text')!;
    const binding = result.model.resolution(typeUse.reference);
    expect(binding.status).toBe('bound');
    if (binding.status === 'bound') expect(result.model.node(binding.target).origin).toEqual({ kind: 'builtin', name: 'Text' });
  });

  it('reports one invalid attachment reference once for multiple ownerless blocks', () => {
    const entry = source('store', 'examples for Missing from "saving"');
    const saving = source('saving', 'examples {}\nexamples { fixture copies: Number = 1 }');
    const result = compose(entry, saving), subject = entry.node(entry.nodes('examples-attachment')[0]!.subject);
    expect(result.problems.filter(problem => problem.code === 'unresolved-reference' && JSON.stringify(problem.at) === JSON.stringify(subject.origin)))
      .toHaveLength(1);
    expectUnanalyzed(result.model, saving, saving.nodes('examples')[0]!.id);
    expectUnanalyzed(result.model, saving, saving.nodes('examples')[1]!.id);
  });

  it('rejects an extension target made conflicting by a later contribution', () => {
    const library = new ExternalModel('library', [{ kind: 'concept', name: 'Store', public: [], members: [
      { kind: 'concept', name: 'Inner', public: [], members: [] },
    ] }]);
    const entry = source('entry', 'use Store from "library"\nextend Store.Inner { capability save() }\nextend Store { local concept Inner {} }');
    const result = compose(entry, library), extension = entry.nodes('extend')[0]!;
    expectIssue(result, 'duplicate-declaration', named(entry, 'concept', 'Inner').origin, named(library, 'concept', 'Inner').origin);
    expectUnanalyzed(result.model, entry, extension.id);
    expect(new Compiler().compile({ resolution: result }).value).toBeUndefined();
  });

  it('keeps a newly contributed local concept inaccessible to another top-level extension', () => {
    const entry = source('store', 'concept Store {}\nextend Store { local concept Inner {} }\nextend Store.Inner { capability save() }');
    const result = compose(entry), extension = entry.nodes('extend')[1]!;
    expectIssue(result, 'inaccessible-reference', entry.node(extension.target).origin, named(entry, 'concept', 'Inner').origin);
    expectUnanalyzed(result.model, entry, extension.id);
    expect(result.model.parent(entry.nodes('local')[0]!.id)).toBe(named(entry, 'concept', 'Store').id);
  });

  it('uses an attached file import after checking the subject members', () => {
    const entry = source('store', 'type State { fromOwnerFile: Text }\nconcept Store {}\nexamples for Store from "saving"');
    const saving = source('saving', 'use State from "models"\nexamples { fixture state: State = State { copies: 1 } }');
    const models = source('models', 'type State { copies: Number }');
    const result = compose(entry, saving, models);
    expectCompiled(result);
    expect(result.model.resolution(saving.nodes('named-type')[0]!.reference))
      .toEqual({ status: 'bound', target: named(models, 'record-type-declaration', 'State').id });
    expect(result.model.parent(saving.nodes('examples')[0]!.id)).toBe(named(entry, 'concept', 'Store').id);
  });

  it('keeps an inline block between its extension members before separately attached blocks', () => {
    const entry = source('store', 'concept Store { capability original() }\nextend Store {\n capability before()\n examples {}\n capability after()\n}\nexamples for Store from "saving"');
    const saving = source('saving', 'examples {}');
    const result = compose(entry, saving), owner = named(entry, 'concept', 'Store');
    expectCompiled(result);
    const expected = [named(entry, 'capability', 'original').id, named(entry, 'capability', 'before').id,
      entry.nodes('examples')[0]!.id, named(entry, 'capability', 'after').id, saving.nodes('examples')[0]!.id];
    expect(result.model.node(owner.id, 'concept').members).toEqual(expected);
    expect(result.model.children(owner.id).filter(id => result.model.node(id).kind !== 'name')).toEqual(expected);
  });
});

