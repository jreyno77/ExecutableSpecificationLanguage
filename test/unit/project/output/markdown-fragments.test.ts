import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { ListDocuments } from '../../../../src/project/output/output-documents.js';
import type { ProjectSnapshot } from '../../../../src/index.js';

const marker = (kind: string, id: string, outputId = 'markdown') => '<!-- expec-' + kind + ':' + Buffer.from(JSON.stringify({ outputId, specId: id })).toString('hex') + ' -->\n\n';
const anchor = (id: string) => '<a id="expec-' + Buffer.from(id).toString('hex') + '"></a>\n\n';
const end = (id: string) => '<!-- expec-end:' + Buffer.from(id).toString('hex') + ' -->\n\n';
const fragment = (id: string, content = '', outputId = 'markdown') => marker('fragment', id, outputId) + anchor(id) + content + end(id);
const section = (content: string, outputId = 'markdown', id = 'save') => marker('section', id, outputId) + '# ' + id + '\n\n' + anchor(id) + content + end(id);
function scan(contents: Record<string, string>, outputId = 'markdown') {
  const snapshot: ProjectSnapshot = { root: { path: '/fixture', identity: 'fixture' }, complete: true, excluded: [], excludeNames: [], problems: [],
    files: Object.entries(contents).map(([path, text]) => { const bytes = Buffer.from(text); return { path, bytes, version: createHash('sha256').update(bytes).digest('hex') }; }) };
  return new ListDocuments('markdown', outputId, snapshot);
}
describe('compact Markdown leaf identity boundaries', () => {
  it('locates a leaf and attributes its real links without a heading', () => {
    const found = scan({ 'save.md': section(fragment('input', 'Parameter: snapshot\n\n[type](type.md)\n\n')), 'type.md': section('', 'markdown', 'type') }).search('input');
    expect(found.definitions).toHaveLength(1);
    expect(found.outgoing.uses.map(use => use.target)).toEqual([{ kind: 'specified', id: 'type' }]);
    expect(found.incoming.coverage.complete).toBe(true);
  });
  it('requires a fragment to have a containing headed section', () => {
    const found = scan({ 'bad.md': fragment('input') }).search('input');
    expect(found.incoming.coverage.complete).toBe(false); expect(found.problems.map(problem => problem.code)).toContain('invalid-output-document');
  });
  it('rejects a fragment nested inside another fragment', () => {
    const found = scan({ 'bad.md': section(fragment('input', fragment('nested'))) }).search('input');
    expect(found.incoming.coverage.complete).toBe(false);
  });
  it('rejects a normal section nested inside a fragment', () => {
    const found = scan({ 'bad.md': section(fragment('input', marker('section', 'nested') + '## nested\n\n' + anchor('nested') + end('nested'))) }).search('input');
    expect(found.incoming.coverage.complete).toBe(false);
  });
  it('rejects a heading inside a leaf fragment', () => {
    const found = scan({ 'bad.md': section(fragment('input', '## escaped\n\n')) }).search('input');
    expect(found.incoming.coverage.complete).toBe(false);
  });
  it('requires the actual fragment anchor even when metadata names its identity', () => {
    const found = scan({ 'bad.md': section(fragment('input').replace(anchor('input'), '')) }).search('input');
    expect(found.incoming.coverage.complete).toBe(false); expect(found.problems.map(problem => problem.code)).toContain('invalid-output-document');
  });
  it('rejects duplicate actual anchors within one fragment', () => {
    const found = scan({ 'bad.md': section(fragment('input', anchor('input'))) }).search('input');
    expect(found.incoming.coverage.complete).toBe(false);
  });
  it('does not accept an unclosed fragment at the end of its parent', () => {
    const found = scan({ 'bad.md': section(fragment('input').replace(end('input'), '')) }).search('input');
    expect(found.incoming.coverage.complete).toBe(false);
  });
  it('uses a foreign fragment actual anchor as a project-only destination', () => {
    const files = { 'current.md': section('[other](foreign.md#expec-696e707574)\n\n'),
      'foreign.md': section(fragment('input', '', 'contract-list'), 'contract-list') };
    const found = scan(files).search('save');
    expect(found.definitions).toHaveLength(1);
    expect(found.outgoing.uses.map(use => use.target)).toEqual([{ kind: 'project', id: 'foreign.md#expec-696e707574' }]);
    expect(found.outgoing.coverage.complete).toBe(true);
    expect(scan(files).search('input').definitions).toEqual([]);
  });
  it('does not resolve a foreign fragment link from metadata without an actual anchor', () => {
    const found = scan({ 'current.md': section('[other](foreign.md#expec-696e707574)\n\n'),
      'foreign.md': section(fragment('input', '', 'contract-list').replace(anchor('input'), ''), 'contract-list') }).search('save');
    expect(found.outgoing.uses).toEqual([]); expect(found.outgoing.unresolved).toHaveLength(1);
    expect(found.outgoing.coverage.complete).toBe(false);
  });
});
