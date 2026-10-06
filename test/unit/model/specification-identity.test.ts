import { describe, expect, it } from 'vitest';
import {
  Compiler, ExternalModel, LangiumModel, LangiumReader, Resolver, SpecificationIdentity,
  type ArtifactAssociation, type Check, type IdentityBaseline, type IdentifiedSpecification, type Model,
  type NodeKind, type Specification,
} from '../../../src/index.js';

const digest = 'sha256:' + '0'.repeat(64);
function baseline() {
  return { format: 1, projection: 'expec-structure-1', entry: 'game', modules: ['game'], context: digest,
    elements: [{ id: 'store', address: { module: 'game', owner: null as string | null, kind: 'concept', name: 'Store' as string | null },
      occurrence: 0, capture: digest, structure: digest, references: [] as string[],
      origin: { kind: 'source', module: 'game', node: { sourceId: 'game.expec', ordinal: 0 },
        range: { sourceId: 'game.expec', start: { offset: 0, line: 1, column: 0 }, end: { offset: 16, line: 1, column: 16 } } } }],
    retired: [] as string[], artifacts: [] as ArtifactAssociation[] };
}
function identities(): SpecificationIdentity {
  let next = 0;
  return new SpecificationIdentity(() => 'id-' + ++next);
}
function accepted<T>(check: Check<T>): T {
  expect(check.problems).toEqual([]); expect(check.deferred).toEqual([]); expect(check.value).toBeDefined();
  return check.value!;
}
function rejected(check: Check<unknown>, code = 'identity-baseline'): void {
  expect(check.value).toBeUndefined(); expect(check.deferred).toEqual([]);
  expect(check.problems).toContainEqual(expect.objectContaining({ code }));
}
const read = (input: unknown) => identities().read({ sourceId: '.expec/identity.json', text: JSON.stringify(input) });
function compile(text: string): Specification {
  const result = new Compiler().compile({ source: { sourceId: 'game.expec', text }, locator: 'game', dependencies: { modules: [], packages: [] } });
  expect(result.syntax).toEqual([]);
  return accepted(result);
}
function named<K extends NodeKind>(specification: Specification, kind: K, name: string) {
  const found = [...specification.inspection.query(kind)].find(item => 'name' in item && item.name === name);
  if (!found) throw new Error(`No ${kind} ${name} in test input.`);
  return found;
}
function record(current: IdentifiedSpecification, kind: NodeKind, name: string | null) {
  const found = current.baseline.elements.find(element => element.address.kind === kind && element.address.name === name);
  if (!found) throw new Error(`No identified ${kind} ${name}.`);
  return found;
}

/** Supplied Model containment can include examples outside a record's typed fields. */
function withExampleOwner(owner: 'Book' | 'Text' | 'Number', value = 1, module = 'game'): Specification {
  const declaration = module === 'game' ? 'type Book { copies: Number }' : 'use Book from "library"';
  const syntax = new LangiumReader().read({ sourceId: 'game.expec', text: `${declaration}\nexamples { example "count": ${value} => ${value} }` });
  if (syntax.status !== 'accepted') throw new Error(JSON.stringify(syntax.diagnostics));
  const modules = module === 'game' ? [] : [new ExternalModel('library', [{ kind: 'record-type', name: 'Book',
    fields: [{ kind: 'field', name: 'copies', type: { kind: 'builtin', name: 'Number' } }] }])];
  const resolution = new Resolver().resolve(new LangiumModel('game', syntax.document), { modules, packages: [] });
  const original = resolution.model, block = original.nodes('examples')[0]!;
  const target = [...original.nodes('record-type-declaration'), ...original.nodes('builtin-type')]
    .find(node => original.node(node.name, 'name').decoded === owner)!;
  const model: Model = {
    roots: () => original.roots().filter(id => id !== block.id), node: original.node.bind(original), nodes: original.nodes.bind(original),
    children: id => id === target.id ? [...original.children(id), block.id] : original.children(id),
    parent: id => id === block.id ? target.id : original.parent(id), resolution: original.resolution.bind(original),
  };
  return accepted(new Compiler().compile({ resolution: { ...resolution, model } }));
}

