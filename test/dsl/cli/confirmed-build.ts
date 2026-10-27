import { createHash } from 'node:crypto';
import { expect, onTestFinished } from 'vitest';
import { ConfirmedBuildDriver } from '../../driver/cli/confirmed-build.js';

export class ConfirmedBuild {
  private readonly driver = new ConfirmedBuildDriver();
  private constructor() { onTestFinished(() => this.driver.dispose()); }
  private static async create(path: string, text: string, ordinary = false, native = false): Promise<ConfirmedBuild> {
    const build = new ConfirmedBuild(); await build.driver.setup(path, text, ordinary, native); return build;
  }
  static withFile(path: string, text: string): Promise<ConfirmedBuild> { return this.create(path, text); }
  static withOrdinarySource(path: string, text: string): Promise<ConfirmedBuild> { return this.create(path, text, true); }
  static withNativeType(path: string, text: string): Promise<ConfirmedBuild> { return this.create(path, text, false, true); }
  fileStatusSettlesDuringRead(path: string): void { this.driver.status(path); }
  fileStatusSettlesDuringNativeRead(path: string): void { this.driver.status(path, 2); }
  fileStatusSettlesDuringFinalRead(path: string): void { this.driver.status(path, 2); }
  fileStatusChangesDuringBothReads(path: string): void { this.driver.repeatedStatus(path); }
  replaceDuringConfirmation(path: string, text: string): void { this.driver.replace(path, text); }
  rejectConfirmedCapture(message: string): void { this.driver.reject(message); }
  collect(): Promise<void> { return this.driver.collect(); }
  async expectCollectionRejected(message: string): Promise<void> { await expect(this.collect()).rejects.toThrow(message); }

  expectCompleteFile(path: string, text: string): void {
    const snapshot = this.driver.snapshot.current;
    expect(snapshot.complete).toBe(true); expect(snapshot.problems).toEqual([]);
    const file = snapshot.files.find(file => file.path === path);
    expect(file).toEqual({ path, bytes: expect.any(Uint8Array), version: createHash('sha256').update(text).digest('hex') });
    expect([...file!.bytes]).toEqual([...Buffer.from(text)]);
    this.expectClosedDescriptors();
  }
  expectNativeDeclaration(path: string, text: string): void {
    const snapshot = this.driver.snapshot.current, file = snapshot.readOnlyFiles?.find(file => file.path === path);
    expect(file).toEqual({ path, bytes: expect.any(Uint8Array), version: createHash('sha256').update(text).digest('hex') });
    expect([...file!.bytes]).toEqual([...Buffer.from(text)]);
    expect(snapshot.files.some(file => file.path === path)).toBe(false);
  }
  expectIncomplete(code: string): void {
    const snapshot = this.driver.snapshot.current;
    expect(snapshot.complete).toBe(false);
    expect(snapshot.problems).toContainEqual(expect.objectContaining({ code,
      at: { kind: 'dependency', path: ['project', snapshot.root.path, 'src', 'book.ts'] } }));
    expect(snapshot.files.some(file => file.path === 'src/book.ts')).toBe(false);
    this.expectClosedDescriptors();
  }
  expectNoOrdinaryFallback(): void {
    const acquisitions = this.driver.snapshot.observations.at(-1)!.acquisitions;
    expect(acquisitions.some(read => read.kind === 'capture')).toBe(true);
    expect(acquisitions.filter(read => read.kind === 'ordinary')).toEqual([]);
  }
  expectOneBodyReadPerAcquisition(): void {
    const observation = this.driver.snapshot.observations.at(-1)!;
    expect(observation.acquisitions).toHaveLength(2);
    for (const { index } of observation.acquisitions) expect(observation.events.filter(event => event.acquisition === index && event.kind === 'body')).toHaveLength(1);
    this.expectClosedDescriptors();
  }
  expectNoThirdBodyReadInTriggeredConfirmation(): void {
    const events = this.triggeredEvents();
    expect(events.filter(event => event.kind === 'body')).toHaveLength(2);
    expect(events.filter(event => event.kind === 'open')).toHaveLength(2);
    this.expectClosedDescriptors();
  }
  expectConfirmedActualBodies(path: string, text: string): void {
    expect(path).toBe('src/book.ts');
    const events = this.triggeredEvents(), opened = events.filter(event => event.kind === 'open');
    expect(opened).toHaveLength(2);
    const first = opened[0]!.handle, second = opened[1]!.handle;
    expect(events.filter(event => event.kind === 'body').map(event => [...event.bytes!]))
      .toEqual([[...Buffer.from(text)], [...Buffer.from(text)]]);
    const named = events.filter(event => event.kind === 'named'), original = named[0]!.tuple!;
    const firstStats = events.filter(event => event.kind === 'opened' && event.handle === first);
    expect(firstStats).toHaveLength(2); expect(firstStats[0]!.tuple).toEqual(original);
    const settled = firstStats[1]!.tuple!;
    expect(settled.ctimeNs).not.toBe(original.ctimeNs);
    expect({ ...settled, ctimeNs: original.ctimeNs }).toEqual(original);
    expect(named).toHaveLength(4);
    for (const event of named.slice(1)) expect(event.tuple).toEqual(settled);
    const confirmed = events.filter(event => event.kind === 'opened' && event.handle === second);
    expect(confirmed).toHaveLength(2);
    for (const event of confirmed) expect(event.tuple).toEqual(settled);
    for (const event of events.filter(event => event.tuple)) for (const field of ['dev', 'ino', 'mode', 'size', 'mtimeNs'] as const) {
      expect(event.tuple![field]).toBe(event.actual![field]);
    }
    const closed = events.findIndex(event => event.kind === 'close' && event.handle === first);
    expect(closed).toBeGreaterThanOrEqual(0); expect(events.indexOf(opened[1]!)).toBeGreaterThan(closed);
    this.expectClosedDescriptors();
  }
  private triggeredEvents() {
    return this.driver.snapshot.observations.at(-1)!.events.filter(event => event.acquisition === this.driver.selectedAcquisition);
  }
  expectClosedDescriptors(): void {
    for (const observation of this.driver.snapshot.observations) {
      expect(observation.atReturn).toEqual({ pending: 0, open: 0, closed: observation.handles.length });
      expect(observation.handles.every(handle => handle.closed)).toBe(true);
    }
  }
}
