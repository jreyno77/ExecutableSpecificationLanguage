import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ListDocuments } from '../../../../src/project/output/output-documents.js';
import type { ProjectSnapshot } from '../../../../src/index.js';

// Independent literal native documents exercise the reader, not the renderer.
const hex = (text: string) => Buffer.from(text).toString('hex');
const start = (key: string, kind: 'home' | 'source' = 'source', outputId = 'markdown') =>
  '<!-- expec-page:' + hex(JSON.stringify({ outputId, kind, key })) + ' -->\n\n';
const end = (key: string) => '<!-- expec-page-end:' + hex(key) + ' -->\n\n';
const page = (key: string, content: string, kind: 'home' | 'source' = 'source', outputId = 'markdown') => start(key, kind, outputId) + content + end(key);
const navigation = (content: string) => '<!-- expec-navigation -->\n\n' + content + '\n\n<!-- expec-navigation-end -->\n\n';
const marker = (kind: 'section' | 'fragment', id: string, outputId: string) =>
  '<!-- expec-' + kind + ':' + hex(JSON.stringify({ outputId, specId: id })) + ' -->\n\n';
const anchor = (id: string) => '<a id="expec-' + hex(id) + '"></a>\n\n';
const sectionEnd = (id: string) => '<!-- expec-end:' + hex(id) + ' -->\n\n';
const section = (id: string, content = '', outputId = 'markdown') => marker('section', id, outputId) + '## ' + id + '\n\n' + anchor(id) + content + sectionEnd(id);
const fragment = (id: string, content: string) => marker('fragment', id, 'markdown') + anchor(id) + content + sectionEnd(id);
function scan(contents: Record<string, string>, outputId = 'markdown'): ListDocuments {
  const snapshot: ProjectSnapshot = { root: { path: '/fixture', identity: 'fixture' }, complete: true, excluded: [], excludeNames: [], problems: [],
    files: Object.entries(contents).map(([path, text]) => { const bytes = Buffer.from(text); return { path, bytes, version: createHash('sha256').update(bytes).digest('hex') }; }) };
  return new ListDocuments('markdown', outputId, snapshot);
}
const grouped = () => page('library.expec', '# Library specification\n\n' + section('Book') + section('Library'));