describe('saved identity baselines are strict data, not trusted compiler output', () => {
  it('accepts the declared wire shape and emits canonical keys with a trailing LF', () => {
    const identity = identities(), saved = accepted(read(baseline())), text = accepted(identity.write(saved));
    expect(text.startsWith('{\n  "artifacts": []')).toBe(true);
    expect(text.endsWith('\n')).toBe(true);
    expect(accepted(identity.read({ sourceId: 'saved.json', text }))).toEqual(saved);
  });

  it('rejects an unknown nested address property', () => {
    const data = baseline(); Object.assign(data.elements[0]!.address, { guessedName: 'Other' });
    rejected(read(data));
  });

  it('rejects comments and trailing commas rather than treating the ledger as JSONC', () => {
    const text = JSON.stringify(baseline()), identity = identities();
    rejected(identity.read({ sourceId: 'comment.json', text: '// ledger\n' + text }));
    rejected(identity.read({ sourceId: 'trailing.json', text: text.slice(0, -1) + ',}' }));
  });

  it('rejects duplicate decoded nested keys even when one spelling is escaped', () => {
    const text = JSON.stringify(baseline()).replace('"name":"Store"', '"name":"Store","na\\u006de":"Other"');
    rejected(identities().read({ sourceId: 'duplicate.json', text }));
  });

  it('rejects malformed digests and unsupported projection versions separately', () => {
    rejected(read({ ...baseline(), context: 'sha256:short' }));
    rejected(read({ ...baseline(), projection: 'expec-structure-2' }), 'identity-format');
  });

  it('rejects an absent owner instead of adopting the element as a root', () => {
    const data = baseline(); data.elements[0]!.address.owner = 'missing';
    rejected(read(data));
  });

  it('rejects a containment cycle', () => {
    const data = baseline(), second = structuredClone(data.elements[0]!);
    second.id = 'other'; second.address.name = 'Other'; second.address.owner = 'store';
    data.elements[0]!.address.owner = 'other'; data.elements.push(second);
    rejected(read(data));
  });

  it('rejects a primitive record and a named anonymous examples scope', () => {
    const primitive = baseline(); primitive.elements[0]!.address.kind = 'builtin-type';
    rejected(read(primitive));
    const examples = baseline(); examples.elements[0]!.address.kind = 'examples';
    rejected(read(examples));
  });

  it('rejects duplicate identifiers and noncontiguous repeated-address occurrences', () => {
    const duplicate = baseline(); duplicate.elements.push(structuredClone(duplicate.elements[0]!));
    rejected(read(duplicate));
    const gap = baseline(), second = structuredClone(gap.elements[0]!);
    second.id = 'second'; second.occurrence = 2; gap.elements.push(second);
    rejected(read(gap));
  });

  it('rejects a record that is both active and retired', () => {
    rejected(read({ ...baseline(), retired: ['store'] }));
  });

  it('rejects references to unknown identities and unsorted repeated references', () => {
    const missing = baseline(); missing.elements[0]!.references = ['missing']; rejected(read(missing));
    const duplicate = baseline(); duplicate.elements[0]!.references = ['store', 'store']; rejected(read(duplicate));
    const unordered = baseline(), second = structuredClone(unordered.elements[0]!);
    second.id = 'apple'; second.address.name = 'Apple'; unordered.elements.push(second);
    unordered.elements[0]!.references = ['store', 'apple']; rejected(read(unordered));
  });

  it('rejects mismatched source provenance and reversed or unsafe positions', () => {
    const provenance = baseline(); provenance.elements[0]!.origin.range.sourceId = 'other.expec'; rejected(read(provenance));
    const reversed = baseline(); reversed.elements[0]!.origin.range.end.offset = -1; rejected(read(reversed));
    const unsafe = baseline(); unsafe.elements[0]!.origin.range.end.offset = Number.MAX_SAFE_INTEGER + 1; rejected(read(unsafe));
  });

  it('rejects an overflowed JSON number without replacing it with null', () => {
    const text = JSON.stringify(baseline()).replace('"occurrence":0', '"occurrence":1e999');
    rejected(identities().read({ sourceId: 'overflow.json', text }));
  });

  it('validates in-memory writes as strictly as saved input', () => {
    const data = baseline(); data.elements[0]!.capture = 'invalid';
    rejected(identities().write(data as IdentityBaseline));
  });

  it('preserves ordinary JSON keys such as __proto__ in an artifact locator', () => {
    const data = baseline();
    data.artifacts = [{ specId: 'store', locator: { outputId: 'ts', format: 'symbol-1', value: JSON.parse('{"__proto__":{"name":"own"},"constructor":"entry"}') } }];
    const saved = accepted(read(data)), value = saved.artifacts[0]!.locator.value;
    expect(value).toBeTypeOf('object');
    expect(Object.hasOwn(value as object, '__proto__')).toBe(true);
    expect(JSON.stringify(value)).toBe('{"__proto__":{"name":"own"},"constructor":"entry"}');
    expect(accepted(identities().read({ sourceId: 'saved.json', text: accepted(identities().write(saved)) }))).toEqual(saved);
  });
});

