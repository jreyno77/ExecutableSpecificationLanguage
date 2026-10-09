import { createHash } from 'node:crypto';
import { expect, onTestFinished } from 'vitest';
import { ProjectFileCaptureDriver, type FileFault } from '../../../driver/project/connection/project-file-capture.js';

export class CapturedFile {
  private readonly driver = new ProjectFileCaptureDriver();
  private armed = false;
  private constructor(private readonly path: string) { onTestFinished(() => this.driver.dispose()); }
  static async withFile(path: string, text: string): Promise<CapturedFile> {
    const file = new CapturedFile(path); await file.driver.setup({ [path]: text }); return file;
  }
  static async withAbsentFile(path: string): Promise<CapturedFile> {
    const file = new CapturedFile(path); await file.driver.setup({}); return file;
  }
  private arm(fault: FileFault): void { this.armed = true; this.driver.arm(this.path, fault); }
  statusSettlesDuringRead(): void { this.arm('status'); }
  modificationTimeChangesDuringRead(): void { this.arm('mtime'); }
  modeChangesDuringRead(): void { this.arm('mode'); }
  sizeChangesDuringRead(): void { this.arm('size'); }
  namedIdentityChangesDuringRead(): void { this.arm('name'); }
  openedStatusDisagreesWithNamedFile(): void { this.arm('opening'); }
  confirmationCandidateChanges(): void { this.arm('candidate'); }
  routeReplacedAfterFirstClose(): void { this.driver.replaceRouteAfterClose(1); }
  routeReplacedAfterConfirmationClose(): void { this.driver.replaceRouteAfterClose(2); }
  firstCloseFailsAfterPhysicalClosure(): void { this.driver.failClosure(1); }
  confirmationCloseFailsAfterPhysicalClosure(): void { this.driver.failClosure(2); }
  capture(): Promise<void> { return this.driver.run(this.path, 'capture'); }
  readStrictly(): Promise<void> { return this.driver.run(this.path, 'read'); }
  verifyStrictly(): Promise<void> { return this.driver.run(this.path, 'verify'); }
  verifyCaptured(): Promise<void> { return this.driver.run(this.path, 'captured-verify'); }
  captureBaseline(): Promise<void> { return this.driver.baseline(this.path); }
  replace(text: string): Promise<void> { return this.driver.replace(this.path, text); }
  remove(): Promise<void> { return this.driver.remove(this.path); }
  replaceIdentity(text: string): Promise<void> { return this.driver.replaceIdentity(this.path, text); }
  addOrdinaryHardLink(): Promise<void> { return this.driver.addHardLink(this.path); }
  previousObservationIsUnknown(): void { this.driver.previous = { value: { path: this.path, state: 'unknown' } }; }