describe('source-page Markdown navigation', () => {
  it('reads several real declarations from one page without inventing a page declaration', () => {
    const documents = scan({ 'pages/library.md': grouped(), 'Home.md': page('Home', '# Home\n\n', 'home') });
    expect(documents.problems).toEqual([]);
    expect(documents.definitions.map(definition => definition.id)).toEqual(['Book', 'Library']);
    expect(documents.search('Book').incoming.coverage.complete).toBe(true);
    expect(documents.search('Home').definitions).toEqual([]);
    expect(documents.search('library.expec').definitions).toEqual([]);
  });

  it('resolves a whole-page link to the page rather than an ambiguous declaration', () => {
    const found = scan({ 'reference.md': section('Reader', '[Library](pages/library.md)\n\n'), 'pages/library.md': grouped() }).search('Reader');
    expect(found.problems).toEqual([]);
    expect(found.outgoing.uses.map(use => use.target)).toEqual([{ kind: 'project', id: 'pages/library.md' }]);
    expect(found.outgoing.unresolved).toEqual([]);
    expect(found.outgoing.coverage.complete).toBe(true);
  });

  it('keeps generated navigation as real project references without attributing it to the first declaration', () => {
    const documents = scan({
      'pages/library.md': page('library.expec', '# Library\n\n'
        + navigation('[Library](#expec-' + hex('Library') + ')')
        + section('Book', '[Library](#expec-' + hex('Library') + ')\n\n') + section('Library')
        + navigation('[Home](../Home.md)')),
      'Home.md': page('Home', '# Home\n\n' + navigation('[Library](pages/library.md)'), 'home'),
    });
    const book = documents.search('Book'), library = documents.search('Library');
    expect(documents.problems).toEqual([]);
    expect(book.outgoing.uses.map(use => use.target)).toEqual([{ kind: 'specified', id: 'Library' }]);
    expect(library.incoming.uses.map(use => use.target)).toEqual([{ kind: 'specified', id: 'Book' }]);
    expect(documents.edges.filter(edge => edge.target?.kind === 'project').map(edge => edge.target)).toEqual([
      { kind: 'project', id: 'pages/library.md#expec-' + hex('Library') },
      { kind: 'project', id: 'Home.md' }, { kind: 'project', id: 'pages/library.md' },
    ]);
    expect(library.incoming.coverage.complete).toBe(true);
  });

  it('retains a handwritten same-page anchor link outside generated navigation', () => {
    const documents = scan({ 'pages/library.md': page('library.expec', '# Library\n\n'
      + navigation('[Book](#expec-' + hex('Book') + ')') + section('Book') + section('Library'))
      + '## My notes\n\n[Book](#expec-' + hex('Book') + ')\n' });
    const book = documents.search('Book');
    expect(documents.problems).toEqual([]);
    expect(book.incoming.uses.map(use => use.target)).toEqual([{ kind: 'project', id: 'pages/library.md' }]);
    expect(documents.edges.filter(edge => edge.navigation).map(edge => edge.target)).toEqual([
      { kind: 'project', id: 'pages/library.md#expec-' + hex('Book') },
    ]);
    expect(documents.search('Library').outgoing.uses).toEqual([]);
    expect(book.incoming.coverage.complete).toBe(true);
  });

  it('requires an actual anchor before retaining a navigation fragment as a project reference', () => {
    const documents = scan({ 'pages/library.md': page('library.expec', '# Library\n\n'
      + navigation('[Missing](#expec-' + hex('Missing') + ')') + section('Book')) });
    const book = documents.search('Book');
    expect(documents.edges).toHaveLength(1);
    expect(documents.edges[0]!.target).toBeUndefined();
    expect(documents.edges[0]!.reason).toBe('Missing project anchor: #expec-' + hex('Missing'));
    expect(book.incoming.uses).toEqual([]);
    expect(book.incoming.coverage.complete).toBe(false);
  });
  it('keeps each compact input link owned by its actual semantic leaf', () => {
    const documents = scan({
      'pages/relay.md': page('relay.expec', '# Relay\n\n' + section('save', 'Inputs\n\n'
        + fragment('save.payload', '**payload** — [Payload](types.md#expec-' + hex('Payload') + ')\n\n')
        + fragment('save.config', '**config** — [Config](types.md#expec-' + hex('Config') + ')\n\n'))),
      'pages/types.md': page('types.expec', '# Types\n\n' + section('Payload') + section('Config')),
    });
    expect(documents.problems).toEqual([]);
    expect(documents.search('save.payload').outgoing.uses.map(use => use.target)).toEqual([{ kind: 'specified', id: 'Payload' }]);
    expect(documents.search('save.config').outgoing.uses.map(use => use.target)).toEqual([{ kind: 'specified', id: 'Config' }]);
    expect(documents.search('Payload').incoming.uses.map(use => use.target)).toEqual([{ kind: 'specified', id: 'save.payload' }]);
  });

  it('reads Home and an empty source without fabricated semantic anchors', () => {
    const documents = scan({
      'Home.md': page('Home', '# Home\n\n' + navigation('[Empty](pages/empty.md)'), 'home'),
      'pages/empty.md': page('empty.expec', '# Empty\n\n' + navigation('[Home](../Home.md)')),
    });
    expect(documents.problems).toEqual([]);
    expect(documents.definitions).toEqual([]);
    expect(documents.edges.map(edge => edge.target)).toEqual([
      { kind: 'project', id: 'pages/empty.md' }, { kind: 'project', id: 'Home.md' },
    ]);
  });

  it('keeps foreign page declarations outside the current semantic namespace', () => {
    const documents = scan({
      'current.md': section('Reader', '[Whole page](foreign.md)\n\n[Book](foreign.md#expec-' + hex('Book') + ')\n\n'),
      'foreign.md': page('library.expec', '# Foreign\n\n' + section('Book', '', 'other-docs'), 'source', 'other-docs'),
    });
    expect(documents.problems).toEqual([]);
    expect(documents.search('Book').definitions).toEqual([]);
    expect(documents.search('Reader').outgoing.uses.map(use => use.target)).toEqual([
      { kind: 'project', id: 'foreign.md' }, { kind: 'project', id: 'foreign.md#expec-' + hex('Book') },
    ]);
    expect(documents.search('Reader').outgoing.coverage.complete).toBe(true);
  });
});

