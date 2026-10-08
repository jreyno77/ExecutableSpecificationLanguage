import fs from 'node:fs';
import { expect } from 'vitest';
import { NativeSettlingDriver } from '../../../driver/project/typescript/native-settling.js';

export class SettlingNativeExamples {
  private static readonly active: SettlingNativeExamples[] = [];
  private readonly driver = new NativeSettlingDriver();
  static async connected(): Promise<SettlingNativeExamples> {
    const example = new SettlingNativeExamples(); this.active.push(example); await example.driver.project.connect(); return example;
  }
  static async catalog(text: string): Promise<SettlingNativeExamples> {
    const example = await this.connected(); await example.package('catalog', { types: 'index.d.ts' }, { 'index.d.ts': text }); return example;
  }
  static async file(path: string, text: string): Promise<SettlingNativeExamples> {
    const example = await this.connected(); example.driver.select(path); await example.driver.project.file(path, text); return example;
  }
  static async clean(): Promise<void> { for (const example of this.active.splice(0)) await example.driver.dispose(); }
  package(name: string, metadata: object, entries: Record<string, string>): Promise<void> { return this.driver.project.package(name, metadata, entries); }
  settleStatusOnceDuringInitialRead(path = this.driver.selected): void { this.driver.firstFault(path, 'status'); }
  observeInitialFileReads(path: string): void { this.driver.select(path); }
  replaceBytesBeforeSettlingReadPreservingSizeAndModificationTime(path: string, text: string): void { this.driver.select(path); this.driver.replaceBytes(text); }
  pinOnlyStatusTimeToCandidateDuringSettlingRead(path: string): void { this.driver.select(path); this.driver.pinStatus(); }
  changeModeDuringInitialRead(path: string): void { this.driver.firstFault(path, 'mode'); }
  replaceFileDuringInitialRead(path: string, text: string): void { this.driver.identityText = text; this.driver.firstFault(path, 'identity'); }
  changeModificationTimeDuringInitialRead(path: string): void { this.driver.firstFault(path, 'mtime'); }
  changeStatusBetweenObservationAndOpen(path: string): void { this.driver.firstFault(path, 'before-open'); }
  changeStatusAgainBeforeNamedCheck(path: string): void { this.driver.firstFault(path, 'named-after'); }
  changeStatusOnEveryInitialRead(path: string): void { this.driver.firstFault(path, 'repeated'); }
  replaceWithLinkBeforeSettlingRead(path: string): Promise<void> { this.driver.select(path); return this.driver.prepareLink(); }
  createDuringSettlingRead(path: string, text: string): void { this.driver.route = { path, text }; this.driver.secondFault('route'); }
  changeStatusAfterFinalProjectRead(path: string): void { this.driver.select(path); this.driver.afterFinalCapture(); }
  changeStatusBetweenSettlingObservationAndOpen(): void { this.driver.secondFault('open-status'); }
  changeStatusOnlyAtSettlingNamedAfter(): void { this.driver.secondFault('named-status'); }
  failSettlingRead(code: 'EIO'): void { this.driver.readErrorCode = code; this.driver.secondFault('read-error'); }
  capture(options: { imports: readonly string[] }): Promise<void> { return this.driver.capture(options); }
  read(): void { this.driver.read(); }
  async attemptPackageWrite(path: string, text: string): Promise<void> {
    this.driver.project.prepare([{ write: path, text }]); await this.driver.project.apply(true);
  }
  expectComplete(): void { expect(this.driver.project.snapshot.problems).toEqual([]); expect(this.driver.project.snapshot.complete).toBe(true); }
  expectIncomplete(): void { expect(this.driver.project.snapshot.complete).toBe(false); expect(this.driver.project.snapshot.problems.length).toBeGreaterThan(0); }
  expectReadOnlyText(path: string, text: string): void { expect(Buffer.from(this.readOnlyFile(path).bytes).toString('utf8')).toBe(text); }
  expectVersionIsHashOfActualBytes(path: string): void { const file = this.readOnlyFile(path); expect(file.version).toBe(this.driver.project.hash(file.bytes)); }
  expectNoEditablePackageFiles(): void { expect(this.driver.project.snapshot.files.some(file => file.path.split('/').includes('node_modules'))).toBe(false); }
  expectNoReadOnlyFile(path: string): void { expect(this.driver.project.snapshot.readOnlyFiles?.some(file => file.path === path)).not.toBe(true); }
  expectProblemAt(code: string, path: string): void {
    expect(this.driver.project.snapshot.problems).toContainEqual(expect.objectContaining({ code, at: { kind: 'dependency', path: ['typescript', path] } }));
  }
  expectAnyProblem(code: string): void { expect(this.driver.project.snapshot.problems.some(problem => problem.code === code)).toBe(true); }
  expectInitialActualReadBodies(path: string, bodies: string[]): void { expect(this.driver.selected).toBe(path); expect(this.driver.bodies).toEqual(bodies); }
  expectInitialAcquisitionReads(path: string, count: number): void { expect(this.driver.selected).toBe(path); expect(this.driver.bodies).toHaveLength(count); }
  expectSettlingMetadataChecksAgree(path: string): void { expect(this.driver.selected).toBe(path); expect(this.driver.metadataAgrees()).toBe(true); }
  expectOwnedDescriptorsClosed(): void { expect(this.driver.opened).toBeGreaterThan(0); expect(this.driver.descriptorsClosed()).toBe(true); }
  expectLinkTargetNotRead(): void { expect(this.driver.linkTargetOpens).toBe(0); }
  expectWriteRejectedBeforeMutation(): void {
    const receipt = this.driver.project.receipt; expect(receipt.status).toBe('stopped');
    expect(receipt.outcomes.every(outcome => outcome.state === 'not-applied')).toBe(true); expect(receipt.problems.length).toBeGreaterThan(0);
  }
  expectActualText(path: string, text: string): void { expect(fs.readFileSync(this.driver.project.path(path), 'utf8')).toBe(text); }
  expectNoText(): void { expect(this.driver.text).toBeUndefined(); }
  expectProblem(code: string): void { expect(this.driver.input?.problems).toContainEqual(expect.objectContaining({ code, at: { kind: 'dependency', path: ['typescript', this.driver.selected] } })); }
  expectNoCapturedFile(): void { expect(this.driver.input?.files.has(this.driver.selected)).toBe(false); }
  expectSuccessfulDescriptorReads(count: number): void { expect(this.driver.bodies).toHaveLength(count); }
  expectReadAttempts(count: number): void { expect(this.driver.readAttempts).toBe(count); }
  private readOnlyFile(path: string) {
    const file = this.driver.project.snapshot.readOnlyFiles?.find(file => file.path === path);
    if (!file) throw Error('Expected actual captured read-only file ' + path); return file;
  }
}