import { createHash } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { expect } from 'vitest';
import type { Configuration } from '../../../src/project/connection/configuration.js';
import type { ObservedFile } from '../../../src/project/connection/project-files.js';
import { PackageMetadataDriver, type MetadataPath, type MetadataRead, type StatusChange } from '../../driver/cli/package-metadata.js';

const fields = ['dev', 'ino', 'mode', 'size', 'mtimeNs', 'ctimeNs'] as const;
const tuple = (info: BigIntStats) => fields.map(field => info[field]);
const digest = (text: string) => createHash('sha256').update(Buffer.from(text)).digest('hex');

/** Readable caller actions and independently authored observations over actual metadata acquisition. */
export class PackageMetadata {
  private constructor(private readonly driver: PackageMetadataDriver) {}
  static async connected(files: Record<MetadataPath, string>, options: { modifiedAt: string }): Promise<PackageMetadata> {
    const driver = new PackageMetadataDriver(options.modifiedAt);
    try { await driver.setup(files); return new PackageMetadata(driver); }
    catch (error) { try { await driver.dispose(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Metadata setup and cleanup failed.'); } throw error; }
  }
  dispose(): Promise<void> { return this.driver.dispose(); }
  onlyCtimeChanges(path: MetadataPath, when: Exclude<StatusChange, 'anchor'>): void { this.driver.selected = path; this.driver.status = when; }
  secondCtimeDiffersFromCandidate(path: MetadataPath): void { this.driver.selected = path; this.driver.status = 'anchor'; }
  replaceBetweenInitialReads(path: MetadataPath, text: string): void {
    this.onlyCtimeChanges(path, 'initial'); this.driver.change = 'bytes'; this.driver.changedText = text;
  }
  replaceBeforeOpen(path: MetadataPath): void { this.driver.selected = path; this.driver.change = 'before-open'; }
  replaceNameAfterInitialBody(path: MetadataPath): void { this.driver.selected = path; this.driver.change = 'named-after'; }
  changeModeAfterBody(path: MetadataPath, mode: 'read-only'): void {
    if (mode !== 'read-only') throw Error('This finite example changes only to read-only mode.');
    this.driver.selected = path; this.driver.change = 'mode';
  }
  changeModifiedTimeAfterBody(path: MetadataPath, date: string): void { this.driver.selected = path; this.driver.change = 'mtime'; this.driver.changedDate = date; }
  appendAfterBody(path: MetadataPath, text: string): void { this.driver.selected = path; this.driver.change = 'append'; this.driver.changedText = text; }
  failFirstCloseAfterPhysicalClosure(path: MetadataPath, error: { code: 'EIO'; message: string }): void { this.driver.selected = path; this.driver.firstCloseError = error; }
  failSecondBody(path: MetadataPath, error: { code: 'EIO'; message: string }): void { this.driver.selected = path; this.driver.secondBodyError = error; }
  holdLockBodyAndFailManifest(error: { code: 'EIO'; message: string }): void { this.driver.heldSiblingError = error; }
  failLockBeforeManifest(errors: { lock: string; manifest: string }): void { this.driver.orderedFailures = errors; }
  readRequestedPackages(packages: Configuration['packages']): Promise<void> { return this.driver.readRequestedPackages(packages); }
  readStrict(path: MetadataPath): Promise<void> { return this.driver.readStrict(path); }
  captureInitial(path: MetadataPath): Promise<void> { return this.driver.captureInitial(path); }

  expectMetadataInputs(files: Record<MetadataPath, string>): void {
    const report = this.driver.report; expect(report, 'actual readPackages report').toBeDefined();
    expect(report!.value).toEqual([]); expect(report!.packages).toEqual([]);
    expect(report!.problems).toEqual([]); expect(report!.deferred).toEqual([]);
    expect(report!.inputs).toEqual(Object.entries(files).map(([path, text]) => ({
      uri: pathToFileURL(this.driver.path(path as MetadataPath)).href, version: digest(text),
    })));
    expect(this.driver.packageReaderEntries).toBe(1);
  }
  expectRefused(code: string, message?: string): void {
    const report = this.driver.report; expect(report, 'actual readPackages report').toBeDefined();
    expect(report!.value).toBeUndefined(); expect(report!.inputs).toEqual([]); expect(report!.packages).toEqual([]); expect(report!.deferred).toEqual([]);
    expect(report!.problems).toHaveLength(1);
    expect(report!.problems[0]).toMatchObject({ code, at: { kind: 'dependency', path: ['project', this.driver.rootPath] } });
    if (message !== undefined) expect(report!.problems[0]!.message).toBe(message);
  }
  expectDirectReadRefused(code: string): void {
    expect(this.driver.captured).toBeUndefined();
    expect(this.driver.directError).toMatchObject({ diagnostic: { code, at: { kind: 'dependency', path: ['project', this.driver.rootPath, this.driver.selected] } } });
  }
  expectActualReads(path: MetadataPath, counts: { initial: number; final: number }): void {
    expect(this.driver.reads.filter(row => row.path === path && row.initial && row.body !== undefined)).toHaveLength(counts.initial);
    expect(this.driver.reads.filter(row => row.path === path && !row.initial && row.body !== undefined)).toHaveLength(counts.final);
  }
  expectActualOpens(path: MetadataPath, count: number): void { expect(this.driver.reads.filter(row => row.path === path)).toHaveLength(count); }
  expectSuccessfulBodies(path: MetadataPath, count: number): void { expect(this.driver.reads.filter(row => row.path === path && row.body !== undefined)).toHaveLength(count); }
  expectPhysicalCloses(path: MetadataPath, count: number): void { expect(this.driver.reads.filter(row => row.path === path && row.physicallyClosed)).toHaveLength(count); }
  expectPackageReaderEntered(count: number): void { expect(this.driver.packageReaderEntries).toBe(count); }
  expectReturnedWithOpenDescriptors(count: number): void {
    if (this.driver.heldSiblingError && (!this.driver.heldBodyReached || this.driver.lockHeldAtManifestRefusal !== true)) {
      throw Error('SETUP/coverage failure: the real lock body and descriptor were not held at manifest refusal before fallback release.');
    }
    expect(this.driver.returnedOpen, 'ledger saved at original caller promise resolution, before drain/cleanup').toBe(count);
  }
  expectObservedFailureOrder(paths: MetadataPath[]): void { expect(this.driver.failures).toEqual(paths); }
  expectClosedWithoutNativeProcess(): void {
    expect(this.driver.nativeProcesses).toBe(0);
    expect(this.driver.reads.length).toBeGreaterThan(0);
    for (const row of this.driver.reads) { expect(row.physicallyClosed).toBe(true); expect(row.closeAttempts).toBe(1); }
    for (const observation of this.driver.statObservations) {
      for (const field of fields.slice(0, -1)) expect(observation.delivered[field]).toBe(observation.actual[field]);
    }
    if (this.driver.change) expect(this.driver.mutationPerformed, 'actual arranged file mutation').toBe(true);
  }
  expectEligibleInitialCtime(path: MetadataPath): void {
    const first = this.row(path, 1);
    expect(tuple(this.info(first, 'before'))).toEqual(tuple(this.info(first, 'opened')));
    expect(tuple(this.info(first, 'after')).slice(0, -1)).toEqual(tuple(this.info(first, 'opened')).slice(0, -1));
    expect(this.info(first, 'after').ctimeNs).not.toBe(this.info(first, 'opened').ctimeNs);
    expect(tuple(this.info(first, 'named'))).toEqual(tuple(this.info(first, 'after')));
  }
  expectSettlingEvidence(path: MetadataPath, counts: { initialReads: number; finalReads: number }): void {
    this.expectEligibleInitialCtime(path); this.expectStableSecond(path);
    const first = this.row(path, 1), second = this.row(path, 2);
    expect(first.body, 'original first returned body').toBeDefined(); expect(second.body).toBeDefined(); expect(second.body).toEqual(first.body);
    expect(tuple(this.info(second, 'before'))).toEqual(tuple(this.info(first, 'after')));
    expect(first.closeOrder).toBeDefined(); expect(first.closeOrder!).toBeLessThan(second.openOrder);
    this.expectActualReads(path, { initial: counts.initialReads, final: counts.finalReads });
    this.expectActualOpens(path, counts.initialReads + counts.finalReads);
  }
  expectComparedActualBodies(bodies: string[]): void {
    expect(this.driver.reads.filter(row => row.path === this.driver.selected && row.initial && row.body !== undefined)
      .map(row => row.body!.toString('utf8'))).toEqual(bodies);
  }
  expectEligibleFirstAndStableSecondTuples(): void {
    this.expectEligibleInitialCtime(this.driver.selected); this.expectStableSecond(this.driver.selected);
    expect(tuple(this.info(this.row(this.driver.selected, 2), 'before'))).toEqual(tuple(this.info(this.row(this.driver.selected, 1), 'after')));
  }
  expectEligibleFirstAndStableSecondWithDifferentCtime(): void {
    this.expectEligibleInitialCtime(this.driver.selected); this.expectStableSecond(this.driver.selected);
    const candidate = this.info(this.row(this.driver.selected, 1), 'after'), second = this.info(this.row(this.driver.selected, 2), 'before');
    expect(tuple(candidate).slice(0, -1)).toEqual(tuple(second).slice(0, -1)); expect(candidate.ctimeNs).not.toBe(second.ctimeNs);
  }
  expectCapturedBytes(text: string): void {
    const captured = this.capturedFile();
    expect(Buffer.from(captured.bytes).toString('utf8')).toBe(text); expect(captured.version).toBe(digest(text));
  }
  expectFreshInfoFromSecondRead(): void {
    expect(this.driver.captured?.info).toBeDefined();
    expect(tuple(this.driver.captured!.info!)).toEqual(tuple(this.info(this.row(this.driver.selected, 2), 'before')));
    expect(this.driver.captured!.info!.ctimeNs).not.toBe(this.info(this.row(this.driver.selected, 1), 'before').ctimeNs);
  }
  expectStableInitialAdmission(path: MetadataPath): void {
    const first = this.row(path, 1); expect(first.initial).toBe(true); expect(first.body).toBeDefined();
    for (const phase of ['opened', 'after', 'named'] as const) expect(tuple(this.info(first, phase))).toEqual(tuple(this.info(first, 'before')));
    expect(this.driver.packageReaderEntries).toBe(1);
  }
  expectActualIdentityDisagreement(firstPhase: 'named-before', secondPhase: 'opened-before'): void {
    expect(firstPhase).toBe('named-before'); expect(secondPhase).toBe('opened-before');
    const first = this.row(this.driver.selected, 1);
    expect(first.before!.actual.ino).not.toBe(first.opened!.actual.ino);
  }
  expectEligibleDescriptorButDifferentNamedIdentity(): void {
    const first = this.row(this.driver.selected, 1), opened = this.info(first, 'opened'), after = this.info(first, 'after');
    expect(tuple(opened).slice(0, -1)).toEqual(tuple(after).slice(0, -1)); expect(opened.ctimeNs).not.toBe(after.ctimeNs);
    expect(first.named?.actual.ino).toBeDefined(); expect(first.named!.actual.ino).not.toBe(first.opened!.actual.ino);
  }
  expectActualChangedField(field: 'mode' | 'mtimeNs' | 'size'): void {
    const first = this.row(this.driver.selected, 1);
    expect(first.after?.actual[field]).toBeDefined(); expect(first.after!.actual[field]).not.toBe(first.before!.actual[field]);
  }
  private row(path: MetadataPath, number: number): MetadataRead {
    const row = this.driver.reads.find(row => row.path === path && row.number === number);
    if (!row) throw Error('Required real metadata acquisition did not occur: ' + path + ' #' + number); return row;
  }
  private info(row: MetadataRead, phase: 'before' | 'opened' | 'after' | 'named'): BigIntStats {
    const observation = row[phase]; if (!observation) throw Error('Required actual metadata phase did not occur: ' + row.path + ' #' + row.number + ' ' + phase);
    return observation.delivered;
  }
  private expectStableSecond(path: MetadataPath): void {
    const second = this.row(path, 2); expect(second.initial).toBe(true); expect(second.body).toBeDefined();
    for (const phase of ['opened', 'after', 'named'] as const) expect(tuple(this.info(second, phase))).toEqual(tuple(this.info(second, 'before')));
    const first = this.row(path, 1); expect(first.closeOrder).toBeDefined(); expect(first.closeOrder!).toBeLessThan(second.openOrder);
  }
  private capturedFile(): Extract<ObservedFile['value'], { state: 'file' }> {
    const captured = this.driver.captured; if (captured?.value.state !== 'file') throw Error('No actual captured file observation.'); return captured.value;
  }
}

