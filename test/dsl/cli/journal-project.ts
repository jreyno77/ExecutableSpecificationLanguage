import { promises as fs } from 'node:fs';
import { expect } from 'vitest';
import { JournalDriver } from '../../driver/cli/journal-project.js';
import type { FileChange } from '../../../src/project/connection/project-writer.js';
import type { OutputPlan } from '../../../src/project/output/output.js';

export class JournalProject {
  private constructor(private readonly driver: JournalDriver) {}
  static async create(files: Record<string, string> = {}): Promise<JournalProject> { return new JournalProject(await JournalDriver.create(files)); }
  static async fromLegacyFixture(): Promise<JournalProject> { return new JournalProject(await JournalDriver.fromLegacy()); }
  plan(changes: FileChange[]): OutputPlan { return this.driver.plan(changes); }
  apply(plan: OutputPlan, completion?: FileChange): Promise<void> { return this.driver.apply([plan], completion); }
  recover(): Promise<void> { return this.driver.recover(); }
  stopAtWrite(path: string): void { this.driver.stopAtWrite(path); }
  stopAtRemove(path: string): void { this.driver.stopAtRemove(path); }
  clearWriteFailure(): void { this.driver.clearFailure(); }
  write(path: string, bytes: string | Uint8Array): Promise<void> { return this.driver.write(path, bytes); }
  remove(path: string): Promise<void> { return fs.unlink(this.driver.path(path)); }
  confirmOriginalIdentity(): Promise<void> { return this.driver.confirmOriginalIdentity(); }
  rememberOriginalGraph(): Promise<void> { return this.driver.rememberOriginal(); }
  rememberActualFiles(): Promise<void> { return this.driver.rememberFiles(); }
  rewritePending(change: (record: any) => void): Promise<void> { return this.driver.rewritePending(change); }
  expectProblem(code: string): void { expect(this.driver.report.problems).toEqual(expect.arrayContaining([expect.objectContaining({ code })])); }
  expectBuilt(): void { expect(this.driver.report).toMatchObject({ status: 'built', exitCode: 0, problems: [] }); }
  async expectText(path: string, text: string): Promise<void> { expect((await this.driver.read(path)).toString()).toBe(text); }
  async expectAbsent(path: string): Promise<void> { await expect(fs.stat(this.driver.path(path))).rejects.toMatchObject({ code: 'ENOENT' }); }
  async expectPendingRetained(): Promise<void> { expect((await fs.stat(this.driver.path('.expec/build-pending.json'))).isFile()).toBe(true); }
  expectNoPending(): Promise<void> { return this.expectAbsent('.expec/build-pending.json'); }
  async expectActualFilesUnchanged(): Promise<void> { expect(await this.driver.files()).toEqual(this.driver.remembered); }
  async expectRecordBelow(bytes: number): Promise<void> { expect((await this.driver.read('.expec/build-pending.json')).byteLength).toBeLessThan(bytes); }
  async expectFileFact(path: string, expected: { version: string; preimage: boolean }): Promise<void> {
    const file = (await this.driver.pending()).graph.files.find((file: any) => file.path === path);
    expect(file).toBeDefined(); expect(file.version).toBe(expected.version); expect(file.bytes !== undefined).toBe(expected.preimage);
  }
  async expectPreimagePaths(expected: string[]): Promise<void> {
    const record = await this.driver.pending();
    expect(record.graph.files.filter((file: any) => file.bytes !== undefined).map((file: any) => file.path).sort()).toEqual([...expected].sort());
    expect(record.format).toBe(2);
  }
  async expectOriginalFileFacts(): Promise<void> {
    expect((await this.driver.pending()).graph.files.map((file: any) => [file.path, file.version])).toEqual(this.driver.original.files.map(file => [file.path, file.version]));
  }
  async expectOriginalPreimages(): Promise<void> {
    for (const file of (await this.driver.pending()).graph.files.filter((file: any) => file.bytes !== undefined)) {
      const original = this.driver.original.files.find(before => before.path === file.path)!;
      expect(Buffer.from(file.bytes, 'base64')).toEqual(Buffer.from(original.bytes));
    }
  }
  async rememberPendingAllocatedIds(): Promise<void> { this.driver.pendingIds = (await this.driver.pending()).candidate.elements.map((element: any) => element.id); }
  async expectOriginalAllocatedIdsConfirmed(): Promise<void> {
    const ledger = JSON.parse((await this.driver.read('.expec/identity.json')).toString());
    expect(ledger.baseline.elements.map((element: any) => element.id)).toEqual(this.driver.pendingIds ?? this.driver.identified.baseline.elements.map(element => element.id));
  }
  async expectHistoricalFixturePreserved(): Promise<void> {
    const raw = this.driver.historical!.raw, rebound = await this.driver.pending();
    expect(rebound.format).toBe(1); expect(rebound.stage).toBe(raw.stage);
    expect(rebound.graph.files).toEqual(raw.graph.files); expect(rebound.graph.excluded).toEqual(raw.graph.excluded);
    expect(rebound.graph.excludeNames).toEqual(raw.graph.excludeNames); expect(rebound.plans).toEqual(raw.plans);
    const hostless = (baseline: any) => { const value = structuredClone(baseline);
      delete value.entry; delete value.modules; delete value.context;
      for (const element of value.elements) { delete element.address.module; delete element.origin.module; delete element.origin.node.sourceId; delete element.origin.range.sourceId; }
      return value;
    };
    expect(hostless(rebound.candidate)).toEqual(hostless(raw.candidate));
    const rawLedger = JSON.parse(Buffer.from(raw.ledger, 'base64').toString()), ledger = JSON.parse(Buffer.from(rebound.ledger, 'base64').toString());
    expect(hostless(ledger.baseline)).toEqual(hostless(rawLedger.baseline));
  }
}
