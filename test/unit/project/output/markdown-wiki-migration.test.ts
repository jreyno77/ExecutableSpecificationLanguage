import { describe, expect, it } from 'vitest';
import { MarkdownMigration, projectFiles } from '../../../driver/project/output/markdown-migration.js';
import { MarkdownPlans } from '../../../driver/project/output/markdown-plans.js';

const locatedAt = (path: string) => ({ kind: 'dependency', path: ['project', path] });

describe('upgrading existing Markdown specifications', () => {
  it('consolidates actual released declaration pages while retaining every subject identity', async () => {
    const caller = await MarkdownMigration.released('two-declarations-clean');
    expect(caller.documents()).toEqual(['docs/Book.md', 'docs/Library.md']);
    const originalIds = caller.legacy.baseline.elements.map(record => record.id).sort();

    const upgrade = await caller.plan('update');

    expect(upgrade.problems).toEqual([]); expect(upgrade.value).toBeDefined();
    caller.apply(upgrade.value!);
    expect(caller.documents()).toEqual(['docs/Home.md', 'docs/pages/fixture.md']);
    expect(upgrade.value!.artifacts.map(artifact => artifact.specId).sort()).toEqual(originalIds);
    for (const id of originalIds) {
      const read = await caller.output.read(id);
      expect(read.problems).toEqual([]);
      expect(read.coverage.complete).toBe(true);
      expect(read.artifacts.map(artifact => artifact.file.path)).toEqual(['docs/pages/fixture.md']);
    }
    expect((await caller.plan('update')).value?.changes).toEqual([]);
  });

  it('carries the exact handwritten prefix and mixed-line-ending notes through a one-to-one upgrade', async () => {
    const caller = await MarkdownMigration.released('one-declaration');
    const prefix = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('📚 Library preface\r\n\r\n')]);
    const notes = Buffer.from('## Your notes\r\n\r\nKeep 📚 backups.\r\n');
    caller.legacyNotes('Library', notes.toString('utf8'));
    caller.edit('docs/Library.md', Buffer.concat([prefix, caller.bytes('docs/Library.md')]));

    const upgrade = await caller.plan('update');

    expect(upgrade.problems).toEqual([]); expect(upgrade.value).toBeDefined();
    caller.apply(upgrade.value!);
    expect(caller.documents()).toEqual(['docs/Home.md', 'docs/pages/fixture.md']);
    const actual = caller.bytes('docs/pages/fixture.md');
    expect(Buffer.from(actual.slice(0, prefix.length))).toEqual(prefix);
    expect(Buffer.from(actual.slice(actual.length - notes.length))).toEqual(notes);
  });

  it('refuses ambiguous handwritten-note consolidation before planning any effects', async () => {
    const caller = await MarkdownMigration.released('two-declarations-clean');
    caller.legacyNotes('Book', '## Your notes\n\nBook-specific advice.\n');
    const originalFiles = projectFiles(caller.snapshot);

    const upgrade = await caller.plan('update');

    expect(upgrade.value).toBeUndefined();
    expect(upgrade.problems).toContainEqual(expect.objectContaining({ code: 'handwritten-document-content', at: locatedAt('docs/Book.md') }));
    expect(projectFiles(caller.snapshot)).toEqual(originalFiles);
  });

  it('refuses an edited released generated region instead of treating migration as adoption', async () => {
    const caller = await MarkdownMigration.released('two-declarations-clean');
    caller.edit('docs/Book.md', caller.text('docs/Book.md').replace('title: Text', 'title: Number'));
    const originalFiles = projectFiles(caller.snapshot);

    const upgrade = await caller.plan('update');

    expect(upgrade.value).toBeUndefined();
    expect(upgrade.problems).toContainEqual(expect.objectContaining({ code: 'output-conflict', at: locatedAt('docs/Book.md') }));
    expect(projectFiles(caller.snapshot)).toEqual(originalFiles);
  });

  it('protects a handwritten semantic backlink while the released page is moved', async () => {
    const caller = await MarkdownMigration.released('one-declaration');
    caller.edit('reading.md', caller.legacyLink('Library'));
    const originalFiles = projectFiles(caller.snapshot);

    const upgrade = await caller.plan('update');

    expect(upgrade.value).toBeUndefined();
    expect(upgrade.problems).toContainEqual(expect.objectContaining({ code: 'output-conflict', at: locatedAt('reading.md') }));
    expect(projectFiles(caller.snapshot)).toEqual(originalFiles);
  });

  it('does not adopt released-looking pages after their ownership record is removed', async () => {
    const caller = await MarkdownMigration.released('two-declarations-clean');
    caller.remove(caller.statePath());
    const originalFiles = projectFiles(caller.snapshot);

    const upgrade = await caller.plan('update');

    expect(upgrade.value).toBeUndefined();
    expect(upgrade.problems.map(problem => problem.code)).toContain('output-conflict');
    expect(projectFiles(caller.snapshot)).toEqual(originalFiles);
  });

  it('refuses a handwritten Home destination before upgrading any released page', async () => {
    const caller = await MarkdownMigration.released('two-declarations-clean');
    caller.edit('docs/Home.md', '# My documentation\n');
    const originalFiles = projectFiles(caller.snapshot);

    const upgrade = await caller.plan('update');

    expect(upgrade.value).toBeUndefined();
    expect(upgrade.problems).toContainEqual(expect.objectContaining({ code: 'output-conflict', at: locatedAt('docs/Home.md') }));
    expect(projectFiles(caller.snapshot)).toEqual(originalFiles);
  });
});

