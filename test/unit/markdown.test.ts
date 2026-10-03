import { describe, expect, it } from 'vitest';
import { LangiumModel, LangiumReader, QueryInspection, type NodeKind } from '../../src/index.js';
import { language } from '../../src/language-text.js';
import { MarkdownPlans } from '../driver/markdown-plans.js';

function syntax(text: string, kind: NodeKind): string {
  const result = new LangiumReader().read({ sourceId: 'syntax.expec', text });
  if (result.status !== 'accepted') throw new Error(JSON.stringify(result.diagnostics));
  const inspected = new QueryInspection(new LangiumModel('syntax.expec', result.document));
  return language([...inspected.query(kind)][0]!);
}
describe('readable authored syntax', () => {
  it('retains arithmetic grouping and unary meaning', () => {
    expect(syntax('examples { example "math": -(2 + 3) * 4 => 0 }', 'example')).toBe('example "math": -(2 + 3) * 4 => 0');
  });
  it('retains boolean precedence and explicit groups', () => {
    expect(syntax('examples { example "logic": not (true or false) and true => false }', 'example')).toBe('example "logic": not (true or false) and true => false');
  });
  it('retains negative and exponent literal types without numeric conversion', () => {
    expect(syntax('type Limits = -1.250e+40 | 0.0000000000000000001', 'alias-type-declaration')).toBe('type Limits = -1.250e+40 | 0.0000000000000000001');
  });
  it('retains tuple, union, optional and nested generic types', () => {
    expect(syntax('type Items<T> = [List<T>, (Text | Number)?]', 'alias-type-declaration')).toBe('type Items<T> = [List<T>, (Text | Number)?]');
  });
  it('keeps explicit parameters and defaults separate from call arguments', () => {
    expect(syntax('function copy(count: Number = 1) returns Nothing', 'function')).toBe('function copy(count: Number = 1) returns Nothing');
    expect(syntax('examples { example "call": copy(3) => 1 }', 'example')).toBe('example "call": copy(3) => 1');
  });
  it('keeps quoted Unicode names and escaped text digestible', () => {
    expect(syntax('type `書籍` { `book title`: Text }', 'record-type-declaration')).toBe('type `書籍` {\n  `book title`: Text\n}');
  });
  it('preserves named and anonymous record and list data', () => {
    expect(syntax('examples { fixture books: List<Book> = [Book { title: "Dune" }, { title: "Emma" }] }', 'fixture'))
      .toBe('fixture books: List<Book> = [Book { title: "Dune" }, { title: "Emma" }]');
  });
  it('does not mistake literal backticks or metadata for document structure', async () => {
    const caller = new MarkdownPlans();
    caller.source('function intent() { promises "``` <!-- expec-section:bad --> [Game](Game.md)" }');
    await caller.create();
    const result = await caller.output.search(caller.id('intent'));
    expect(result.definitions).toHaveLength(1); expect(result.outgoing.uses).toEqual([]);
    expect(result.outgoing.coverage.complete).toBe(true);
    expect(caller.text('docs/intent.md')).toContain('````expec');
  });
});

