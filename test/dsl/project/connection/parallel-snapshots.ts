import { createHash } from 'node:crypto';
import { expect, onTestFinished } from 'vitest';
import type { ProjectSnapshot } from '../../../../src/index.js';
import { SnapshotDriver } from '../../../driver/project/connection/parallel-snapshots.js';

export class SnapshotExamples {
  private readonly driver = new SnapshotDriver();
  private constructor() { onTestFinished(() => this.driver.dispose()); }
  static async withFiles(files: Record<string, string>): Promise<SnapshotExamples> {
    const project = new SnapshotExamples();
    await project.driver.setup(files);
    return project;
  }
  read(): Promise<void> { return this.driver.read(); }
  readWithFirstFilePaused(): Promise<void> { return this.driver.read('first-body'); }
  readWithBodiesPaused(): Promise<void> { return this.driver.read('all-bodies'); }
  readSimultaneously(): Promise<void> { return this.driver.readSimultaneously(); }
  write(path: string, text: string): Promise<void> { return this.driver.write(path, text); }
  replaceDirectoryAfterItsChildrenAreRead(path: string, files: Record<string, string>): void {
    this.driver.arrangeDirectory(path, files);
  }
  removeDirectoryBeforeFinalObservation(path: string): void { this.driver.arrangeDirectory(path); }
  expectFiles(files: Record<string, string>): void {
    expect(this.driver.current.files.map(file => file.path)).toEqual(Object.keys(files).sort());
    for (const [path, text] of Object.entries(files)) this.expectFile(path, text);
  }
  expectFile(path: string, text: string): void { this.expectCapturedFile(this.driver.current, path, text); }
  expectNoCapturedFile(path: string): void { expect(this.driver.current.files.filter(file => file.path === path)).toEqual([]); }
  expectComplete(): void {
    expect(this.driver.current.complete).toBe(true);
    expect(this.driver.current.problems).toEqual([]);
    expect(this.driver.current.excluded).toEqual([]);
    expect(this.driver.current.excludeNames).toEqual(['.git', 'node_modules']);
  }
  expectIncompleteAt(path: string, code: string): void {
    const change = this.driver.change;
    expect(change?.ran, 'The real post-close directory-change phase must occur.').toBe(true);
    expect(change?.before).toMatch(/^\d+:\d+$/);
    if (change?.replacement) {
      expect(change.after).toMatch(/^\d+:\d+$/);
      expect(change.after).not.toBe(change.before);
      for (const [name, text] of Object.entries(change.replacement)) {
        expect([...(change.replaced.get(path + '/' + name) ?? [])]).toEqual([...Buffer.from(text)]);
      }
    } else expect(change?.missing, 'The final original lstat must actually reject ENOENT.').toBe(true);
    for (const [name, text] of Object.entries(this.driver.initial).filter(([name]) => name.startsWith(path + '/'))) {
      expect([...(change?.retired.get(name) ?? [])]).toEqual([...Buffer.from(text)]);
    }
    expect(this.driver.current.complete).toBe(false);
    expect(this.driver.current.problems).toContainEqual(expect.objectContaining({
      code, at: { kind: 'dependency', path: ['project', this.driver.current.root.path, ...path.split('/')] },
    }));
  }
  expectAllOpenedHandlesClosed(): void {
    for (const observation of this.driver.observations) {
      expect(observation.handles.length).toBeGreaterThan(0);
      expect(observation.atReturn, 'Public return must precede no outstanding owned handle operation.').toEqual({
        pending: 0, open: 0, closed: observation.handles.length,
      });
      expect(observation.handles.every(handle => handle.closed)).toBe(true);
      expect(observation.bodies.size).toBe(observation.handles.length);
      for (const [path, text] of Object.entries(this.driver.initial)) {
        expect(observation.bodies.get(path)).toEqual({
          bytes: Uint8Array.from(Buffer.from(text)), version: createHash('sha256').update(text).digest('hex'),
        });
      }
    }
  }
  expectOtherFileReadWhilePaused(): void {
    const observation = this.driver.observations[0]!;
    expect(observation.mode).toBe('first-body');
    expect(observation.chosen).toBeDefined();
    expect(observation.progressed, 'Another real body must return while the selected real body remains held.').toBe(true);
    expect(observation.peak).toBeGreaterThan(1);
  }
  expectAtMostActiveFileHandles(maximum: number): void {
    const observation = this.driver.observations[0]!;
    expect(observation.mode).toBe('all-bodies');
    expect(observation.peak).toBeGreaterThan(0);
    expect(observation.peak, 'Maximum actual simultaneously owned open handles.').toBeLessThanOrEqual(maximum);
  }
  expectIndependentSnapshotsWithFile(path: string, text: string): void {
    const [first, second] = this.driver.earlier;
    expect(first).toBeDefined(); expect(second).toBeDefined();
    expect(first).not.toBe(second);
    for (const key of ['root', 'files', 'excludeNames', 'excluded', 'problems'] as const) expect(first![key]).not.toBe(second![key]);
    this.expectCapturedFile(first!, path, text); this.expectCapturedFile(second!, path, text);
    const left = this.file(first!, path), right = this.file(second!, path), saved = Uint8Array.from(left.bytes);
    expect(left).not.toBe(right); expect(left.bytes).not.toBe(right.bytes);
    try { left.bytes.fill(0); this.expectCapturedFile(second!, path, text); }
    finally { left.bytes.set(saved); }
    this.expectAllOpenedHandlesClosed();
  }
  expectEarlierSnapshotsWithFile(path: string, text: string): void {
    expect(this.driver.earlier).toHaveLength(2);
    for (const earlier of this.driver.earlier) {
      expect(earlier).not.toBe(this.driver.current);
      this.expectCapturedFile(earlier, path, text);
    }
  }
  private expectCapturedFile(snapshot: ProjectSnapshot, path: string, text: string): void {
    const file = this.file(snapshot, path);
    expect([...file.bytes]).toEqual([...Buffer.from(text)]);
    expect(file.version).toBe(createHash('sha256').update(text).digest('hex'));
  }
  private file(snapshot: ProjectSnapshot, path: string) {
    const files = snapshot.files.filter(file => file.path === path);
    expect(files, 'Expected one actually captured file ' + path).toHaveLength(1);
    return files[0]!;
  }
}