describe('identity queries and decisions preserve exact ownership', () => {
  it('rejects foreign and ineligible node handles without inventing persistent identities', () => {
    const identity = identities(), spec = compile('opaque type Token'), current = accepted(identity.associate(spec));
    const foreign = compile('opaque type Token'), builtin = [...spec.inspection.query('builtin-type')][0]!;
    expect(() => current.id(named(foreign, 'opaque-type-declaration', 'Token').id)).toThrowError(expect.objectContaining({ code: 'foreign-node' }));
    expect(() => current.id(builtin.id)).toThrowError(expect.objectContaining({ code: 'unexpected-kind' }));
    expect(() => current.node('unknown')).toThrow(RangeError);
  });

  it('does not let an explicit decision claim a foreign or primitive node', () => {
    const identity = identities(), spec = compile('opaque type Token'), prior = accepted(identity.associate(spec));
    const next = compile('opaque type Token'), oldId = prior.id(named(spec, 'opaque-type-declaration', 'Token').id);
    expect(() => identity.associate(next, prior.baseline, [{ id: oldId, to: named(spec, 'opaque-type-declaration', 'Token').id }]))
      .toThrowError(expect.objectContaining({ code: 'foreign-node' }));
    expect(() => identity.associate(next, prior.baseline, [{ id: oldId, to: [...next.inspection.query('builtin-type')][0]!.id }]))
      .toThrowError(expect.objectContaining({ code: 'unexpected-kind' }));
  });

  it('rejects contradictory retain and retire decisions', () => {
    const identity = identities(), spec = compile('opaque type Token'), prior = accepted(identity.associate(spec));
    const id = prior.id(named(spec, 'opaque-type-declaration', 'Token').id);
    rejected(identity.associate(spec, prior.baseline, [{ retire: id }, { id, to: prior.node(id) }]), 'identity-correspondence');
  });

  it('fails an ID factory collision instead of retrying or recycling history', () => {
    let calls = 0;
    const identity = new SpecificationIdentity(() => { calls++; return 'same'; });
    expect(() => identity.associate(compile('opaque type First\nopaque type Second'))).toThrow(TypeError);
    expect(calls).toBe(2);
  });

  it('rejects an invalid factory identifier before returning a proposal', () => {
    expect(() => new SpecificationIdentity(() => ' '.repeat(2)).associate(compile('opaque type Token'))).toThrow(TypeError);
    expect(() => new SpecificationIdentity(() => 'x'.repeat(257)).associate(compile('opaque type Token'))).toThrow(TypeError);
  });

  it('does not reuse a retired identity for a new declaration', () => {
    const identity = new SpecificationIdentity(() => 'token'), old = accepted(identity.associate(compile('opaque type Token')));
    const retired = accepted(identity.associate(compile(''), old.baseline, [{ retire: 'token' }]));
    expect(() => retired.node('token')).toThrow(RangeError);
    expect(() => identity.associate(compile('opaque type Other'), retired.baseline)).toThrow(TypeError);
  });

  it('rejects a disappeared active identity or a lost retirement during comparison', () => {
    const identity = identities(), previous = accepted(identity.associate(compile('opaque type Token')));
    const unrelated = accepted(identity.associate(compile('opaque type Other')));
    rejected(identity.compare(previous.baseline, unrelated), 'identity-correspondence');
    const retired = accepted(identity.associate(compile(''), previous.baseline, [{ retire: 'id-1' }]));
    const empty = accepted(identity.associate(compile('')));
    rejected(identity.compare(retired.baseline, empty), 'identity-correspondence');
  });
});

