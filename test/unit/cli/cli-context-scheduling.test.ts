import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BuildContext } from '../../../src/cli/cli-context.js';
import { hash } from '../../../src/project/connection/project-files.js';
import type { ProjectSnapshot } from '../../../src/project/connection/project-connection.js';

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
async function buildEvidence(names: string[]) {
  const parent = await fs.realpath(tmpdir()), root = await fs.realpath(await fs.mkdtemp(join(parent, 'expec-input-scheduling-')));
  const path = (name: string) => join(root, name), manifest = path('expec.json');
  await fs.writeFile(manifest, '{}'); await fs.writeFile(path('project.txt'), 'original');
  for (const name of names) await fs.writeFile(path(name), 'one');
  const inputs = names.map(name => ({ uri: pathToFileURL(path(name)).href, version: hash(Buffer.from('one')) }));
  let captures = 0, active = 0, maximum = 0;
  const started: string[] = [], attempted = new Set<string>(), completed: string[] = [], held = new Map<string, ReturnType<typeof gate>>();
  const statCounts = new Map<string, number>(), finished = new Set<string>();
  const releases = new Map<string, string>(), pending: Promise<ProjectSnapshot>[] = [];
  const read = fs.readFile.bind(fs), stat = fs.lstat.bind(fs);
  const readHook = vi.spyOn(fs, 'readFile').mockImplementation(async (...args: Parameters<typeof fs.readFile>) => {
    const name = basename(String(args[0]));
    if (dirname(String(args[0])) !== root || !names.includes(name)) return read(...args);
    started.push(name); maximum = Math.max(maximum, ++active);
    try { await held.get(name)?.promise; return await read(...args); }
    finally { active--; completed.push(name); }
  });
  const statHook = vi.spyOn(fs, 'lstat').mockImplementation((async (...args: Parameters<typeof fs.lstat>) => {
    const name = basename(String(args[0]));
    if (dirname(String(args[0])) !== root || !names.includes(name)) return stat(...args);
    attempted.add(name);
    try { const value = await stat(...args); const count = (statCounts.get(name) ?? 0) + 1; statCounts.set(name, count); if (count === 2) finished.add(name); return value; }
    catch (error) { completed.push(name); finished.add(name); throw error; }
    finally { const release = releases.get(name); if (release) held.get(release)?.release(); }
  }) as typeof fs.lstat);
  const project = { root: { path: root, identity: 'scheduling-fixture' }, readSnapshot: async (): Promise<ProjectSnapshot> => {
    captures++;
    const bytes = await read(path('project.txt'));
    return { root: project.root, complete: true, problems: [], files: [{ path: 'project.txt', bytes, version: hash(bytes) }],
      nativeInputs: inputs, excluded: [], excludeNames: [] };
  } };
  const context = new BuildContext(project, { manifest, text: '{}', captures: [], problems: [], syntax: [], deferred: [] }, []);
  onTestFinished(async () => {
    for (const item of held.values()) item.release();
    await Promise.allSettled(pending); readHook.mockRestore(); statHook.mockRestore();
    if (dirname(await fs.realpath(root)) !== parent) throw Error('Unexpected scheduling fixture cleanup.');
    await fs.rm(root, { recursive: true, force: true });
  });
  return {
    holdInput(name: string) { const value = gate(); held.set(name, value); return value; },
    readSnapshot() { const reading = context.readSnapshot(); pending.push(reading); return reading; },
    async expectInputsStarted(expected: string[]) { await vi.waitFor(() => expect([...started].sort()).toEqual([...expected].sort())); },
    async expectInputsFinished(expected: string[]) { await vi.waitFor(() => expect([...finished].sort()).toEqual([...expected].sort())); },
    expectMaximumConcurrentReads(count: number) { expect(maximum).toBe(count); },
    expectInputNotStarted(name: string) { expect(attempted.has(name)).toBe(false); },
    expectFinalCaptureNotStarted() { expect(captures).toBe(1); },
    expectEveryInputObserved() { expect([...attempted].sort()).toEqual([...names].sort()); expect([...finished].sort()).toEqual([...names].sort()); },
    async changeBytes(name: string, text: string) { await fs.writeFile(path(name), text); },
    async remove(name: string) { await fs.unlink(path(name)); },
    releaseReadAfter(name: string, after: string) { held.set(name, gate()); releases.set(after, name); },
    expectFailureCompletedBefore(first: string, second: string) { expect(completed.indexOf(first)).toBeGreaterThanOrEqual(0); expect(completed.indexOf(first)).toBeLessThan(completed.indexOf(second)); },
    expectFailedInputs(result: ProjectSnapshot, failed: string[]) {
      expect(result.complete).toBe(false);
      expect(result.problems.map(problem => problem.code)).toEqual(failed.map(() => 'stale-build-input'));
      expect(result.problems.map(problem => inputs.find(input => problem.message.startsWith(input.uri + ': '))?.uri))
        .toEqual(failed.map(name => pathToFileURL(path(name)).href));
    },
    async changeSuppliedProject() { await fs.writeFile(path('project.txt'), 'changed'); },
  };
}

describe('bounded fresh build input observations', () => {
  it('bounds input reads without letting later work overtake the current group', async () => {
    const p = await buildEvidence(['a', 'b', 'c', 'd', 'e']);
    const held = ['a', 'b', 'c', 'd'].map(name => p.holdInput(name));
    const reading = p.readSnapshot();
    try {
      await p.expectInputsStarted(['a', 'b', 'c', 'd']);
      p.expectMaximumConcurrentReads(4);
      held.slice(1).forEach(input => input.release());
      await p.expectInputsFinished(['b', 'c', 'd']);
      p.expectInputNotStarted('e');
      p.expectFinalCaptureNotStarted();
    } finally { held.forEach(input => input.release()); await reading; }
    p.expectEveryInputObserved();
  });
  it('reports failures in input order despite reversed completion', async () => {
    const p = await buildEvidence(['a', 'b', 'c', 'd', 'e', 'f']);
    await p.changeBytes('b', 'changed'); await p.remove('c'); await p.changeBytes('f', 'changed');
    p.releaseReadAfter('b', 'c');
    const result = await p.readSnapshot();
    p.expectFailureCompletedBefore('c', 'b');
    p.expectFailedInputs(result, ['b', 'c', 'f']);
    p.expectEveryInputObserved();
  });
  it('finishes input checks before checking the final project state', async () => {
    const p = await buildEvidence(['a', 'b', 'c', 'd', 'e']), held = p.holdInput('e');
    const reading = p.readSnapshot();
    await p.expectInputsStarted(['a', 'b', 'c', 'd', 'e']);
    p.expectFinalCaptureNotStarted();
    await p.changeSuppliedProject(); held.release();
    const result = await reading;
    expect(result.complete).toBe(false);
    expect(result.problems).toContainEqual(expect.objectContaining({ code: 'stale-project', message: 'The project changed while collecting build evidence.' }));
    p.expectEveryInputObserved();
  });
});
