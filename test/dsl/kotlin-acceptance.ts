import { expect, onTestFinished } from 'vitest';
import { KotlinAcceptanceDriver } from '../driver/kotlin-acceptance.js';

export class KotlinAcceptance {
  private constructor(private readonly driver: KotlinAcceptanceDriver) { onTestFinished(() => driver.dispose()); }
  static async connect(): Promise<KotlinAcceptance> {
    const driver = new KotlinAcceptanceDriver(), example = new KotlinAcceptance(driver); await driver.prepare(); return example;
  }
  replaceNativeText(path: string, before: string, after: string): Promise<void> { return this.driver.replace(path, before, after); }
  nativeFile(path: string, text: string): Promise<void> { return this.driver.file(path, text); }
  testRoot(path: string): void { this.driver.acceptanceOptions.testRoot = path; }
  source(text: string, renames: Readonly<Record<string, string>> = {}, retired: readonly string[] = []): void { this.driver.source(text, renames, retired); }
  nameOperation(name: string, native: string): void { this.driver.nameOperation(name, native); }
  nameExample(title: string, native: string): void { this.driver.nameExample(title, native); }
  implementDriver(text: string): Promise<void> { return this.driver.driver(text); }
  buildContracts(): Promise<void> { return this.driver.contracts(); }
  implement(name: string, body: string): Promise<void> { return this.driver.implement(name, body); }
  async buildAcceptance(): Promise<void> {
    await this.driver.generate(); expect(this.driver.written.problems, this.driver.failureContext).toEqual([]); expect(this.driver.written.receipt?.status).toBe('applied');
  }
  resourceFixture(setupFailure?: string, cleanupFailure?: string): Promise<void> { return this.driver.resourceFixture(setupFailure, cleanupFailure); }
  addTestMember(text: string): Promise<void> { return this.driver.addTestMember(text); }
  selectDriver(file: string, name: string): void { this.driver.selectDriver(file, name); }
  mapOperation(name: string, file: string, owner: string, method: string, parameters: string[]): void { this.driver.mapOperation(name, file, owner, method, parameters); }
  selectFixture(file: string, name: string): void { this.driver.selectFixture(file, name); }
  rememberFile(path: string): Promise<void> { return this.driver.rememberFile(path); }
  async expectFileUnchanged(path: string): Promise<void> { expect(await this.driver.unchangedFile(path)).toBe(true); }
  async updateAcceptance(): Promise<void> {
    await this.driver.generate(true); expect(this.driver.written.problems, this.driver.failureContext).toEqual([]); expect(this.driver.written.receipt?.status).toBe('applied');
  }
  expectNoRuntimeOutput(text: string): void { expect(this.driver.execution.stdout + this.driver.execution.stderr).not.toContain(text); }
  async expectAcceptanceRefused(code: string): Promise<void> {
    await this.driver.generate(true); expect(this.driver.written.problems.map(item => item.code)).toContain(code); expect(this.driver.written.receipt).toBeUndefined();
  }
  expectRuntimeOutput(text: string): void { expect(this.driver.execution.stdout + this.driver.execution.stderr).toContain(text); }
  expectVisibleSteps(steps: string[]): void {
    const text = [...this.driver.files].filter(([path]) => path.includes('/acceptance/')).map(([, text]) => text).join('\n');
    for (const step of steps) expect(text).toContain(step);
  }
  readOperation(name: string): Promise<void> { return this.driver.readOperation(name); }
  readGroup(): Promise<void> { return this.driver.readGroup(); }
  searchGroup(): Promise<void> { return this.driver.searchGroup(); }
  expectReadProblem(code: string): void {
    expect(this.driver.readResult.problems.map(item => item.code)).toContain(code); expect(this.driver.readResult.coverage.complete).toBe(false);
  }
  expectSearchProblem(code: string): void {
    expect(this.driver.searchResult.problems.map(item => item.code)).toContain(code);
    expect(this.driver.searchResult.incoming.coverage.complete).toBe(false); expect(this.driver.searchResult.outgoing.coverage.complete).toBe(false);
  }
  expectCompleteSearch(): void {
    expect(this.driver.searchResult.problems).toEqual([]);
    expect(this.driver.searchResult.incoming.coverage.complete).toBe(true); expect(this.driver.searchResult.outgoing.coverage.complete).toBe(true);
  }
  expectReadContains(text: string): void {
    expect(this.driver.readResult.problems).toEqual([]); expect(this.driver.readResult.coverage.complete).toBe(true);
    expect(this.driver.readResult.artifacts.map(item => new TextDecoder().decode(item.file.bytes)).join('\n')).toContain(text);
  }
  expectReadExcludes(text: string): void { expect(this.driver.readResult.artifacts.map(item => new TextDecoder().decode(item.file.bytes)).join('\n')).not.toContain(text); }
  async expectNativeFile(path: string, expected: string): Promise<void> { expect((await this.driver.capturedFiles()).get(path)).toBe(expected); }
  expectReadFiles(files: string[]): void {
    expect(this.driver.readResult.problems).toEqual([]); expect(this.driver.readResult.coverage.complete).toBe(true);
    expect([...new Set(this.driver.readResult.artifacts.map(item => item.file.path.split('/').at(-1)))].sort()).toEqual([...files].sort());
  }
  runTests(concurrent = false): Promise<void> { return this.driver.runTests(concurrent); }
  deleteExample(title: string): Promise<void> { return this.driver.deleteExample(title); }
  deleteGroup(): Promise<void> { return this.driver.deleteGroup(); }
  expectDeletionApplied(): void { expect(this.driver.written.problems).toEqual([]); expect(this.driver.written.receipt?.status).toBe('applied'); }
  expectDeletionUnchanged(): void { expect(this.driver.written.problems).toEqual([]); expect(this.driver.written.receipt?.status).toBe('unchanged'); }
  expectDeletionRefused(code: string): void { expect(this.driver.written.problems.map(item => item.code)).toContain(code); expect(this.driver.written.receipt).toBeUndefined(); }
  expectNoGeneratedStep(text: string): void { expect([...this.driver.files].filter(([path]) => path.includes('/acceptance/')).map(([, text]) => text).join('\n')).not.toContain(text); }
  expectRuntimeLines(text: string, count: number): void { expect(this.driver.execution.stdout.split(/\r?\n/).filter(line => line === text)).toHaveLength(count); }
  expectDistinctResources(count: number): void { expect(new Set([...this.driver.execution.stdout.matchAll(/RESOURCE_PORT=(\d+)/g)].map(match => match[1])).size).toBe(count); }
  expectTests(passed: number, failed: number): void {
    expect(this.driver.compiled.code, this.driver.compiled.stderr).toBe(0);
    expect(this.driver.outcomes.filter(item => item.status === 'passed').length, JSON.stringify(this.driver.execution)).toBe(passed);
    expect(this.driver.outcomes.filter(item => item.status === 'failed').length).toBe(failed);
    expect(this.driver.outcomes.filter(item => item.status === 'skipped')).toEqual([]);
    expect(this.driver.execution.code).toBe(failed ? 1 : 0);
  }
  expectNoFailure(text: string): void { expect(this.driver.outcomes.map(item => item.failure).join('\n')).not.toContain(text); }
  expectFailure(text: string): void { expect(this.driver.outcomes.map(item => item.failure).join('\n')).toContain(text); }
  expectNoObligation(code: string): void { expect(this.driver.written.obligations?.map(item => item.code) ?? []).not.toContain(code); }
  expectObligation(code: string): void { expect(this.driver.written.obligations?.map(item => item.code)).toContain(code); }
}