describe('source-page link ownership after generation', () => {
  it('retains a handwritten whole-page backlink when a source page is deliberately deleted', async () => {
    const caller = new MarkdownPlans(); caller.source('concept Library {}'); await caller.create();
    expect(caller.snapshot.files.map(file => file.path)).toContain('docs/pages/fixture.md');
    caller.edit('reading.md', '[Library](docs/pages/fixture.md)\n');
    const originalFiles = projectFiles(caller.snapshot);

    const deletion = await caller.output.plan({ operation: 'delete', id: caller.id('Library') }, caller.snapshot);

    expect(deletion.value).toBeUndefined();
    expect(deletion.problems).toContainEqual(expect.objectContaining({ code: 'output-conflict', at: locatedAt('reading.md') }));
    expect(projectFiles(caller.snapshot)).toEqual(originalFiles);
  });
});

describe('deleting documents across the ownership upgrade', () => {
  it('requires a guarded update before deleting a released v1 document', async () => {
    const caller = await MarkdownMigration.released('one-declaration');
    const originalFiles = projectFiles(caller.snapshot);

    const deletion = await caller.output.plan({ operation: 'delete', id: caller.id('Library') }, caller.snapshot);

    expect(deletion.value).toBeUndefined();
    expect(deletion.problems.map(problem => problem.code)).toContain('output-options-changed');
    expect(deletion.problems.some(problem => /update/i.test(problem.message))).toBe(true);
    expect(projectFiles(caller.snapshot)).toEqual(originalFiles);
  });

  it('deletes the single clean source page after a guarded upgrade while retaining an empty Home', async () => {
    const caller = await MarkdownMigration.released('one-declaration');
    const upgrade = await caller.plan('update');
    expect(upgrade.problems).toEqual([]); expect(upgrade.value).toBeDefined();
    caller.apply(upgrade.value!);
    expect(caller.documents()).toEqual(['docs/Home.md', 'docs/pages/fixture.md']);

    const deletion = await caller.output.plan({ operation: 'delete', id: caller.id('Library') }, caller.snapshot);

    expect(deletion.problems).toEqual([]); expect(deletion.value).toBeDefined();
    caller.apply(deletion.value!);
    expect(caller.documents()).toEqual(['docs/Home.md']);
    expect(caller.text('docs/Home.md')).not.toContain('pages/fixture.md');
    expect(deletion.value!.artifacts).toEqual([]);
  });
});
