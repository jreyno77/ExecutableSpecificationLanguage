import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ListDocuments } from '../../../../src/project/output/output-documents.js';
import type { ProjectSnapshot } from '../../../../src/index.js';

const hex = (text: string) => Buffer.from(text).toString('hex');
const anchor = (id: string) => '<a id="expec-' + hex(id) + '"></a>\n\n';
const end = (id: string) => '<!-- expec-end:' + hex(id) + ' -->\n\n';
const link = (id: string) => '[' + id + '](#expec-' + hex(id) + ')\n\n';
function section(id: string, content = '', options: { owner?: unknown; depth?: number; outputId?: string; fragment?: boolean } = {}) {
  const metadata = { outputId: options.outputId ?? 'markdown', specId: id,
    ...Object.hasOwn(options, 'owner') ? { owner: options.owner } : {} };
  return '<!-- expec-' + (options.fragment ? 'fragment' : 'section') + ':' + hex(JSON.stringify(metadata)) + ' -->\n\n'
    + (options.fragment ? '' : '#'.repeat(options.depth ?? 2) + ' ' + id + '\n\n') + anchor(id) + content + end(id);
}
function page(key: string, content: string, outputId = 'markdown', kind = 'source') {
  return '<!-- expec-page:' + hex(JSON.stringify({ outputId, kind, key })) + ' -->\n\n# ' + key + '\n\n'
    + content + '<!-- expec-page-end:' + hex(key) + ' -->\n\n';
}
function read(files: Record<string, string>) {
  const snapshot: ProjectSnapshot = { root: { path: '/fixture', identity: 'fixture' }, complete: true,
    excluded: [], excludeNames: [], problems: [], files: Object.entries(files).map(([path, text]) => {
      const bytes = Buffer.from(text); return { path, bytes, version: createHash('sha256').update(bytes).digest('hex') };
    }) };
  return new ListDocuments('markdown', 'markdown', snapshot);
}
function expectRefused(documents: ListDocuments, subject: string) {
  expect(documents.read(subject).coverage.complete).toBe(false);
  expect(documents.search(subject).outgoing.coverage.complete).toBe(false);
  expect(documents.problems.map(problem => problem.code)).toContain('invalid-output-document');
}

