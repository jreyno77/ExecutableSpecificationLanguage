import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { expect, onTestFinished } from 'vitest';
import { CapturedPackagesDriver } from '../../driver/cli/captured-packages.js';

export class CapturedPackages {
  private readonly driver = new CapturedPackagesDriver();
  private constructor() { onTestFinished(() => this.driver.dispose()); }
  static async withPackage(name: string, manifest: string): Promise<CapturedPackages> {
    const packages = new CapturedPackages(); await packages.driver.setup(name, manifest); return packages;
  }
  statusSettlesDuringPackageRead(): void { this.driver.status('outer-initial'); }
  statusSettlesDuringVerification(): void { this.driver.status('outer-final'); }
  replaceDuringConfirmation(text: string): void { this.driver.fault('body', text); }
  statusChangesDuringBothReads(): void { this.driver.fault('repeated-status'); }
  statusSettlesDuringNativeAdmission(): void { this.driver.status('native-admission'); }
  statusSettlesDuringNativeVerification(): void { this.driver.status('native-verification'); }
  rootManifestStatusChangesDuringRead(): void { this.driver.rootStatus(true); }
  statusSettlesInRootManifest(): void { this.driver.rootStatus(); }
  statusSettlesInLockfile(): void { this.driver.lockStatus(); }
  pauseRootManifestRead(): void { this.driver.pauseRootRead(); }
  packageModificationTimeChangesDuringRead(): void { this.driver.packageMtimeChanges(); }
  releaseRootManifestRead(): void { this.driver.releaseRootRead(); }
  async expectCollectionPendingAfterPackageRefusal(): Promise<void> {
    const error = await this.driver.waitForPackageRefusal();
    expect(error).toMatchObject({ diagnostic: { code: 'stale-project' } });
    expect(this.driver.files.phaseReached).toBe(true);
    expect(this.driver.files.handles.some(handle => handle.path === 'package.json' && !handle.closed)).toBe(true);
    expect(this.driver.collectionSettled).toBe(false);
  }
  collect(): Promise<void> { return this.driver.collect(); }
  install(): Promise<void> { return this.driver.install(); }
  expectSuppliedPackage(name: string, version: string): void {
    expect(this.driver.result?.problems).toEqual([]); expect(this.driver.result?.deferred).toEqual([]);
    expect(this.driver.result?.value).toEqual([{ name, version }]);
    expect(this.driver.result?.packages).toEqual([{ name, requested: '1.0.0', selected: version, installed: version }]);
    this.expectClosedDescriptors();
  }
  expectRefused(code: string): void {
    expect(this.driver.files.phaseReached).toBe(true); expect(this.driver.result?.value).toBeUndefined();
    expect(this.driver.result?.problems).toContainEqual(expect.objectContaining({ code }));
    this.expectClosedDescriptors();
  }
  expectConfirmedManifest(path: string, text: string): void {
    const input = this.driver.result?.inputs?.find(input => input.uri === pathToFileURL(this.driver.files.path(path)).href);
    expect(input).toEqual({ uri: pathToFileURL(this.driver.files.path(path)).href, version: createHash('sha256').update(text).digest('hex') });
    this.expectConfirmation(path, text);
  }
  expectConfirmedNativeAcquisition(path: string): void {
    expect(this.driver.files.triggered?.phase).toBe('native');
    this.expectConfirmedManifest(path, this.driver.initial.get(path)!);
  }
  private expectConfirmation(path: string, text: string): void {
    const acquisition = this.driver.files.triggered; expect(this.driver.files.phaseReached).toBe(true); expect(acquisition?.path).toBe(path);
    const events = acquisition!.events, opened = events.filter(event => event.kind === 'open');
    expect(opened).toHaveLength(2);
    expect(events.filter(event => event.kind === 'body').map(event => event.bytes!.toString())).toEqual([text, text]);
    const first = opened[0]!.handle, second = opened[1]!.handle;
    const before = events.find(event => event.kind === 'opened' && event.handle === first)!.tuple!;
    const settled = events.filter(event => event.kind === 'opened' && event.handle === first).at(-1)!.tuple!;
    expect(settled.ctimeNs).not.toBe(before.ctimeNs); expect({ ...settled, ctimeNs: before.ctimeNs }).toEqual(before);
    const confirmation = events.filter(event => event.kind === 'opened' && event.handle === second);
    expect(confirmation).toHaveLength(2); for (const event of confirmation) expect(event.tuple).toEqual(settled);
    for (const event of events.filter(event => event.tuple)) for (const field of ['dev', 'ino', 'mode', 'size', 'mtimeNs'] as const) expect(event.tuple![field]).toBe(event.actual![field]);
    expect(events.findIndex(event => event.kind === 'close' && event.handle === first)).toBeLessThan(events.indexOf(opened[1]!));
    this.expectClosedDescriptors();
  }
  expectOnlyTwoBodiesInConfirmation(): void {
    expect(this.driver.files.phaseReached).toBe(true);
    expect(this.driver.files.triggered?.events.filter(event => event.kind === 'body')).toHaveLength(2);
    this.expectClosedDescriptors();
  }
  expectOneBodyReadPerAcquisition(): void {
    expect(this.driver.files.acquisitions.length).toBeGreaterThan(3);
    for (const acquisition of this.driver.files.acquisitions) expect(acquisition.events.filter(event => event.kind === 'body')).toHaveLength(1);
    this.expectClosedDescriptors();
  }
  expectNoNativeInstallation(): void { expect(this.driver.nativeStarts).toBe(0); expect(this.driver.unchangedAfterInstall).toBe(true); }
  expectClosedDescriptors(): void {
    expect(this.driver.files.atReturn).toEqual({ pending: 0, open: 0, closed: this.driver.files.handles.length });
    expect(this.driver.files.handles.every(handle => handle.closed)).toBe(true);
  }
}
