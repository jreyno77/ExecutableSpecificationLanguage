import { createHash } from 'node:crypto';
import { expect, onTestFinished } from 'vitest';
import { InitialSnapshotDriver } from '../../../driver/project/connection/initial-snapshot.js';

export class SnapshotProject {
  private readonly driver = new InitialSnapshotDriver();
  private constructor() { onTestFinished(() => this.driver.dispose()); }
  static async connected(text: string): Promise<SnapshotProject> {
    const project = new SnapshotProject();
    await project.driver.setup(text);
    return project;
  }
  captureInitialSnapshot(): Promise<void> { return this.driver.read(true); }
  readSnapshot(): Promise<void> { return this.driver.read(false); }
  statusChangesDuringRead(): void { this.driver.arrange('status'); }
  statusChangesDuringBothReads(): void { this.driver.arrange('repeated-status'); }
  modifiedTimeChangesDuringRead(): void { this.driver.arrange('modified-time'); }
  modeChangesDuringRead(): void { this.driver.arrange('mode'); }
  namedIdentityDisagreesAfterBody(): void { this.driver.arrange('named-replacement'); }
  openedFileDisagreesWithNamedFile(): void { this.driver.arrange('opened-mismatch'); }
  candidateChangesBeforeReopen(): void { this.driver.arrange('candidate-mismatch'); }
  replaceBetweenReads(text: string): void { this.driver.replaceAfterFirstClose(text); }
  closeReportsErrorAfterPhysicalClose(handle: 1 | 2): void { this.driver.failClose(handle); }

  expectCompleteFile(text: string): void {
    expect(this.driver.current.complete).toBe(true);
    expect(this.driver.current.problems).toEqual([]);
    this.expectCapturedFile(text);
  }
  expectCapturedFile(text: string): void {
    expect(this.driver.current.files).toHaveLength(1);
    expect(this.driver.current.files[0]).toEqual({ path: '.gitattributes', bytes: expect.any(Uint8Array),
      version: createHash('sha256').update(text).digest('hex') });
    expect([...this.driver.current.files[0]!.bytes]).toEqual([...Buffer.from(text)]);
  }
  expectIncomplete(code: 'changed-during-read' | 'read-failed', retainFile = false): void {
    expect(this.driver.current.complete).toBe(false);
    expect(this.driver.current.problems).toEqual([expect.objectContaining({ code, related: [],
      at: { kind: 'dependency', path: ['project', this.driver.current.root.path, '.gitattributes'] } })]);
    if (!retainFile) expect(this.driver.current.files).toEqual([]);
  }
  expectBodyReads(count: number): void { expect(this.driver.observations.flatMap(item => item.events.filter(event => event.kind === 'body'))).toHaveLength(count); }
  expectOpens(count: number): void { expect(this.driver.observations.at(-1)!.events.filter(event => event.kind === 'open')).toHaveLength(count); }
  expectStatusObservations(named: number, opened: number): void {
    const events = this.driver.observations.at(-1)!.events;
    expect(events.filter(event => event.kind === 'named')).toHaveLength(named);
    expect(events.filter(event => event.kind === 'opened')).toHaveLength(opened);
  }
  expectNoThirdRead(): void { expect(this.driver.observations.at(-1)!.events.filter(event => event.kind === 'open')).toHaveLength(2); }
  expectComparedBodies(first: string, second: string): void {
    const bodies = this.driver.observations.at(-1)!.events.filter(event => event.kind === 'body');
    expect(bodies.map(event => [...event.bytes!])).toEqual([[...Buffer.from(first)], [...Buffer.from(second)]]);
    expect(Buffer.byteLength(first)).toBe(Buffer.byteLength(second));
  }
  expectStrictConfirmationOfActualBodies(text: string): void {
    this.expectStrictConfirmationTuples();
    const events = this.driver.observations.at(-1)!.events;
    expect(events.filter(event => event.kind === 'body').map(event => [...event.bytes!]))
      .toEqual([[...Buffer.from(text)], [...Buffer.from(text)]]);
  }
  expectStrictConfirmationTuples(): void {
    const events = this.driver.observations.at(-1)!.events, firstNamed = events.find(event => event.kind === 'named')!.tuple!;
    for (const event of events.filter(event => event.tuple)) for (const field of ['dev', 'ino', 'mode', 'size'] as const) {
      expect(event.tuple![field], 'Only authored ctime/mtime changes may be isolated in this proof.').toBe(event.actual![field]);
    }
    const firstStats = events.filter(event => event.kind === 'opened' && event.handle === 1);
    const firstAfter = firstStats[1]!.tuple!;
    expect(firstStats[0]!.tuple).toEqual(firstNamed);
    expect({ ...firstAfter, ctimeNs: firstNamed.ctimeNs }).toEqual(firstNamed);
    expect(firstAfter.ctimeNs).not.toBe(firstNamed.ctimeNs);
    const settled = events.find(event => event.kind === 'named' && event.handle === 1)!.tuple!;
    expect(settled).toEqual(firstAfter);
    const confirmed = events.filter(event => event.kind === 'opened' && event.handle === 2);
    expect(confirmed).toHaveLength(2);
    for (const event of confirmed) expect(event.tuple).toEqual(settled);
    const freshNamed = events.filter(event => event.kind === 'named').slice(2);
    expect(freshNamed).toHaveLength(2);
    for (const event of freshNamed) expect(event.tuple).toEqual(settled);
  }
  expectCandidateAnchorRejected(): void {
    const events = this.driver.observations.at(-1)!.events, named = events.filter(event => event.kind === 'named');
    expect(named).toHaveLength(3);
    const settled = named[1]!.tuple!, fresh = named[2]!.tuple!;
    const firstOpened = events.filter(event => event.kind === 'opened');
    expect(firstOpened).toHaveLength(2);
    expect(firstOpened[0]!.tuple).toEqual(named[0]!.tuple);
    expect(firstOpened[1]!.tuple).toEqual(settled);
    expect({ ...settled, ctimeNs: named[0]!.tuple!.ctimeNs }).toEqual(named[0]!.tuple);
    expect(settled.ctimeNs).not.toBe(named[0]!.tuple!.ctimeNs);
    expect(fresh).not.toEqual(settled);
    expect({ ...fresh, ctimeNs: settled.ctimeNs }).toEqual(settled);
    expect(events.findIndex(event => event.kind === 'close' && event.handle === 1)).toBeLessThan(events.indexOf(named[2]!));
    expect(events.filter(event => event.kind === 'open')).toHaveLength(1);
  }
  expectClosedBeforeReopen(): void {
    const events = this.driver.observations.at(-1)!.events;
    const closed = events.findIndex(event => event.kind === 'close' && event.handle === 1);
    const reopened = events.findIndex(event => event.kind === 'open' && event.handle === 2);
    expect(closed).toBeGreaterThanOrEqual(0);
    expect(reopened).toBeGreaterThan(closed);
  }
  expectClosedDescriptors(): void {
    for (const observation of this.driver.observations) {
      expect(observation.atReturn).toEqual({ pending: 0, open: 0, closed: observation.handles.length });
      expect(observation.events.filter(event => event.kind === 'close')).toHaveLength(observation.handles.length);
      expect(observation.handles.every(handle => handle.closed)).toBe(true);
    }
  }
}