describe('generated regions preserve actual surrounding bytes', () => {
  it('preserves a Unicode prefix and mixed-line-ending notes through an update', async () => {
    const caller = new MarkdownPlans(); caller.source('concept Game {}'); await caller.create();
    caller.edit('docs/Game.md', '📚 Reader preface\r\n\r\n' + caller.text('docs/Game.md') + 'Nightly backups.\r\n');
    caller.source('concept Game { capability save() returns Nothing }');
    const plan = await caller.plan('update'); expect(plan.problems).toEqual([]); caller.apply(plan.value!);
    expect(caller.text('docs/Game.md').startsWith('📚 Reader preface\r\n\r\n')).toBe(true);
    expect(caller.text('docs/Game.md').endsWith('Nightly backups.\r\n')).toBe(true);
  });
  it('preserves a UTF-8 BOM as handwritten prefix bytes', async () => {
    const caller = new MarkdownPlans(); caller.source('concept Game {}'); await caller.create();
    caller.edit('docs/Game.md', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), caller.bytes('docs/Game.md')]));
    caller.source('concept Game { capability save() returns Nothing }');
    const plan = await caller.plan('update'); expect(plan.problems).toEqual([]); caller.apply(plan.value!);
    expect([...caller.bytes('docs/Game.md').slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });
  it('does not rewrite exact replay after handwritten note edits', async () => {
    const caller = new MarkdownPlans(); caller.source('concept Game {}'); await caller.create();
    caller.edit('docs/Game.md', caller.text('docs/Game.md') + '\nNightly backups.\n');
    expect((await caller.plan()).value?.changes).toEqual([]);
    expect((await caller.plan('update')).value?.changes).toEqual([]);
  });
  it('catches up to complete current content after a skipped output build', async () => {
    const caller = new MarkdownPlans(); caller.source('concept Game {}'); await caller.create();
    caller.source('concept Game { capability save() returns Nothing }');
    caller.source('concept Game { capability save() returns Nothing\ncapability start() returns Nothing }');
    const plan = await caller.plan('update'); expect(plan.problems).toEqual([]); caller.apply(plan.value!);
    expect(caller.text('docs/Game.md')).toContain('capability save() returns Nothing');
    expect(caller.text('docs/Game.md')).toContain('capability start() returns Nothing');
  });
  it('rejects a second root marker added outside the recorded generated region', async () => {
    const caller = new MarkdownPlans(); caller.source('concept Game {}'); await caller.create();
    const metadata = Buffer.from(JSON.stringify({ outputId: 'markdown', specId: 'unowned-root' })).toString('hex');
    caller.edit('docs/Game.md', caller.text('docs/Game.md') + '<!-- expec-section:' + metadata + ' -->\n\n# Extra\n\n<a id="expec-' + Buffer.from('unowned-root').toString('hex') + '"></a>\n\n<!-- expec-end:' + Buffer.from('unowned-root').toString('hex') + ' -->\n\n');
    const plan = await caller.plan('update'); expect(plan.value).toBeUndefined(); expect(plan.problems.map(problem => problem.code)).toContain('output-conflict');
  });
  it('refuses removal after even whitespace-only handwritten changes', async () => {
    const caller = new MarkdownPlans(); caller.source('concept Game {}'); await caller.create();
    caller.edit('docs/Game.md', caller.text('docs/Game.md') + ' ');
    const plan = await caller.output.plan({ operation: 'delete', id: caller.id('Game') }, caller.snapshot);
    expect(plan.value).toBeUndefined(); expect(plan.problems.map(problem => problem.code)).toContain('handwritten-document-content');
  });
  it('removes owned mutually referring pages in one coherent plan', async () => {
    const caller = new MarkdownPlans(); caller.source('type A { other: B? }\ntype B { other: A? }'); await caller.create();
    caller.source('', ['A', 'B']);
    const plan = await caller.plan('update'); expect(plan.problems).toEqual([]);
    expect(plan.value?.changes.filter(change => change.kind === 'remove').map(change => change.path)).toEqual(['docs/A.md', 'docs/B.md']);
  });
  it('does not claim mutation ownership after a manually moved document', async () => {
    const caller = new MarkdownPlans(); caller.source('concept Game {}'); await caller.create();
    caller.edit('notes/Game.md', caller.bytes('docs/Game.md')); caller.remove('docs/Game.md');
    expect((await caller.output.read(caller.id('Game'))).artifacts.map(item => item.file.path)).toEqual(['notes/Game.md']);
    const plan = await caller.plan('update'); expect(plan.value).toBeUndefined(); expect(plan.problems.map(problem => problem.code)).toContain('output-conflict');
  });
  it('does not let caller mutation of returned bytes alter later reads', async () => {
    const caller = new MarkdownPlans(); caller.source('concept Game {}'); await caller.create();
    const first = await caller.output.read(caller.id('Game')); first.artifacts[0]!.file.bytes.fill(0);
    const second = await caller.output.read(caller.id('Game'));
    expect(Buffer.from(second.artifacts[0]!.file.bytes).toString('utf8')).toContain('# Game');
  });
  it('refuses corrupt note bytes before creating unrelated new pages', async () => {
    const caller = new MarkdownPlans(); caller.source('concept Game {}'); caller.edit('notes.md', Uint8Array.from([0xff]));
    const plan = await caller.plan(); expect(plan.value).toBeUndefined(); expect(plan.problems.map(problem => problem.code)).toContain('invalid-output-document');
  });
  it('keeps a missing recorded file different from a new absent document', async () => {
    const caller = new MarkdownPlans(); caller.source('concept Game {}'); await caller.create(); caller.remove('docs/Game.md');
    expect((await caller.plan()).problems.map(problem => problem.code)).toContain('output-conflict');
  });
  it('rejects modified generated boundaries without rewriting notes', async () => {
    const caller = new MarkdownPlans(); caller.source('concept Game {}'); await caller.create();
    caller.edit('docs/Game.md', caller.text('docs/Game.md').replace('expec-end:', 'edited-end:'));
    const plan = await caller.plan('update'); expect(plan.value).toBeUndefined(); expect(plan.problems.map(problem => problem.code)).toContain('output-conflict');
  });
  it('reports directory retargeting as a migration rather than silently moving documents', async () => {
    const caller = new MarkdownPlans(); caller.source('concept Game {}'); await caller.create();
    const output = caller.registry.open('markdown', { directory: 'new-docs' }, { root: caller.snapshot.root, readSnapshot: async () => caller.snapshot },
      { apply: async () => { throw new Error('No writes'); } }).value!;
    const plan = await output.plan({ operation: 'create', current: caller.current }, caller.snapshot);
    expect(plan.problems.map(problem => problem.code)).toContain('output-options-changed');
  });
  it('detects a blocked state destination before any document is planned', async () => {
    const caller = new MarkdownPlans(); caller.source('concept Game {}'); caller.edit('.expec', 'handwritten');
    const plan = await caller.plan(); expect(plan.value).toBeUndefined(); expect(plan.problems.map(problem => problem.code)).toContain('output-conflict');
  });
  it('refuses a hidden generated directory instead of pretending the output is absent', async () => {
    const caller = new MarkdownPlans(); caller.source('concept Game {}'); caller.snapshot = { ...caller.snapshot, excludeNames: ['.git', 'docs'] };
    const plan = await caller.plan(); expect(plan.value).toBeUndefined(); expect(plan.problems.map(problem => problem.code)).toContain('output-conflict');
  });
  it('does not automatically transliterate unsafe authored filenames', async () => {
    const caller = new MarkdownPlans(); caller.source('concept `Game/Store` {}');
    const plan = await caller.plan(); expect(plan.value).toBeUndefined(); expect(plan.problems.map(problem => problem.code)).toContain('unsupported-artifact-name');
  });
  it('does not adopt an equal-looking document without generation state', async () => {
    const caller = new MarkdownPlans(); caller.source('concept Game {}'); await caller.create(); caller.remove(caller.statePath());
    const plan = await caller.plan(); expect(plan.value).toBeUndefined(); expect(plan.problems.map(problem => problem.code)).toContain('output-conflict');
  });
});