  expectCapturedBytes(text: string): void {
    expect(this.driver.error).toBeUndefined();
    const result = this.driver.result;
    expect(result?.value).toEqual({ path: this.path, state: 'file', bytes: expect.any(Uint8Array),
      version: createHash('sha256').update(text).digest('hex') });
    if (result?.value.state !== 'file') throw Error('No actual captured file.');
    expect([...result.value.bytes]).toEqual([...Buffer.from(text)]);
    expect(result.info).toBeDefined();
    this.expectArrangedPhase(); this.expectClosedDescriptors();
  }
  expectRefused(code: string): void {
    expect(this.driver.result).toBeUndefined();
    expect(this.driver.error).toMatchObject({ diagnostic: { code, at: { kind: 'dependency' } } });
    const diagnostic = (this.driver.error as { diagnostic: { at: { path: readonly string[] } } }).diagnostic;
    expect(diagnostic.at.path.slice(0, 2)).toEqual(['project', this.driver.root]);
    this.expectArrangedPhase(); this.expectClosedDescriptors();
  }
  expectClosureFailure(): void {
    expect(this.driver.result).toBeUndefined();
    expect(this.driver.error).toMatchObject({ code: 'EIO', message: 'Authored close error after physical closure.' });
    this.expectArrangedPhase(); this.expectClosedDescriptors();
  }
  expectOneOpen(): void {
    expect(this.acquisition().events.filter(event => event.kind === 'open')).toHaveLength(1);
    this.expectClosedDescriptors();
  }
  expectPreservedChildAcrossReplacedRoute(text: string): void {
    const route = this.driver.routeReplacement;
    expect(route).toBeDefined();
    if (!route) throw Error('No actual parent-route replacement was observed.');
    expect({ dev: route.after.dev, ino: route.after.ino }).toEqual({ dev: route.before.dev, ino: route.before.ino });
    expect({ dev: route.parentAfter.dev, ino: route.parentAfter.ino })
      .not.toEqual({ dev: route.parentBefore.dev, ino: route.parentBefore.ino });
    expect([...route.beforeBytes]).toEqual([...Buffer.from(text)]);
    expect([...route.afterBytes]).toEqual([...Buffer.from(text)]);
  }
  expectNoBodyRead(): void { this.expectBodies(0); }
  expectOneBodyRead(): void { this.expectBodies(1); }
  expectTwoBodies(): void { this.expectBodies(2); }
  private expectBodies(count: number): void {
    expect(this.acquisition().events.filter(event => event.kind === 'body')).toHaveLength(count);
    this.expectClosedDescriptors();
  }
  expectConfirmedActualBodies(text: string): void {
    const events = this.acquisition().events, opens = events.filter(event => event.kind === 'open');
    expect(opens).toHaveLength(2);
    expect(events.filter(event => event.kind === 'body').map(event => [...event.bytes!]))
      .toEqual([[...Buffer.from(text)], [...Buffer.from(text)]]);
    const first = opens[0]!.handle, second = opens[1]!.handle;
    const named = events.filter(event => event.kind === 'named'), initial = named[0]!.tuple!;
    const firstStats = events.filter(event => event.kind === 'opened' && event.handle === first);
    expect(firstStats).toHaveLength(2); expect(firstStats[0]!.tuple).toEqual(initial);
    const settled = firstStats[1]!.tuple!;
    expect(settled.ctimeNs).not.toBe(initial.ctimeNs);
    expect({ ...settled, ctimeNs: initial.ctimeNs }).toEqual(initial);
    const firstClose = events.findIndex(event => event.kind === 'close' && event.handle === first);
    const secondOpen = events.indexOf(opens[1]!);
    expect(firstClose).toBeGreaterThanOrEqual(0); expect(secondOpen).toBeGreaterThan(firstClose);
    const freshCandidates = events.slice(firstClose + 1, secondOpen).filter(event => event.kind === 'named');
    expect(freshCandidates.length).toBeGreaterThan(0);
    for (const event of freshCandidates) expect(event.tuple).toEqual(settled);
    const secondStats = events.filter(event => event.kind === 'opened' && event.handle === second);
    expect(secondStats).toHaveLength(2);
    for (const event of secondStats) expect(event.tuple).toEqual(settled);
    for (const event of named.slice(1)) expect(event.tuple).toEqual(settled);
    for (const event of events.filter(event => event.tuple)) for (const field of ['dev', 'ino', 'mode', 'size', 'mtimeNs'] as const) {
      expect(event.tuple![field]).toBe(event.actual![field]);
    }
    this.expectClosedDescriptors();
  }
  expectClosedDescriptors(): void {
    expect(this.driver.atReturn).toEqual({ pending: 0, open: 0, closed: this.driver.handles.length });
    expect(this.driver.handles.every(handle => handle.closed)).toBe(true);
    expect(this.driver.acquisitions.flatMap(acquisition => acquisition.events.filter(event => event.kind === 'close')))
      .toHaveLength(this.driver.handles.length);
  }
  private expectArrangedPhase(): void { if (this.armed) expect(this.driver.phaseReached).toBe(true); }
  private acquisition() {
    const acquisition = this.driver.triggered ?? this.driver.acquisitions.at(-1);
    expect(acquisition?.path).toBe(this.path);
    if (!acquisition) throw Error('The guarded file acquisition was not observed.');
    return acquisition;
  }
}
