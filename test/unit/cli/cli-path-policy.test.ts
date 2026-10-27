import { describe, expect, it } from 'vitest';
import { completedPolicyConfirmation, configuredPolicyBuild, policyJournal } from '../../driver/cli/path-policy.js';
import { JournalDriver } from '../../driver/cli/journal-project.js';

describe('CLI retained capture boundaries', () => {
  it('records declared paths in both the pending graph and its checked facts', async () => {
    const generation = await policyJournal(['dist', 'notes']);
    await generation.interrupt();
    const pending = await generation.project.pending();
    expect(pending.graph.excludePaths).toEqual(['dist', 'notes']);
    expect(JSON.parse(pending.facts).excludePaths).toEqual(['dist', 'notes']);
    expect(await generation.project.read('First.txt')).toEqual(Buffer.from('First'));
  });

  it('refuses pending recovery when only the supplied path policy changes', async () => {
    const generation = await policyJournal(['dist']);
    await generation.interrupt();
    const before = await generation.project.files(), pending = await generation.pendingBytes();
    generation.configurePaths(['dist', 'notes']);

    const result = await generation.generate();

    expect(result.problems.map(problem => problem.code)).toContain('recovery-conflict');
    generation.expectNoPlanning();
    expect(await generation.project.files()).toEqual(before);
    expect(await generation.pendingBytes()).toEqual(pending);
  });

  it('recovers an unchanged nonempty policy and preserves handwritten data', async () => {
    const generation = await policyJournal(['dist']);
    await generation.interrupt();
    await generation.project.recover();
    expect(generation.project.report.exitCode).toBe(0);
    expect(await generation.project.read('Second.txt')).toEqual(Buffer.from('Second'));
    expect(await generation.project.read('notes.txt')).toEqual(Buffer.from('Keep this handwritten note.'));
    expect((await generation.project.context.readSnapshot()).excludePaths).toEqual(['dist']);
    await expect(generation.pendingBytes()).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('recovers a genuine legacy format1 record without inventing path policy', async () => {
    const project = await JournalDriver.fromLegacy();
    const pending = await project.pending();
    expect(pending.format).toBe(1);
    expect(Object.hasOwn(pending.graph, 'excludePaths')).toBe(false);
    expect(Object.hasOwn(JSON.parse(pending.facts), 'excludePaths')).toBe(false);
    await project.recover();
    expect(project.report.exitCode).toBe(0);
    expect(await project.read('Second.txt')).toEqual(Buffer.from('Second'));
    expect(Object.hasOwn(await project.context.readSnapshot(), 'excludePaths')).toBe(false);
  });

  it('recovers a legacy format2 record without inventing empty path fields', async () => {
    const generation = await policyJournal();
    await generation.interrupt();
    const pending = await generation.project.pending();
    expect(pending.format).toBe(2);
    expect(Object.hasOwn(pending.graph, 'excludePaths')).toBe(false);
    expect(Object.hasOwn(JSON.parse(pending.facts), 'excludePaths')).toBe(false);
    await generation.project.recover();
    expect(generation.project.report.exitCode).toBe(0);
    expect(await generation.project.read('Second.txt')).toEqual(Buffer.from('Second'));
    expect(Object.hasOwn(await generation.project.context.readSnapshot(), 'excludePaths')).toBe(false);
  });

  it('retains a declared policy in the actual output transition', async () => {
    const generation = await policyJournal(['dist']);
    const transition = await generation.transition();
    expect(JSON.parse(transition.retained.record.exclusions).excludePaths).toEqual(['dist']);
    expect((await transition.read()).problems).toEqual([]);
  });

  it('refuses a changed policy while output stages retain their transition', async () => {
    const generation = await policyJournal(['dist']);
    const transition = await generation.transition();
    generation.configurePaths(['dist', 'notes']);
    const checked = await transition.read();
    expect(checked.problems.map(problem => problem.code)).toContain('recovery-conflict');
    expect(checked.value).toBeUndefined();
  });

  it('refuses native composition that observed another path policy', async () => {
    const generation = await policyJournal();
    const captured = await generation.captureAcrossNativePolicyChange();
    expect(captured.complete).toBe(false);
    expect(captured.problems.map(problem => problem.code)).toContain('stale-project');
  });

  it('completes an actual confirmation-only prefix under its unchanged policy', async () => {
    const generation = await completedPolicyConfirmation(['dist']);
    await generation.project.recover();
    expect(generation.project.report.exitCode).toBe(0);
    expect(generation.project.report.status).toBe('recovered');
    await expect(generation.project.pending()).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses the completed-confirmation shortcut after its policy changes', async () => {
    const generation = await completedPolicyConfirmation(['dist']);
    const before = await generation.project.files();
    generation.configurePaths(['notes']);
    await generation.project.recover();
    expect(generation.project.report.problems.map(problem => problem.code)).toContain('recovery-conflict');
    expect(await generation.project.files()).toEqual(before);
  });

  it('refuses an excluded selected tsconfig before output planning or effects', async () => {
    const generation = await configuredPolicyBuild({ source: 'type Book { title: Text }', excludePaths: ['tsconfig.json'], configFile: 'tsconfig.json' });
    const before = await generation.project.files(), configuration = await generation.project.read('tsconfig.json');

    const result = await generation.generate();

    expect(result.exitCode).toBe(1);
    expect(result.problems.some(problem => problem.code === 'native-input-unavailable' && problem.at.kind === 'dependency'
      && problem.at.path.includes('tsconfig.json'))).toBe(true);
    generation.expectNoPlanning();
    expect(await generation.project.files()).toEqual(before);
    expect(await generation.project.read('tsconfig.json')).toEqual(configuration);
  });

  it('keeps explicit author source currentness even outside editable capture', async () => {
    const generation = await configuredPolicyBuild({ source: 'type Book { title: Text }', excludePaths: ['generation/spec'], projectSource: 'generation/spec/main.expec' });
    const before = await generation.project.files();
    expect(Object.keys(before)).not.toContain('generation/spec/main.expec');
    await generation.changeSource('type Book { title: Number }');

    const result = await generation.generate();

    expect(result.exitCode).toBe(1);
    expect(result.problems.map(problem => problem.code)).toContain('stale-build-input');
    generation.expectNoPlanning();
    expect(await generation.project.files()).toEqual(before);
  });
});