describe('structural comparison includes authored meaning and containment', () => {
  it('observes parameter order without replacing the parameter identities', () => {
    const identity = identities();
    const first = accepted(identity.associate(compile('function save(amount: Number, label: Text) returns Nothing')));
    const second = accepted(identity.associate(compile('function save(label: Text, amount: Number) returns Nothing'), first.baseline));
    expect(record(second, 'parameter', 'amount').id).toBe(record(first, 'parameter', 'amount').id);
    expect(record(second, 'parameter', 'label').id).toBe(record(first, 'parameter', 'label').id);
    expect(accepted(identity.compare(first.baseline, second)).changes.map(change => [change.id, change.kinds]))
      .toEqual([[record(first, 'function', 'save').id, ['update']]]);
  });

  it('observes field order while retaining unchanged field contracts', () => {
    const identity = identities();
    const first = accepted(identity.associate(compile('type Book {\n title: Text\n copies: Number\n}')));
    const second = accepted(identity.associate(compile('type Book {\n copies: Number\n title: Text\n}'), first.baseline));
    expect(accepted(identity.compare(first.baseline, second)).changes.map(change => [change.id, change.kinds]))
      .toEqual([[record(first, 'record-type-declaration', 'Book').id, ['update']]]);
  });

  it('observes scenario step order without interpreting runtime behavior', () => {
    const identity = identities();
    const first = accepted(identity.associate(compile('examples {\n action record(value: Number)\n scenario "record order" {\n when record(1)\n when record(2)\n then true\n}\n}')));
    const second = accepted(identity.associate(compile('examples {\n action record(value: Number)\n scenario "record order" {\n when record(2)\n when record(1)\n then true\n}\n}'), first.baseline));
    expect(accepted(identity.compare(first.baseline, second)).changes.map(change => [change.id, change.kinds]))
      .toEqual([[record(first, 'examples', null).id, ['update']], [record(first, 'scenario', 'record order').id, ['update']]].sort());
  });

  it('ignores operator locations and spacing while keeping expression meaning', () => {
    const identity = identities();
    const first = accepted(identity.associate(compile('examples { example "sum": 1 + 2 => 3 }')));
    const second = accepted(identity.associate(compile('// spacing\nexamples { example "sum": 1   +   2 => 3 }'), first.baseline));
    expect(accepted(identity.compare(first.baseline, second)).changes).toEqual([]);
  });

  it('does not turn reordered independent declarations into contract updates', () => {
    const identity = identities(), first = accepted(identity.associate(compile('opaque type First\nopaque type Second')));
    const second = accepted(identity.associate(compile('opaque type Second\nopaque type First'), first.baseline));
    expect(accepted(identity.compare(first.baseline, second))).toEqual({ changes: [], affected: [], contextChanged: false });
  });

  it('discovers attached examples through Model children without adding typed record fields', () => {
    const identity = identities(), first = accepted(identity.associate(withExampleOwner('Book')));
    const second = accepted(identity.associate(withExampleOwner('Book', 2), first.baseline));
    expect(record(second, 'examples', null).address.owner).toBe(record(second, 'record-type-declaration', 'Book').id);
    expect(named(second.specification, 'record-type-declaration', 'Book').fields.map(field => field.kind === 'local' ? field.declaration.name : field.name)).toEqual(['copies']);
    expect(accepted(identity.compare(first.baseline, second)).changes.map(change => change.id).sort())
      .toEqual([record(first, 'record-type-declaration', 'Book').id, record(first, 'examples', null).id, record(first, 'example', 'count').id].sort());
  });

  it('observes a changed builtin owner without inventing a primitive identity', () => {
    const identity = identities(), first = accepted(identity.associate(withExampleOwner('Text')));
    const second = accepted(identity.associate(withExampleOwner('Number'), first.baseline));
    expect(record(second, 'examples', null).id).toBe(record(first, 'examples', null).id);
    expect(record(second, 'examples', null).address.owner).toBeNull();
    expect(accepted(identity.compare(first.baseline, second)).changes.map(change => [change.id, change.kinds]))
      .toEqual([[record(first, 'examples', null).id, ['update']]]);
    expect(() => second.id(named(second.specification, 'builtin-type', 'Number').id))
      .toThrowError(expect.objectContaining({ code: 'unexpected-kind' }));
  });
});

