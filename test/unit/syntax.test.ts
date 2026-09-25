import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AntlrSyntaxReader } from '../../src/grammar/reader.js';
import type { AcceptedSource, SourceDescription, SourceNode, SourceNodeId, SourcePayload } from '../../src/grammar/source.js';

const reader = new AntlrSyntaxReader();
function read(text: string, sourceId = 'memory:example') { return reader.read({ sourceId, text }); }
function accepted(text: string): AcceptedSource {
  const result = read(text);
  expect(result.status, result.status === 'rejected' ? JSON.stringify(result.diagnostics) : '').toBe('accepted');
  if (result.status !== 'accepted') throw new Error('Expected accepted source');
  return result;
}
function fixtureFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? fixtureFiles(path) : entry.name.endsWith('.expec') ? [path] : [];
  });
}

const fixtureBehaviors: Record<string, string> = {
  'valid/store-game.expec': 'Store Game contracts with public capabilities and dependencies',
  'valid/language-forms.expec': 'the declaration categories and available type forms',
  'valid/shopping.expec': 'domain operations with separately attached examples',
  'valid/shopping.examples.expec': 'a shopper scenario written in domain operations',
  'valid/reusable-setup.expec': 'reusable setup with defaults and captured results',
  'valid/relationships.expec': 'ordered participant messages and captured replies',
  'valid/derived-relationships.expec': 'declared type uses that relationship consumers can inspect',
  'valid/lexical-layout.expec': 'comments, escaping, and multiline collections',
  'valid/literals-and-prose.expec': 'literal expectations and explicit prose',
  'valid/support/shared.expec': 'a shared alias with literal alternatives',
  'valid/models/system-config.expec': 'record fields with an imported type and a default',
  'valid/models/shopping-cart.expec': 'a record with a numeric field default',
  'valid/models/player-state.expec': 'a record using imported generic and record types',
  'valid/models/pair.expec': 'a generic tuple alias',
  'invalid/missing-colon.expec': 'a field declaration without its type separator',
  'invalid/missing-delimiter.expec': 'an unclosed declaration body',
  'invalid/unterminated-string.expec': 'a string that does not close before the line ends',
  'invalid/missing-operand.expec': 'an operator without its right operand',
  'invalid/phase-order.expec': 'scenario setup after an action',
};

function fixtureBehavior(file: string): string {
  const name = relative(resolve('test/resources/grammar'), file).replaceAll('\\', '/');
  const behavior = fixtureBehaviors[name];
  if (!behavior) throw new Error(`Give the grammar example ${name} a behavior description.`);
  return behavior;
}

type NodeOfKind<Kind extends SourcePayload['kind']> = SourceNode & { payload: SourcePayload & { kind: Kind } };
function nodesOfKind<Kind extends SourcePayload['kind']>(source: SourceDescription, kind: Kind): NodeOfKind<Kind>[] {
  return source.nodes.filter((node): node is NodeOfKind<Kind> => node.payload.kind === kind);
}
function nodeFor(source: SourceDescription, id: SourceNodeId): SourceNode {
  const node = source.nodes[id.ordinal];
  if (!node) throw new Error(`The source description is missing node ${id.ordinal}.`);
  return node;
}

function expectNavigableSourceForest(source: SourceDescription): void {
  const childrenOf = (node: SourceNode): SourceNodeId[] => Object.entries(node.payload).flatMap(([key, value]) => {
    if (key === 'operatorRange') return [];
    const values = Array.isArray(value) ? value : [value];
    return values.filter((value): value is SourceNodeId => typeof value === 'object' && value !== null && 'ordinal' in value);
  });
  const parents = new Map<number, number>();
  for (const [index, node] of source.nodes.entries()) {
    expect(node.id).toEqual({ sourceId: source.sourceId, ordinal: index });
    for (const childId of childrenOf(node)) {
      const child = nodeFor(source, childId);
      expect(child.range.start.offset).toBeGreaterThanOrEqual(node.range.start.offset);
      expect(child.range.end.offset).toBeLessThanOrEqual(node.range.end.offset);
      expect(parents.has(childId.ordinal)).toBe(false);
      parents.set(childId.ordinal, index);
    }
  }
  expect(parents.size + source.roots.length).toBe(source.nodes.length);
}

