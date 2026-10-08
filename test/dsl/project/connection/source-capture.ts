import { expect } from 'vitest';
import type { SourceCapture } from '../../../../src/project/connection/source-loader.js';
import { SourceCaptureDriver, type SourceTransition } from '../../../driver/project/connection/source-capture.js';
export class CapturedSource {
  private capture: SourceCapture | undefined;
  private constructor(private readonly driver: SourceCaptureDriver) {}
  static async author(text: string): Promise<CapturedSource> { return new CapturedSource(await SourceCaptureDriver.author(text)); }
  transition(kind: SourceTransition): void { this.driver.arrange(kind); }
  async read(): Promise<void> { this.capture = await this.driver.capture(); }
  async verifyCapture(): Promise<void> { await this.driver.verify(); }
  async changeStatusThenVerify(): Promise<void> { this.driver.laterStatusChange(); await this.driver.verify(); }
  expectSource(text: string, reads: number): void {
    expect(this.capture?.source.text).toBe(text);
    expect(this.capture?.version).toBe(this.driver.digest(text));
    expect(this.driver.files.problems).toEqual([]);
    this.expectOwnership(reads); if (reads === 2) this.expectConfirmedBodies(text, text);
  }
  expectRefused(code: string, reads: number): void {
    expect(this.capture).toBeUndefined();
    expect(this.driver.files.captured.size).toBe(0);
    this.expectProblem(code); this.expectOwnership(reads);
  }
  expectConfirmedBodies(first: string, second: string): void {
    expect(this.driver.bodies.map(bytes => bytes.toString('utf8'))).toEqual([first, second]);
    const named = this.driver.metadata.filter(row => row.operation === 'named').map(row => row.tuple);
    const initial = this.driver.metadata.filter(row => row.handle === 1).map(row => row.tuple);
    const confirming = this.driver.metadata.filter(row => row.handle === 2).map(row => row.tuple);
    expect(initial).toHaveLength(2); expect(confirming).toHaveLength(2);
    expect(named[0]).toEqual(initial[0]);
    const fields = Object.keys(initial[0]!);
    expect(fields.filter(field => initial[0]![field] !== initial[1]![field])).toEqual(['ctimeNs']);
    expect(named[1]).toEqual(initial[1]);
    expect(named[2]).toEqual(initial[1]); expect(confirming[0]).toEqual(initial[1]);
    expect(confirming[1]).toEqual(initial[1]); expect(named[3]).toEqual(initial[1]);
  }
  expectProblem(code: string): void {
    expect(this.driver.files.problems).toHaveLength(1);
    expect(this.driver.files.problems[0]).toMatchObject({ code, at: { kind: 'dependency', path: ['manifest', 'settings', 'build', 'entries', 0] } });
  }
  expectRetainedSource(text: string): void {
    expect(this.driver.files.captured.get(this.driver.name)?.capture.source.text).toBe(text);
  }
  private expectOwnership(reads: number): void {
    expect(this.driver.bodyReads).toBe(reads);
    expect(this.driver.handles).toHaveLength(reads || 1);
    expect(this.driver.handles.every(handle => handle.closed)).toBe(true);
    expect(this.driver.closedBeforeReopen).toBe(true);
  }
  dispose(): Promise<void> { return this.driver.dispose(); }
}