describe('artifact associations are captured proposals', () => {
  it('captures nested locator values and replacement lists without changing earlier proposals', () => {
    const identity = identities(), current = accepted(identity.associate(compile('opaque type Token')));
    const links = [{ specId: 'id-1', locator: { outputId: 'ts', format: 'symbol-1', value: { file: 'token.ts', span: [1, 4] } } }];
    const linked = accepted(identity.withArtifacts(current, links));
    links[0]!.locator.value.span[0] = 99; links.push({ specId: 'id-1', locator: { outputId: 'ts', format: 'symbol-1', value: { file: 'other.ts', span: [0, 1] } } });
    expect(linked.baseline.artifacts).toEqual([{ specId: 'id-1', locator: { outputId: 'ts', format: 'symbol-1', value: { file: 'token.ts', span: [1, 4] } } }]);
    expect(current.baseline.artifacts).toEqual([]);
    const unlinked = accepted(identity.withArtifacts(linked, []));
    expect(unlinked.baseline.artifacts).toEqual([]); expect(linked.baseline.artifacts).toHaveLength(1);
  });

  it('rejects equal locators despite different object key order', () => {
    const identity = identities(), current = accepted(identity.associate(compile('opaque type Token')));
    rejected(identity.withArtifacts(current, [
      { specId: 'id-1', locator: { outputId: 'ts', format: 'symbol-1', value: { file: 'token.ts', start: 1 } } },
      { specId: 'id-1', locator: { outputId: 'ts', format: 'symbol-1', value: { start: 1, file: 'token.ts' } } },
    ]), 'identity-association');
  });

  it('rejects cyclic and non-JSON locator values without recursing indefinitely', () => {
    const identity = identities(), current = accepted(identity.associate(compile('opaque type Token')));
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    rejected(identity.withArtifacts(current, [{ specId: 'id-1', locator: { outputId: 'ts', format: 'symbol-1', value: cyclic } }] as ArtifactAssociation[]), 'identity-association');
    rejected(identity.withArtifacts(current, [{ specId: 'id-1', locator: { outputId: 'ts', format: 'symbol-1', value: new Date(0) } }] as unknown as ArtifactAssociation[]), 'identity-association');
  });
});


describe('a moved owner does not rewrite an unchanged authored child address', () => {
  it('retains examples left in their original module while the owner and its field move', () => {
    const identity = identities(), first = accepted(identity.associate(withExampleOwner('Book')));
    const next = withExampleOwner('Book', 1, 'library'), owner = record(first, 'record-type-declaration', 'Book');
    const second = accepted(identity.associate(next, first.baseline, [{ id: owner.id, to: named(next, 'record-type-declaration', 'Book').id }]));

    expect(record(second, 'record-type-declaration', 'Book').address.module).toBe('library');
    expect(record(second, 'field', 'copies').id).toBe(record(first, 'field', 'copies').id);
    expect(record(second, 'field', 'copies').address.module).toBe('library');
    expect(record(second, 'examples', null).id).toBe(record(first, 'examples', null).id);
    expect(record(second, 'examples', null).address).toEqual(record(first, 'examples', null).address);
    expect(record(second, 'example', 'count').id).toBe(record(first, 'example', 'count').id);
  });
});
