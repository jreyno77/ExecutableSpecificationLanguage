import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { expect, onTestFinished } from 'vitest';
import type { WriteResult } from '../../../../src/index.js';
import { WritingDriver } from '../../../driver/project/connection/project-writing.js';

export class ProjectWrites {
  static prepare(): Promise<void> { return WritingDriver.prepare(); }
  private constructor(private readonly driver: WritingDriver) { onTestFinished(() => driver.dispose()); }
  static async create(files: Record<string, string>): Promise<ProjectWrites> {
    const driver = new WritingDriver(), examples = new ProjectWrites(driver);
    await driver.initialize(files); return examples;
  }
  observe(): Promise<void> { return this.driver.observe(); }
  edit(path: string, text: string): Promise<void> { return this.driver.edit(path, text); }
  write(path: string, text: string): void { this.writeBytes(path, new TextEncoder().encode(text)); }
  writeBytes(path: string, bytes: Uint8Array): void { this.driver.changes.push({ kind: 'write', path, bytes }); }
  remove(path: string): void { this.driver.changes.push({ kind: 'remove', path }); }
  move(from: string, to: string): void { this.driver.changes.push({ kind: 'move', from, to }); }
  moveWithBytes(from: string, to: string, text: string): void {
    this.driver.changes.push({ kind: 'move', from, to, bytes: new TextEncoder().encode(text) });
  }
  apply(): Promise<void> { return this.driver.apply(); }
  async denyWriteAfterFirstChange(path: string): Promise<void> { this.driver.denyWriteAfterFirst(path); }
  cancelAfterFirstChange(): void { this.driver.cancelAfterFirst(); }
  failMoveSourceRemoval(path: string): void { this.driver.failRemoval(path); }
  async denyReadAfterWrite(path: string): Promise<void> { this.driver.denyReadAfterWrite(path); }
  failContextAfterFirstChange(error: Error): void { this.driver.failContext(error); }
  editBeforeFinalVerification(path: string, text: string): void { this.driver.editBeforeFinal(path, text); }
  private rememberedState: WriteResult | undefined;
  rememberReceipt(): void {
    this.driver.remembered = this.driver.result;
    this.rememberedState = structuredClone(this.driver.result);
  }
  planRestoreFromReceipt(path: string): void {
    const previous = this.driver.remembered.outcomes.flatMap(outcome => outcome.before).find(file => file.path === path);
    if (previous?.state !== 'file') throw new Error('No recorded recovery bytes');
    this.writeBytes(path, previous.bytes);
  }
  expectRememberedPreviousBytes(path: string, text: string): void {
    const previous = this.driver.remembered.outcomes.flatMap(outcome => outcome.before).find(file => file.path === path);
    expect(previous?.state).toBe('file');
    if (previous?.state === 'file') expect(Buffer.from(previous.bytes).toString()).toBe(text);
  }
  expectRememberedReceiptUnchanged(): void {
    expect(this.driver.remembered).toEqual(this.rememberedState);
  }
  expectObservedBytes(path: string, text: string): void {
    const after = this.driver.result.outcomes.flatMap(item => item.after).find(item => item.path === path);
    expect(after?.state).toBe('file');
    if (after?.state === 'file') expect(Buffer.from(after.bytes).toString()).toBe(text);
  }
  expectUnknownAfter(path: string): void { expect(this.outcome(path).after).toContainEqual({ path, state: 'unknown' }); }
  expectProblemMessage(message: string): void { expect(this.driver.result.problems.some(problem => problem.message.includes(message))).toBe(true); }
  observeForTwoWriters(): Promise<void> { return this.observe(); }
  firstWriterWrites(path: string, text: string): void { this.write(path, text); }
  secondWriterWrites(path: string, text: string): void { this.driver.secondChanges.push({ kind: 'write', path, bytes: new TextEncoder().encode(text) }); }
  applyFirstWhileSecondAttempts(): Promise<void> { return this.driver.competingWriters(); }
  retrySecondUnchangedPlan(): Promise<void> { return this.driver.retrySecond(); }
  expectSecondStopped(code: string): void { expect(this.driver.second.status).toBe('stopped'); expect(this.driver.second.problems).toContainEqual(expect.objectContaining({ code })); }
  expectFirstCompleted(): void { expect(this.driver.first.status).toBe('applied'); expect(this.driver.first.problems).toEqual([]); }
  placeWriterMarker(text: string): Promise<void> { return this.edit('.expec/write.lock', text); }
  addInternalLink(path: string, target: string): Promise<void> { return this.driver.link(path, target); }
  replaceDirectoryWithOutsideLink(path: string): Promise<void> { return this.driver.replaceDirectoryWithOutsideLink(path); }
  replaceRoot(files: Record<string, string>): Promise<void> { return this.driver.replaceRoot(files); }
  async rememberFileMetadata(path: string, _fields: string[]): Promise<void> { this.driver.metadata.set(path, await this.driver.fileMetadata(path)); }
  async expectRememberedFileMetadata(path: string, _fields: string[]): Promise<void> {
    expect(await this.driver.fileMetadata(path)).toEqual(this.driver.metadata.get(path));
  }
  expectCompleted(): void { expect(this.driver.result.status, JSON.stringify(this.driver.result.problems)).toBe('applied'); expect(this.driver.result.problems).toEqual([]); }
  expectUnchanged(): void { expect(this.driver.result.status, JSON.stringify(this.driver.result.problems)).toBe('unchanged'); expect(this.driver.result.problems).toEqual([]); }
  expectStopped(code?: string): void {
    expect(this.driver.result.status).toBe('stopped'); expect(this.driver.result.problems.length).toBeGreaterThan(0);
    if (code) expect(this.driver.result.problems).toContainEqual(expect.objectContaining({ code }));
  }
  expectNoAppliedChanges(): void { expect(this.driver.result.outcomes.filter(item => item.state === 'applied' || item.state === 'uncertain')).toEqual([]); }
  expectOutcome(path: string, state: WriteResult['outcomes'][number]['state']): void { expect(this.outcome(path).state).toBe(state); }
  expectMoveOutcome(from: string, to: string, state: WriteResult['outcomes'][number]['state']): void {
    const outcome = this.outcome(from);
    expect(outcome.change).toMatchObject({ kind: 'move', from, to }); expect(outcome.state).toBe(state);
  }
  expectCreatedDirectories(paths: string[]): void { expect(this.driver.result.createdDirectories).toEqual(paths); }
  expectPreviousBytes(path: string, text: string): void {
    const before = this.outcome(path).before.find(item => item.path === path);
    expect(before?.state).toBe('file');
    if (before?.state === 'file') expect(Buffer.from(before.bytes).toString('utf8')).toBe(text);
  }
  async expectFile(path: string, text: string): Promise<void> { expect(await fs.readFile(this.driver.path(path), 'utf8')).toBe(text); }
  async expectAbsent(path: string): Promise<void> { await expect(fs.lstat(this.driver.path(path))).rejects.toMatchObject({ code: 'ENOENT' }); }
  async expectDirectory(path: string): Promise<void> { expect((await fs.lstat(this.driver.path(path))).isDirectory()).toBe(true); }
  async expectOutsideAbsent(path: string): Promise<void> {
    await expect(fs.lstat(join(this.driver.directory, 'outside', path))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.lstat(join(this.driver.directory, path))).rejects.toMatchObject({ code: 'ENOENT' });
  }
  private outcome(path: string) {
    const matches = this.driver.result.outcomes.filter(item => item.change.kind === 'move' ? item.change.from === path : item.change.path === path);
    expect(matches, 'Expected an actual outcome for ' + path).toHaveLength(1); return matches[0]!;
  }
}
