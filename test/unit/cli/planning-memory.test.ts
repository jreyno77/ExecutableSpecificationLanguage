import { describe, expect, it } from 'vitest';
import { PlanningMemory } from '../../driver/cli/planning-memory.js';

describe('private CLI planning memory', () => {
  it('keeps one explicit stage basis without retaining it in every output intent', async () => {
    const generation = await PlanningMemory.create('type Book { title: Text }');

    await generation.generate();

    expect(generation.result).toMatchObject({ status: 'built', exitCode: 0, problems: [] });
    expect(await generation.typeField('Book', 'title')).toBe('string');
    expect(await generation.diagramLabels()).toContain('Book');
    expect(generation.stageBasisFindings()).toEqual([{ complete: true, problems: [] }]);

    generation.changePublicFile('typescript', 'src/existing.ts', 'export { };');
    expect(generation.publicFile('typescript', 'src/existing.ts')).toBe('export { };');
    expect(generation.publicFile('uml', 'src/existing.ts')).toBe('export {};\n');
    expect(generation.stageFile('src/existing.ts')).toBe('export {};\n');

    expect(generation.privateBasisProperties()).toEqual([false, false]);
  }, 30_000);
});