describe('Markdown ownership independent of displayed grouping', () => {
  it('retains a displaced local type in its original owner search and logical roots', () => {
    const documents = read({ 'pages/library.md': page('library.expec', section('Library')
      + '## Glossary\n\n' + section('State', section('value', link('State'), { fragment: true }), { owner: 'Library', depth: 3 })) });
    expect(documents.problems).toEqual([]);
    expect(documents.definitions.map(({ id, ancestors }) => ({ id, ancestors }))).toEqual([
      { id: 'Library', ancestors: [] }, { id: 'State', ancestors: ['Library'] }, { id: 'value', ancestors: ['Library', 'State'] },
    ]);
    expect(documents.definitions.filter(definition => !definition.ancestors.length).map(definition => definition.id)).toEqual(['Library']);
    expect(documents.search('Library').outgoing.uses.map(use => use.target)).toEqual([{ kind: 'specified', id: 'State' }]);
    expect(documents.search('State').incoming.uses.map(use => use.target)).toEqual([{ kind: 'specified', id: 'value' }]);
    expect(documents.read('State').coverage.complete).toBe(true);
  });

  it('resolves a complete logical owner chain even when owners appear later', () => {
    const documents = read({ 'pages/library.md': page('library.expec',
      section('Token', '', { owner: 'Cache' }) + section('Cache', '', { owner: 'Library' }) + section('Library')) });
    expect(documents.problems).toEqual([]);
    expect(documents.definitions.find(definition => definition.id === 'Token')?.ancestors).toEqual(['Library', 'Cache']);
    expect(documents.read('Token').coverage.complete).toBe(true);
  });

  it('keeps an explicit-root example link out of its displayed capability owner', () => {
    const documents = read({ 'pages/relay.md': page('relay.expec',
      section('Relay', section('send', section('examples', section('one-delivery', link('Payload'), { depth: 5 }),
        { owner: null, depth: 4 }), { depth: 3 })) + section('Payload')) });
    expect(documents.problems).toEqual([]);
    expect(documents.definitions.find(definition => definition.id === 'examples')?.ancestors).toEqual([]);
    expect(documents.definitions.find(definition => definition.id === 'one-delivery')?.ancestors).toEqual(['examples']);
    expect(documents.search('Relay').outgoing.uses).toEqual([]);
    expect(documents.search('send').outgoing.uses).toEqual([]);
    expect(documents.search('examples').outgoing.uses.map(use => use.target)).toEqual([{ kind: 'specified', id: 'Payload' }]);
    expect(documents.search('Payload').incoming.uses.map(use => use.target)).toEqual([{ kind: 'specified', id: 'one-delivery' }]);
  });

  it('retains physical ownership for existing markers without an owner member', () => {
    const documents = read({ 'legacy.md': section('Library', section('State', section('value', link('State'), { fragment: true }), { depth: 3 })) });
    expect(documents.problems).toEqual([]);
    expect(documents.definitions.find(definition => definition.id === 'value')?.ancestors).toEqual(['Library', 'State']);
    expect(documents.search('Library').outgoing.uses.map(use => use.target)).toEqual([{ kind: 'specified', id: 'State' }]);
    expect(documents.read('State').coverage.complete).toBe(true);
  });

  it('allows an explicit root in a legacy document without granting it a new owner', () => {
    const documents = read({ 'legacy.md': section('Library', section('examples', '', { owner: null, depth: 3 })) });
    expect(documents.problems).toEqual([]);
    expect(documents.definitions.find(definition => definition.id === 'examples')?.ancestors).toEqual([]);
  });

  it('refuses a missing owner instead of silently treating its child as a root', () => {
    expectRefused(read({ 'pages/library.md': page('library.expec', section('State', '', { owner: 'Missing' })) }), 'State');
  });

  it('refuses an owner from another source page of the same output', () => {
    expectRefused(read({ 'pages/state.md': page('state.expec', section('State', '', { owner: 'Library' })),
      'pages/library.md': page('library.expec', section('Library')) }), 'State');
  });

  it('refuses an owner that belongs to another output', () => {
    expectRefused(read({ 'pages/state.md': page('state.expec', section('State', '', { owner: 'Library' })),
      'other.md': page('library.expec', section('Library', '', { outputId: 'contract-list' }), 'contract-list') }), 'State');
  });

  it('refuses an ambiguous same-page owner', () => {
    expectRefused(read({ 'pages/library.md': page('library.expec', section('Library') + section('Library')
      + section('State', '', { owner: 'Library' })) }), 'State');
  });

  it('refuses self ownership', () => {
    expectRefused(read({ 'pages/library.md': page('library.expec', section('State', '', { owner: 'State' })) }), 'State');
  });

  it('refuses a cycle through explicitly relocated owners', () => {
    expectRefused(read({ 'pages/library.md': page('library.expec', section('State', '', { owner: 'Cache' })
      + section('Cache', '', { owner: 'State' })) }), 'State');
  });

  it('refuses a cycle combining explicit ownership with an omitted physical parent', () => {
    expectRefused(read({ 'pages/library.md': page('library.expec',
      section('Library', section('State', '', { depth: 3 }), { owner: 'State' })) }), 'Library');
  });

  it('refuses a non-identifier owner value', () => {
    expectRefused(read({ 'pages/library.md': page('library.expec', section('State', '', { owner: 7 })) }), 'State');
  });

  it('refuses a blank owner identifier', () => {
    expectRefused(read({ 'pages/library.md': page('library.expec', section('State', '', { owner: ' ' })) }), 'State');
  });

  it('requires a native source page before accepting a string owner', () => {
    expectRefused(read({ 'legacy.md': section('Library') + section('State', '', { owner: 'Library' }) }), 'State');
  });

  it('does not accept a string owner on Home', () => {
    expectRefused(read({ 'Home.md': page('Home', section('Library') + section('State', '', { owner: 'Library' }), 'markdown', 'home') }), 'State');
  });

  it('still rejects physically invalid headings despite an explicit root override', () => {
    expectRefused(read({ 'pages/library.md': page('library.expec', section('Library', section('examples', '', { owner: null, depth: 2 }))) }), 'examples');
  });
});
