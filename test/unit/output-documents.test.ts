import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { ListDocuments, renderList } from '../../src/output-documents.js';
import type { ListedDeclaration } from '../../src/output-projection.js';
import type { ProjectSnapshot } from '../../src/index.js';
function snapshot(files: Record<string, string | Uint8Array>): ProjectSnapshot {
  return { root: { path: '/fixture', identity: 'fixture' }, complete: true, excludeNames: [], excluded: [], problems: [], files: Object.entries(files).map(([path, contents]) => {
    const bytes = typeof contents === 'string' ? Buffer.from(contents) : contents; return { path, bytes, version: createHash('sha256').update(bytes).digest('hex') };
  }) };
}
const store: ListedDeclaration = { specId: 'store', kind: 'concept', name: 'Store', references: [], members: [] };
describe('Markdown definitions and links', () => {
  it('keeps two rendered namespaces separate while following their actual links', () => {
    const selected = renderList('markdown', 'contract-list', 'Store.md', store, new Map());
    const foreign = renderList('markdown', 'guide', 'guide/Store.md', { ...store, references: [{ role: 'use', specId: 'store' }] },
      new Map([['store', { path: 'Store.md', name: 'Store' }]]));
    const files = snapshot({ 'Store.md': selected, 'guide/Store.md': foreign });
    const found = new ListDocuments('markdown', 'contract-list', files).search('store');
    expect(found.problems).toEqual([]); expect(found.definitions).toHaveLength(1);
    expect(found.incoming.uses.map(use => use.target)).toEqual([{ kind: 'project', id: 'guide/Store.md' }]);
  });
  it('recognizes a valid foreign anchor as a project target without claiming its identity', () => {
    const selected = renderList('markdown', 'contract-list', 'Store.md', store, new Map());
    const foreign = renderList('markdown', 'guide', 'guide/Store.md', store, new Map());
    const source = Buffer.from(selected).toString() + '\n[guide](guide/Store.md#expec-73746f7265)\n';
    const result = new ListDocuments('markdown', 'contract-list', snapshot({ 'Store.md': source, 'guide/Store.md': foreign })).search('store');
    expect(result.outgoing.uses.map(use => use.target)).toEqual([{ kind: 'project', id: 'guide/Store.md#expec-73746f7265' }]);
    expect(result.outgoing.coverage.complete).toBe(true);
  });
  it('does not accept a blank foreign namespace or mixed nested namespaces', () => {
    const blank = renderList('markdown', ' ', 'Blank.md', store, new Map());
    const current = renderList('markdown', 'contract-list', 'Store.md', store, new Map());
    const foreign = renderList('markdown', 'guide', 'Guide.md', { ...store, specId: 'guide' }, new Map());
    const nested = Buffer.from(current).toString().replace('<!-- expec-end:', Buffer.from(foreign).toString() + '\n<!-- expec-end:');
    for (const contents of [blank, nested]) {
      const result = new ListDocuments('markdown', 'contract-list', snapshot({ 'Store.md': contents })).search('store');
      expect(result.incoming.coverage.complete).toBe(false); expect(result.problems.length).toBeGreaterThan(0);
    }
  });
  it('does not invent a foreign anchor from metadata when its actual HTML anchor is missing', () => {
    const selected = renderList('markdown', 'contract-list', 'Store.md', store, new Map());
    const foreign = Buffer.from(renderList('markdown', 'guide', 'guide/Store.md', store, new Map())).toString().replace('<a id="expec-73746f7265"></a>', '');
    const source = Buffer.from(selected).toString() + '\n[guide](guide/Store.md#expec-73746f7265)\n';
    const result = new ListDocuments('markdown', 'contract-list', snapshot({ 'Store.md': source, 'guide/Store.md': foreign })).search('store');
    expect(result.outgoing.uses).toEqual([]); expect(result.outgoing.unresolved).toHaveLength(1);
    expect(result.outgoing.coverage.complete).toBe(false);
  });
  it('keeps selected metadata readable but rejects a link to its missing native anchor', () => {
    const selected = Buffer.from(renderList('markdown', 'contract-list', 'Store.md', store, new Map())).toString().replace('<a id="expec-73746f7265"></a>', '');
    const documents = new ListDocuments('markdown', 'contract-list', snapshot({ 'Store.md': selected,
      'notes.md': '[store](Store.md#expec-73746f7265)' }));
    expect(documents.read('store').artifacts).toHaveLength(1);
    const result = documents.search('store');
    expect(result.incoming.uses).toEqual([]); expect(result.incoming.unresolved).toHaveLength(1);
    expect(result.incoming.coverage.complete).toBe(false);
  });
  it('reads emitted identity anchors as complete supported Markdown', () => {
    const file = renderList('markdown', 'contract-list', 'Store.md', store, new Map());
    const found = new ListDocuments('markdown', 'contract-list', snapshot({ 'Store.md': file })).search('store');
    expect(found.problems).toEqual([]); expect(found.incoming.coverage.complete).toBe(true);
  });
  it('finds encoded inline and reference links but ignores fenced samples and images', () => {
    const file = renderList('markdown', 'contract-list', 'Store Game.md', store, new Map());
    const documents = new ListDocuments('markdown', 'contract-list', snapshot({ 'Store Game.md': file,
      'notes.md': '[one](Store%20Game.md)\n[two][game]\n\n[game]: Store%20Game.md\n\n![image](Store%20Game.md)\n\n```md\n[sample](Store%20Game.md)\n```' }));
    expect(documents.search('store').incoming.uses).toHaveLength(2);
  });
  it('accepts ordinary unmatched brackets and ignores remote hyperlinks', () => {
    const file = renderList('markdown', 'contract-list', 'Store.md', store, new Map());
    const result = new ListDocuments('markdown', 'contract-list', snapshot({ 'Store.md': file, 'notes.md': '[unfinished text\n[remote](https://example.test/Store.md)' })).search('store');
    expect(result.incoming.coverage.complete).toBe(true); expect(result.incoming.uses).toEqual([]);
  });
  it('reports invalid escapes and unknown fragments without inventing targets', () => {
    const file = renderList('markdown', 'contract-list', 'Store.md', store, new Map());
    const result = new ListDocuments('markdown', 'contract-list', snapshot({ 'Store.md': file, 'notes.md': '[bad](%ZZ.md) [fragment](Store.md#guessed-heading)' })).search('store');
    expect(result.incoming.coverage.complete).toBe(false); expect(result.incoming.unresolved).toHaveLength(2); expect(result.incoming.uses).toEqual([]);
  });
  it('keeps nested identity sections readable beyond six heading levels', () => {
    let nested: ListedDeclaration = { specId: 'leaf', kind: 'concept', name: 'Leaf', references: [], members: [] };
    for (let depth = 7; depth >= 1; depth--) nested = { specId: 'level-' + depth, kind: 'concept', name: 'Level' + depth, references: [], members: [nested] };
    const file = renderList('markdown', 'contract-list', 'Nested.md', nested, new Map());
    const result = new ListDocuments('markdown', 'contract-list', snapshot({ 'Nested.md': file })).search('leaf');
    expect(result.problems).toEqual([]); expect(result.definitions).toHaveLength(1); expect(result.incoming.coverage.complete).toBe(true);
  });
});