describe('source recognition', () => {
  for (const file of fixtureFiles('test/resources/grammar/valid')) {
    it(`accepts ${fixtureBehavior(file)}`, () => {
      const source = { sourceId: file, text: readFileSync(file, 'utf8') };
      const result = reader.read(source);
      expect(result.status, result.status === 'rejected' ? JSON.stringify(result.diagnostics) : '').toBe('accepted');
      expect(result.document).toEqual(source);
    });
  }
  for (const file of fixtureFiles('test/resources/grammar/invalid')) {
    it(`rejects ${fixtureBehavior(file)}`, () => {
      const result = reader.read({ sourceId: file, text: readFileSync(file, 'utf8') });
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') expect(result.diagnostics.length).toBeGreaterThan(0);
    });
  }
  it('keeps public references distinct from declarations and does not resolve them', () => {
    const { description } = accepted('concept StoreGame {\n public saveGame\n capability save() returns Nothing\n}');
    const names = nodesOfKind(description, 'name').map(node => node.payload.decoded);
    expect(names).toEqual(['StoreGame', 'saveGame', 'save', 'Nothing']);
    expect(nodesOfKind(description, 'capability')).toHaveLength(1);
  });
  it('preserves literal expectations separately from explicit prose', () => {
    const { description } = accepted('examples {\n example "value": title() => "Dune"\n example "prose": title() => satisfies "a book title"\n}');
    const examples = nodesOfKind(description, 'example');
    expect(examples).toHaveLength(2);
    const expectedKinds = examples.map(node => nodeFor(description, node.payload.expected).payload.kind);
    expect(expectedKinds).toEqual(['string-literal', 'prose-expectation']);
  });
  it('preserves omitted versus empty helper bodies and omitted versus explicit results', () => {
    const { description } = accepted('examples {\n action first()\n action second() returns Nothing {}\n}');
    const callables = nodesOfKind(description, 'action');
    expect(callables[0]!.payload).not.toHaveProperty('body');
    expect(callables[0]!.payload).not.toHaveProperty('returnType');
    expect(callables[1]!.payload).toHaveProperty('body');
    expect(callables[1]!.payload).toHaveProperty('returnType');
  });
  it('uses Unicode scalar offsets, CRLF line boundaries, and original BOM positions', () => {
    const text = '\uFEFFtype `📚` {\r\n\tlabel: Text\r\n}';
    const { description } = accepted(text);
    const name = nodesOfKind(description, 'name').find(node => node.payload.decoded === '📚')!;
    expect(name.range).toEqual({ sourceId: 'memory:example', start: { offset: 6, line: 1, column: 7 }, end: { offset: 9, line: 1, column: 10 } });
    const [field] = nodesOfKind(description, 'field');
    expect(field!.range.start).toEqual({ offset: 14, line: 2, column: 2 });
  });
  it('places multiplication inside addition so callers can preserve expression precedence', () => {
    const { description } = accepted('examples { example "arithmetic": 2 + 3 * 4 => 14 }');
    const operations = nodesOfKind(description, 'binary-expression');
    expect(operations.map(node => node.payload.operator)).toEqual(['+', '*']);
    const [addition, multiplication] = operations;
    expect(nodeFor(description, addition!.payload.left).payload).toEqual({ kind: 'number-literal', token: '2' });
    expect(addition!.payload.right).toEqual(multiplication!.id);
    expect(nodeFor(description, multiplication!.payload.left).payload).toEqual({ kind: 'number-literal', token: '3' });
    expect(nodeFor(description, multiplication!.payload.right).payload).toEqual({ kind: 'number-literal', token: '4' });
  });
  it('gives callers a navigable source forest with unique preorder IDs and contained ranges', () => {
    const { description } = accepted('type Pair<T> = [T, T]\nconcept Store {\n construction(count: Number)\n public save\n capability save(value: Pair<Number>) returns Nothing\n}');
    expectNavigableSourceForest(description);
  });
  it.each([
    ['semicolon statement separators', 'type Cart { count: Number; label: Text }'],
    ['multiple field declarations on one line', 'type Cart { count: Number label: Text }'],
    ['a contract body after its declaration has ended', 'function calculate() returns Number\n{ ensures result > 0 }'],
    ['list entries separated only by a newline', 'examples { fixture pair: List<Number> = [1\n2] }'],
    ['chained comparisons', 'examples { example "chained": 1 < 2 < 3 => true }'],
    ['a when step that is not a call', 'examples { scenario "bad" {\n when 1 + 2\n then true\n} }'],
    ['a given step after an action', 'examples { scenario "bad" {\n when run()\n given prepare()\n then true\n} }'],
    ['empty tuple types', 'type Empty = []'],
    ['empty generic parameter lists', 'type Box<> {}'],
    ['unterminated quoted names', 'type `unterminated {}'],
    ['empty quoted names', 'type `` {}'],
    ['unpaired Unicode surrogate escapes', 'type X = "\\uD800"'],
    ['unknown string escapes', 'type X = "\\q"'],
    ['lone carriage returns', 'type X {}\rtype Y {}'],
    ['raw control characters in strings', 'type X = "raw\u0001control"'],
  ])('rejects %s', (_behavior, text) => expect(read(text).status).toBe('rejected'));
  it('allows multiline collections without suppressing expression comparison boundaries', () => {
    accepted('type Result = List<\nList<\nNumber\n>\n>\nexamples {\n fixture values: List<Number> = [\n1,\n2,\n]\n example "grouped": (1 +\n2) => 3\n}');
    expect(read('examples {\n example "comparison": 1 <\n2 => true\n}').status).toBe('rejected');
  });
  it('treats every line break inside a collection as whitespace, including qualified references', () => {
    accepted('type Result = List<catalog\n.\nItem>\nfunction choose(value: [\n-\n1, catalog\n.\nItem]) returns Text\nexamples {\n example "member": (catalog\n.\nlookup\n(\n)) => "Dune"\n}');
  });
  it('decodes escaped names and paired Unicode string escapes', () => {
    const { description } = accepted('type `a\\`b` = "\\uD83D\\uDCDA"');
    expect(nodesOfKind(description, 'name')[0]!.payload).toMatchObject({ decoded: 'a`b', quoted: true });
    expect(nodesOfKind(description, 'string-literal')[0]!.payload).toMatchObject({ value: '📚' });
  });
});
