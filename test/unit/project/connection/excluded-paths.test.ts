import { describe, expect, it } from 'vitest';
import type { Check, ProjectSnapshot } from '../../../../src/index.js';
import { ExcludedPathsProject, readPathConfiguration, writePath } from '../../../driver/project/connection/excluded-paths.js';

function settingProblem(report: Check<unknown>, index?: number) {
  expect(report.value).toBeUndefined(); expect(report.deferred).toEqual([]);
  const path = ['manifest', 'paths.expec.json', 'project', 'excludePaths', ...(index === undefined ? [] : [index])];
  const finding = report.problems.find(item => item.code === 'invalid-setting' && item.at.kind === 'dependency'
    && JSON.stringify(item.at.path) === JSON.stringify(path));
  expect(finding, 'invalid-setting at ' + path.join('.')).toBeDefined(); return finding!;
}
const refused = (result: Awaited<ReturnType<ExcludedPathsProject['apply']>>, code: string) => {
  expect(result.status).toBe('stopped'); expect(result.problems).toContainEqual(expect.objectContaining({ code }));
};

describe('explicit root-relative project capture boundaries', () => {
  it('accepts paths in authored configuration', () => {
    const result = readPathConfiguration(['dist', 'generation/tooling']);
    expect(result.problems).toEqual([]);
    expect(result.value?.project).toEqual({ root: '.', excludePaths: ['dist', 'generation/tooling'] });
  });
  it('captures siblings and nested names while skipping only selected root-relative trees', async () => {
    const project = new ExcludedPathsProject();
    await project.files({ 'dist/sdk.bin': 'skip', 'nested/dist/keep.ts': 'keep',
      'generation/tooling/sdk.tgz': 'skip', 'generation/expec/book.expec': 'type Book { title: Text }',
      'src/tooling/keep.ts': 'keep', '.expec/future-plugin/state.json': 'coordination' });
    await project.usePolicy(['dist', 'generation/tooling']);
    const snapshot = await project.capture();
    expect(snapshot.complete).toBe(true); expect(snapshot.problems).toEqual([]);
    expect(snapshot.files.map(file => file.path)).toEqual([
      '.expec/future-plugin/state.json', 'generation/expec/book.expec', 'nested/dist/keep.ts', 'src/tooling/keep.ts',
    ]);
    expect(snapshot.excluded).toEqual(['dist', 'generation/tooling']);
    expect(snapshot).toHaveProperty('excludePaths', ['dist', 'generation/tooling']);
  });
  it('retains the legacy snapshot shape when paths are absent or empty', async () => {
    const project = new ExcludedPathsProject();
    await project.files({ 'dist/keep.bin': 'included', 'node_modules/library/index.js': 'legacy exclusion' });
    await project.usePolicy(); const before = await project.capture();
    expect(before).not.toHaveProperty('excludePaths');
    await project.usePolicy([]); const after = await project.capture();
    expect(after).not.toHaveProperty('excludePaths'); expect(after).toEqual(before);
    expect(after.files.map(file => file.path)).toEqual(['dist/keep.bin']); expect(after.excluded).toEqual(['node_modules']);
  });
  it('keeps explicit constructor names exact rather than replacing them with path policy', async () => {
    const project = new ExcludedPathsProject();
    await project.files({ 'Dist/keep.ts': 'legacy names are exact', 'node_modules/keep.ts': 'constructor override' });
    await project.usePolicy(['future'], ['dist']); const snapshot = await project.capture();
    expect(snapshot.files.map(file => file.path)).toEqual(['Dist/keep.ts', 'node_modules/keep.ts']);
    expect(snapshot.excludeNames).toEqual(['dist']); expect(snapshot.excluded).toEqual([]);
  });
  it('rejects a non-list identically for parsed and directly supplied configuration', async () => {
    const project = new ExcludedPathsProject();
    settingProblem(readPathConfiguration(42)); settingProblem(await project.connect(42));
  });
  it('rejects parent traversal identically for parsed and directly supplied configuration', async () => {
    const project = new ExcludedPathsProject();
    settingProblem(readPathConfiguration(['../outside']), 0); settingProblem(await project.connect(['../outside']), 0);
  });
  it('locates both occurrences of a duplicate path', async () => {
    const project = new ExcludedPathsProject();
    const parsed = settingProblem(readPathConfiguration(['dist', 'dist']), 1);
    const supplied = settingProblem(await project.connect(['dist', 'dist']), 1);
    const earlier = { kind: 'dependency', path: ['manifest', 'paths.expec.json', 'project', 'excludePaths', 0] };
    expect(parsed.related).toContainEqual(earlier); expect(supplied.related).toContainEqual(earlier);
  });
  it('rejects the root coordination subtree including future control names', async () => {
    const project = new ExcludedPathsProject();
    settingProblem(readPathConfiguration(['.expec']), 0);
    settingProblem(await project.connect(['.expec/future-plugin/new-state.json']), 0);
  });
  it('owns caller policy before the first filesystem await', async () => {
    const project = new ExcludedPathsProject(), paths = ['dist'];
    await project.files({ 'dist/skip': 'skip', 'src/book.ts': 'keep' });
    const connecting = project.connect(paths); paths[0] = 'src'; const result = await connecting;
    expect(result.problems).toEqual([]); expect(result.value?.status).toBe('connected');
    const context = result.value?.status === 'connected' ? result.value.context : undefined;
    const snapshot = await context!.readSnapshot();
    expect(snapshot.files.map(file => file.path)).toEqual(['src/book.ts']); expect(snapshot).toHaveProperty('excludePaths', ['dist']);
  });
  it('refuses an absent protected destination before creating directories or earlier effects', async () => {
    const project = new ExcludedPathsProject();
    await project.files({ 'book.ts': 'old' }); await project.usePolicy(['generation/tooling']);
    const before = await project.capture(); expect(before.excluded).toEqual([]);
    refused(await project.apply(before, [writePath('book.ts'), writePath('generation/tooling/new.ts')]), 'invalid-change');
    expect(await project.text('book.ts')).toBe('old'); expect(await project.exists('generation')).toBe(false);
    expect(await project.exists('.expec')).toBe(false);
  });
  it('refuses removing an included ancestor file before an earlier valid write', async () => {
    const project = new ExcludedPathsProject();
    await project.files({ 'book.ts': 'old', 'generation': 'parent file' }); await project.usePolicy(['generation/tooling']);
    const before = await project.capture();
    const result = await project.apply(before, [writePath('book.ts'), { kind: 'remove', path: 'generation' }]);
    refused(result, 'invalid-change'); expect(result.outcomes.map(outcome => outcome.state)).toEqual(['not-applied', 'not-applied']);
    expect(await project.text('book.ts')).toBe('old'); expect(await project.text('generation')).toBe('parent file');
    expect(await project.exists('.expec')).toBe(false);
  });
  it('refuses moving an included ancestor file away before an earlier valid write', async () => {
    const project = new ExcludedPathsProject();
    await project.files({ 'book.ts': 'old', 'generation': 'parent file' }); await project.usePolicy(['generation/tooling']);
    const before = await project.capture();
    const result = await project.apply(before, [writePath('book.ts'), { kind: 'move', from: 'generation', to: 'elsewhere' }]);
    refused(result, 'invalid-change'); expect(result.outcomes.map(outcome => outcome.state)).toEqual(['not-applied', 'not-applied']);
    expect(await project.text('book.ts')).toBe('old'); expect(await project.text('generation')).toBe('parent file');
    expect(await project.exists('elsewhere')).toBe(false); expect(await project.exists('.expec')).toBe(false);
  });
  it('refuses moving a file onto an absent protected ancestor before an earlier valid write', async () => {
    const project = new ExcludedPathsProject();
    await project.files({ 'book.ts': 'old', 'incoming.ts': 'incoming' }); await project.usePolicy(['generation/tooling']);
    const before = await project.capture();
    const result = await project.apply(before, [writePath('book.ts'), { kind: 'move', from: 'incoming.ts', to: 'generation' }]);
    refused(result, 'invalid-change'); expect(result.outcomes.map(outcome => outcome.state)).toEqual(['not-applied', 'not-applied']);
    expect(await project.text('book.ts')).toBe('old'); expect(await project.text('incoming.ts')).toBe('incoming');
    expect(await project.exists('generation')).toBe(false); expect(await project.exists('.expec')).toBe(false);
  });
  it('refuses writing an ancestor endpoint while preserving its included file', async () => {
    const project = new ExcludedPathsProject();
    await project.files({ 'book.ts': 'old', 'generation': 'parent file' }); await project.usePolicy(['generation/tooling']);
    const result = await project.apply(await project.capture(), [writePath('book.ts'), writePath('generation')]);
    refused(result, 'invalid-change'); expect(result.outcomes.map(outcome => outcome.state)).toEqual(['not-applied', 'not-applied']);
    expect(await project.text('book.ts')).toBe('old'); expect(await project.text('generation')).toBe('parent file');
    expect(await project.exists('.expec')).toBe(false);
  });
  it('refuses an otherwise unchanged basis after its path policy changes', async () => {
    const project = new ExcludedPathsProject();
    await project.files({ 'book.ts': 'old' }); await project.usePolicy(); const before = await project.capture();
    await project.usePolicy(['dist']); refused(await project.apply(before, [writePath('book.ts')]), 'stale-project');
    expect(await project.text('book.ts')).toBe('old');
  });
  it('rejects an explicitly empty supplied snapshot policy', async () => {
    const project = new ExcludedPathsProject();
    await project.files({ 'book.ts': 'old' }); await project.usePolicy();
    const snapshot = { ...await project.capture(), excludePaths: [] } as ProjectSnapshot;
    refused(await project.apply(snapshot, [writePath('book.ts')]), 'invalid-change'); expect(await project.text('book.ts')).toBe('old');
  });
  it('rejects editable bytes contradicting the supplied path policy', async () => {
    const project = new ExcludedPathsProject();
    await project.files({ 'book.ts': 'old' }); await project.usePolicy();
    const snapshot = { ...await project.capture(), excludePaths: ['book.ts'] } as ProjectSnapshot;
    refused(await project.apply(snapshot, [writePath('other.ts')]), 'invalid-change');
    expect(await project.exists('other.ts')).toBe(false); expect(await project.text('book.ts')).toBe('old');
  });
  it('uses native case rules for prefixes duplicate paths and coordination aliases', async () => {
    const project = new ExcludedPathsProject();
    await project.files({ 'Dist/skip.ts': 'skip', 'src/book.ts': 'old' }); await project.usePolicy(['dist']);
    const snapshot = await project.capture();
    if (process.platform === 'win32') {
      expect(snapshot.files.map(file => file.path)).toEqual(['src/book.ts']);
      settingProblem(readPathConfiguration(['dist', 'DIST']), 1);
      settingProblem(await project.connect(['.ExPeC/future-state.json']), 0);
      refused(await project.apply(snapshot, [writePath('DIST/new.ts')]), 'invalid-change');
    } else {
      expect(snapshot.files.map(file => file.path)).toEqual(['Dist/skip.ts', 'src/book.ts']);
      expect(readPathConfiguration(['dist', 'DIST']).problems).toEqual([]);
    }
    expect(await project.text('src/book.ts')).toBe('old');
  });
});