describe('native page envelopes preserve complete coverage', () => {
  it('rejects an unclosed source page', () => {
    const found = scan({ 'bad.md': start('library.expec') + '# Library\n\n' + section('Library') }).search('Library');
    expect(found.incoming.coverage.complete).toBe(false);
    expect(found.problems.map(problem => problem.code)).toContain('invalid-output-document');
  });

  it('rejects a mismatched page end instead of accepting its contained declarations as complete', () => {
    const found = scan({ 'bad.md': start('library.expec') + '# Library\n\n' + section('Library') + end('other.expec') }).search('Library');
    expect(found.incoming.coverage.complete).toBe(false);
    expect(found.problems.map(problem => problem.code)).toContain('invalid-output-document');
  });

  it('rejects duplicate source-page keys across current files', () => {
    const found = scan({ 'one.md': page('library.expec', '# First\n\n' + section('First')), 'two.md': page('library.expec', '# Second\n\n' + section('Second')) }).search('First');
    expect(found.incoming.coverage.complete).toBe(false);
    expect(found.problems.map(problem => problem.code)).toContain('invalid-output-document');
  });

  it('rejects one native page nested inside another', () => {
    const found = scan({ 'bad.md': page('outer.expec', '# Outer\n\n' + page('inner.expec', '# Inner\n\n' + section('Inner'))) }).search('Inner');
    expect(found.incoming.coverage.complete).toBe(false);
    expect(found.problems.map(problem => problem.code)).toContain('invalid-output-document');
  });

  it('rejects multiple generated page envelopes in one physical document', () => {
    const found = scan({ 'bad.md': page('first.expec', '# First\n\n' + section('First')) + page('second.expec', '# Second\n\n' + section('Second')) }).search('First');
    expect(found.incoming.coverage.complete).toBe(false);
    expect(found.problems.map(problem => problem.code)).toContain('invalid-output-document');
  });

  it('rejects a navigation envelope outside a source or Home page', () => {
    const found = scan({ 'bad.md': navigation('[Library](#expec-' + hex('Library') + ')') + section('Library') }).search('Library');
    expect(found.incoming.coverage.complete).toBe(false);
    expect(found.problems.map(problem => problem.code)).toContain('invalid-output-document');
  });

  it('rejects navigation inside a semantic leaf instead of dropping its references', () => {
    const found = scan({ 'bad.md': page('library.expec', '# Library\n\n' + section('save', fragment('input', navigation('[save](#expec-' + hex('save') + ')')))) }).search('input');
    expect(found.incoming.coverage.complete).toBe(false);
    expect(found.problems.map(problem => problem.code)).toContain('invalid-output-document');
  });

  it('rejects an unclosed navigation envelope', () => {
    const found = scan({ 'bad.md': page('library.expec', '# Library\n\n<!-- expec-navigation -->\n\n[Library](#expec-' + hex('Library') + ')\n\n' + section('Library')) }).search('Library');
    expect(found.incoming.coverage.complete).toBe(false);
    expect(found.problems.map(problem => problem.code)).toContain('invalid-output-document');
  });

  it('keeps arbitrary HTML unsupported inside a valid page', () => {
    const found = scan({ 'bad.md': page('library.expec', '# Library\n\n<details>Hidden</details>\n\n' + section('Library')) }).search('Library');
    expect(found.incoming.coverage.complete).toBe(false);
    expect(found.problems.map(problem => problem.code)).toContain('invalid-output-document');
  });
});
