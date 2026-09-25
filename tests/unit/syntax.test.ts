import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AntlrSyntaxReader } from '../../src/syntax/reader.js';
import type { AcceptedSource, SourceNode, SourceNodeId } from '../../src/model/source.js';

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

describe('AntlrSyntaxReader', () => {
  for (const file of fixtureFiles('specifications/grammar/fixtures/valid')) {
    it(`recognizes the authored grammar fixture ${file}`, () => {
      const source = { sourceId: file, text: readFileSync(file, 'utf8') };
      const result = reader.read(source);
      expect(result.status, result.status === 'rejected' ? JSON.stringify(result.diagnostics) : '').toBe('accepted');
      expect(result.document).toEqual(source);
    });
  }
  for (const file of fixtureFiles('specifications/grammar/fixtures/invalid')) {
    it(`rejects malformed source ${file}`, () => {
      const result = reader.read({ sourceId: file, text: readFileSync(file, 'utf8') });
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') expect(result.diagnostics.length).toBeGreaterThan(0);
    });
  }
  for (const file of fixtureFiles('specifications/compiler/fixtures').filter(file => !file.endsWith('syntax-error.expec'))) {
    it(`leaves compiler validation decisions unresolved for ${file}`, () => {
      const result = reader.read({ sourceId: file, text: readFileSync(file, 'utf8') });
      expect(result.status, result.status === 'rejected' ? JSON.stringify(result.diagnostics) : '').toBe('accepted');
    });
  }
  it.each([
    'specifications/shared/source.expec', 'specifications/grammar/recognition.expec',
    'specifications/compiler/source-model.expec', 'specifications/compiler/compiler.expec',
  ])('reads the language self-description without loading imports: %s', file => {
    const result = reader.read({ sourceId: file, text: readFileSync(file, 'utf8') });
    expect(result.status, result.status === 'rejected' ? JSON.stringify(result.diagnostics) : '').toBe('accepted');
  });
  it('keeps public references distinct from declarations and does not resolve them', () => {
    const result = accepted('concept StoreGame {\n public saveGame\n capability save() returns Nothing\n}');
    const names = result.description.nodes.filter(n => n.payload.kind === 'name').map(n => n.payload.kind === 'name' && n.payload.decoded);
    expect(names).toEqual(['StoreGame', 'saveGame', 'save', 'Nothing']);
    expect(result.description.nodes.filter(n => n.payload.kind === 'capability')).toHaveLength(1);
  });
  it('preserves literal expectations separately from explicit prose', () => {
    const { description } = accepted('examples {\n example "value": title() => "Dune"\n example "prose": title() => satisfies "a book title"\n}');
    const examples = description.nodes.filter(n => n.payload.kind === 'example');
    expect(examples).toHaveLength(2);
    const expectedKinds = examples.map(n => n.payload.kind === 'example' ? description.nodes[n.payload.expected.ordinal]!.payload.kind : '');
    expect(expectedKinds).toEqual(['string-literal', 'prose-expectation']);
  });
  it('preserves omitted versus empty helper bodies and omitted versus explicit results', () => {
    const { description } = accepted('examples {\n action first()\n action second() returns Nothing {}\n}');
    const callables = description.nodes.filter(n => n.payload.kind === 'action');
    expect(callables[0]!.payload).not.toHaveProperty('body');
    expect(callables[0]!.payload).not.toHaveProperty('returnType');
    expect(callables[1]!.payload).toHaveProperty('body');
    expect(callables[1]!.payload).toHaveProperty('returnType');
  });
  it('uses Unicode scalar offsets, CRLF line boundaries, and original BOM positions', () => {
    const text = '\uFEFFtype `📚` {\r\n\tlabel: Text\r\n}';
    const { description } = accepted(text);
    const name = description.nodes.find(n => n.payload.kind === 'name' && n.payload.decoded === '📚')!;
    expect(name.range).toEqual({ sourceId: 'memory:example', start: { offset: 6, line: 1, column: 7 }, end: { offset: 9, line: 1, column: 10 } });
    const field = description.nodes.find(n => n.payload.kind === 'field')!;
    expect(field.range.start).toEqual({ offset: 14, line: 2, column: 2 });
  });
  it('preserves arithmetic precedence as typed source structure', () => {
    const { description } = accepted('examples { example "arithmetic": 2 + 3 * 4 => 14 }');
    const binaries = description.nodes.filter(n => n.payload.kind === 'binary-expression');
    expect(binaries.map(n => n.payload.kind === 'binary-expression' && n.payload.operator)).toEqual(['+', '*']);
  });
  it('builds an ordered forest with unique preorder IDs and contained ranges', () => {
    const { description } = accepted('type Pair<T> = [T, T]\nconcept Store {\n construction(count: Number)\n public save\n capability save(value: Pair<Number>) returns Nothing\n}');
    const structural = (node: SourceNode): SourceNodeId[] => Object.entries(node.payload).flatMap(([key, value]) => {
      if (key === 'operatorRange') return [];
      const values = Array.isArray(value) ? value : [value];
      return values.filter((v): v is SourceNodeId => typeof v === 'object' && v !== null && 'ordinal' in v);
    });
    const parents = new Map<number, number>();
    for (const [index, node] of description.nodes.entries()) {
      expect(node.id).toEqual({ sourceId: description.sourceId, ordinal: index });
      for (const childId of structural(node)) {
        const child = description.nodes[childId.ordinal]!;
        expect(child.range.start.offset).toBeGreaterThanOrEqual(node.range.start.offset);
        expect(child.range.end.offset).toBeLessThanOrEqual(node.range.end.offset);
        expect(parents.has(childId.ordinal)).toBe(false);
        parents.set(childId.ordinal, index);
      }
    }
    expect(parents.size + description.roots.length).toBe(description.nodes.length);
  });
  it.each([
    'type Cart { count: Number; label: Text }',
    'type Cart { count: Number label: Text }',
    'function calculate() returns Number\n{ ensures result > 0 }',
    'examples { fixture pair: List<Number> = [1\n2] }',
    'examples { example "chained": 1 < 2 < 3 => true }',
    'examples { scenario "bad" {\n when 1 + 2\n then true\n} }',
    'examples { scenario "bad" {\n when run()\n given prepare()\n then true\n} }',
    'type Empty = []',
    'type Box<> {}',
    'type `unterminated {}',
    'type `` {}',
    'type X = "\\uD800"',
    'type X = "\\q"',
    'type X {}\rtype Y {}',
    'type X = "raw\u0001control"',
  ])('rejects the lexical/layout violation %s', text => expect(read(text).status).toBe('rejected'));
  it('allows multiline collections without suppressing expression comparison boundaries', () => {
    accepted('type Result = List<\nList<\nNumber\n>\n>\nexamples {\n fixture values: List<Number> = [\n1,\n2,\n]\n example "grouped": (1 +\n2) => 3\n}');
    expect(read('examples {\n example "comparison": 1 <\n2 => true\n}').status).toBe('rejected');
  });
  it('treats every line break inside a collection as whitespace, including qualified references', () => {
    accepted('type Result = List<catalog\n.\nItem>\nfunction choose(value: [\n-\n1, catalog\n.\nItem]) returns Text\nexamples {\n example "member": (catalog\n.\nlookup\n(\n)) => "Dune"\n}');
  });
  it('decodes escaped names and paired Unicode string escapes', () => {
    const { description } = accepted('type `a\\`b` = "\\uD83D\\uDCDA"');
    expect(description.nodes.find(n => n.payload.kind === 'name')!.payload).toMatchObject({ decoded: 'a`b', quoted: true });
    expect(description.nodes.find(n => n.payload.kind === 'string-literal')!.payload).toMatchObject({ value: '📚' });
  });
});
