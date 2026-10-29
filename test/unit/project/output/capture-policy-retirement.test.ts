import { describe, expect, it } from 'vitest';
import { MarkdownPlans } from '../../../driver/project/output/markdown-plans.js';

describe('included output files above a future excluded boundary', () => {
  it('reports a located refusal when retiring an owned Markdown ancestor file', async () => {
    const reader = new MarkdownPlans();
    reader.source('type Book { title: Text }'); await reader.create();
    const page = reader.text('docs/pages/fixture.md'), ownership = reader.text(reader.statePath());
    reader.snapshot = { ...reader.snapshot, excludePaths: ['docs/pages/fixture.md/future'] };

    const result = await reader.output.plan({ operation: 'delete', id: reader.id('Book') }, reader.snapshot);

    expect(result.value).toBeUndefined();
    expect(result.deferred).toEqual([]);
    expect(result.problems).toContainEqual(expect.objectContaining({
      code: 'output-conflict', at: { kind: 'dependency', path: ['project', 'docs/pages/fixture.md'] },
    }));
    expect(reader.text('docs/pages/fixture.md')).toBe(page);
    expect(reader.text(reader.statePath())).toBe(ownership);
  });
});
