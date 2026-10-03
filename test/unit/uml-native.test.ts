import { describe, expect, it } from 'vitest';
import { NativeDiagrams } from '../../src/uml-native.js';
import { DiagramDocuments } from '../../src/uml-documents.js';
import { createHash } from 'node:crypto';

const metadata = (value: object) => '# expec-uml: ' + Buffer.from(JSON.stringify({ format: 1, outputId: 'uml', ...value })).toString('base64url') + '\n';
async function inspect(text: string) {
  const native = new NativeDiagrams(), bytes = Buffer.from(text);
  try { return await DiagramDocuments.read({ root: { path: '/captured', identity: 'fixture' }, complete: true, excludeNames: [], excluded: [], problems: [],
    files: [{ path: 'diagram.d2', bytes, version: createHash('sha256').update(bytes).digest('hex') }] }, native); } finally { await native.dispose(); }
}

describe('native diagram source facts', () => {
  it('keeps a direct class method at its literal original UTF-16 key and statement', async () => {
    const source = '# 📚\nstore: Store {\n  shape: class\n  "save(title: Text)": Nothing\n}\n';
    const diagrams = new NativeDiagrams();
    try {
      const result = await diagrams.read('member.d2', { 'member.d2': source });
      expect(result.problems).toEqual([]);
      const member = result.statements.find(node => node.key[0] === 'store')?.children.find(node => node.key[0] === 'save(title: Text)');
      expect(member).toBeDefined();
      expect(member!.keyRange).toEqual({ start: 37, end: 56, line: 4, column: 2 });
      expect(member!.range).toMatchObject({ start: 37, end: 65 });
      expect(source.slice(member!.keyRange.start, member!.keyRange.end)).toBe('"save(title: Text)"');
      expect(source.slice(member!.range.start, member!.range.end)).toBe('"save(title: Text)": Nothing');
    } finally { await diagrams.dispose(); }
  });
  it('keeps a direct field and unusual edge spacing distinct from formatted output', async () => {
    const source = '# 📚\nstore: Store {shape: class; title: Text}\nlauncher   ->   store: starts\n';
    const diagrams = new NativeDiagrams();
    try {
      const result = await diagrams.read('field.d2', { 'field.d2': source });
      expect(result.text).toBe(source);
      expect(result.statements.find(node => node.key[0] === 'store')?.children.find(node => node.key[0] === 'title')?.value).toBe('Text');
      const edge = result.statements.flatMap(node => node.edges)[0]!;
      expect(source.slice(edge.range.start, edge.range.end)).toBe('launcher   ->   store');
      expect(source.slice(edge.toRange.start, edge.toRange.end)).toBe('store');
      expect(edge).toMatchObject({ from: ['launcher'], to: ['store'], left: false, right: true });
    } finally { await diagrams.dispose(); }
  });
  it('rejects a relationship identity attached to an object instead of an actual edge', async () => {
    const documents = await inspect(metadata({ edge: { subject: 'save', owner: 'store', role: 'input' } }) + 'store: Store\n');
    expect(documents.coverage().complete).toBe(false); expect(documents.problems.map(problem => problem.code)).toContain('invalid-output-document');
  });
  it('rejects an unknown relationship role instead of trusting its direction', async () => {
    const documents = await inspect(metadata({ definition: 'store' }) + 's: Store\n' + metadata({ definition: 'book' }) + 'b: Book\n'
      + metadata({ edge: { subject: 'store', owner: 'store', role: 'telepathy' } }) + 's -> b: reads\n');
    expect(documents.search('store').outgoing.uses).toEqual([]); expect(documents.coverage().complete).toBe(false);
  });
  it('does not use an unattached identity to make a display string a declaration', async () => {
    const documents = await inspect(metadata({ definition: 'store' }) + '# ordinary comment\n');
    expect(documents.definitions).toEqual([]); expect(documents.coverage().complete).toBe(false);
  });
  it('keeps a valid foreign namespace outside this output without inventing a malformed file', async () => {
    const documents = await inspect(metadata({ outputId: 'another-diagram', definition: 'foreign' }) + 'foreign: Foreign\n');
    expect(documents.definitions).toEqual([]); expect(documents.problems).toEqual([]); expect(documents.coverage().complete).toBe(true);
  });
  it('reports two actual native declarations claiming one subject', async () => {
    const documents = await inspect(metadata({ definition: 'store' }) + 'a: Store\n' + metadata({ definition: 'store' }) + 'b: Store\n');
    expect(documents.search('store').definitions).toHaveLength(2); expect(documents.problems.map(problem => problem.code)).toContain('ambiguous-definition');
  });
  it('treats a dotted native note as an actual use of its participant', async () => {
    const documents = await inspect('shape: sequence_diagram\n' + metadata({ definition: 'a' }) + 'a: A\n' + metadata({ definition: 'b' }) + 'b: B\na -> b: ping\nb.note: Undecided\n');
    expect(documents.search('b').incoming.uses.some(use => use.at.format === 'd2-note' && use.target.kind === 'project')).toBe(true);
  });
});
