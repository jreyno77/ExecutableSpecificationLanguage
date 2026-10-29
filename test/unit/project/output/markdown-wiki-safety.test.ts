import { expect, it } from 'vitest';
import { MarkdownPlans } from '../../../driver/project/output/markdown-plans.js';

const marker = (id: string) => '<!-- expec-section:' + Buffer.from(JSON.stringify({ outputId: 'markdown', specId: id })).toString('hex') + ' -->';
const end = (id: string) => '<!-- expec-end:' + Buffer.from(id).toString('hex') + ' -->';
function section(caller: MarkdownPlans, name: string): string {
  const text = caller.text('docs/pages/fixture.md'), id = caller.id(name), start = text.indexOf(marker(id));
  return text.slice(start, text.indexOf(end(id), start));
}

it('nests operation contents beneath their actual declaration heading', async () => {
  const caller = new MarkdownPlans();
  caller.source('concept Library { capability borrow() returns Nothing }');
  await caller.create();
  expect(caller.text('docs/pages/fixture.md')).toContain('\n  - [borrow](#expec-' + Buffer.from(caller.id('borrow')).toString('hex') + ')');
});

it('presents literal error alternatives once while retaining the real code leaf', async () => {
  const caller = new MarkdownPlans();
  caller.source('error type DownloadError { code: "failed" | "cancelled"\npayload: Text }');
  await caller.create();
  const text = section(caller, 'DownloadError');
  expect(text.match(/failed/g)).toHaveLength(1);
  expect(text.match(/cancelled/g)).toHaveLength(1);
  expect((await caller.output.read(caller.id('code'))).artifacts).toHaveLength(1);
  expect((await caller.output.search(caller.id('code'))).incoming.coverage.complete).toBe(true);
  expect(caller.text('docs/pages/fixture.md')).toContain('payload');
});

it('retains an error code alias link and its expanded alternatives inside the code leaf', async () => {
  const caller = new MarkdownPlans();
  caller.source('type FailureCode = "failed" | "cancelled"\nerror type DownloadError { code: FailureCode\npayload: Text }');
  await caller.create();
  const found = await caller.output.search(caller.id('code'));
  expect(found.outgoing.uses.some(use => use.target.kind === 'specified' && use.target.id === caller.id('FailureCode'))).toBe(true);
  const text = section(caller, 'DownloadError'), code = caller.id('code'), at = text.indexOf('<!-- expec-fragment:' + Buffer.from(JSON.stringify({ outputId: 'markdown', specId: code })).toString('hex') + ' -->');
  const leaf = text.slice(at, text.indexOf(end(code), at));
  expect(leaf).toContain('Codes: failed, cancelled');
  expect(leaf).toContain('#expec-' + Buffer.from(caller.id('FailureCode')).toString('hex'));
});

it('does not let an unowned navigation envelope hide a semantic-anchor backlink', async () => {
  const caller = new MarkdownPlans();
  caller.source('type Book { title: Text }\nconcept Library {}');
  await caller.create();
  const book = caller.id('Book'), key = 'notes.expec';
  const page = '<!-- expec-page:' + Buffer.from(JSON.stringify({ outputId: 'markdown', kind: 'source', key })).toString('hex') + ' -->';
  caller.edit('notes/native.md', page + '\n\n# Notes\n\n<!-- expec-navigation -->\n\n[Book](../docs/pages/fixture.md#expec-' + Buffer.from(book).toString('hex') + ')\n\n<!-- expec-navigation-end -->\n\n<!-- expec-page-end:' + Buffer.from(key).toString('hex') + ' -->\n\n');
  const before = caller.snapshot.files.map(file => ({ path: file.path, version: file.version, bytes: [...file.bytes] }));
  caller.source('concept Library {}', ['Book']);
  const result = await caller.plan('update');
  expect(result.value).toBeUndefined();
  expect(result.problems.some(problem => problem.code === 'output-conflict' && JSON.stringify(problem.at).includes('notes/native.md'))).toBe(true);
  expect(caller.snapshot.files.map(file => ({ path: file.path, version: file.version, bytes: [...file.bytes] }))).toEqual(before);
});
