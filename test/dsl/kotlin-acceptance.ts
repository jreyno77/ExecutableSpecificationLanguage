import { expect, onTestFinished } from 'vitest';
import { KotlinAcceptanceDriver } from '../driver/kotlin-acceptance.js';

export class KotlinAcceptance {
  private constructor(private readonly driver: KotlinAcceptanceDriver) { onTestFinished(() => driver.dispose()); }
  static async connect(): Promise<KotlinAcceptance> {
    const driver = new KotlinAcceptanceDriver(), example = new KotlinAcceptance(driver); await driver.prepare(); return example;
  }
  nativeFile(path: string, text: string): Promise<void> { return this.driver.file(path, text); }
  testRoot(path: string): void { this.driver.acceptanceOptions.testRoot = path; }
  source(text: string): void { this.driver.source(text); }
  implementDriver(text: string): Promise<void> { return this.driver.driver(text); }
  buildContracts(): Promise<void> { return this.driver.contracts(); }
  implement(name: string, body: string): Promise<void> { return this.driver.implement(name, body); }
  async buildAcceptance(): Promise<void> {
    await this.driver.generate(); expect(this.driver.written.problems, this.driver.failureContext).toEqual([]); expect(this.driver.written.receipt?.status).toBe('applied');
  }
  resourceFixture(setupFailure?: string, cleanupFailure?: string): Promise<void> { return this.driver.resourceFixture(setupFailure, cleanupFailure); }
  addTestMember(text: string): Promise<void> { return this.driver.addTestMember(text); }
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
  expectReadContains(text: string): void {
    expect(this.driver.readResult.problems).toEqual([]); expect(this.driver.readResult.coverage.complete).toBe(true);
    expect(this.driver.readResult.artifacts.map(item => new TextDecoder().decode(item.file.bytes)).join('\n')).toContain(text);
  }
  expectReadFiles(files: string[]): void {
    expect(this.driver.readResult.problems).toEqual([]); expect(this.driver.readResult.coverage.complete).toBe(true);
    expect([...new Set(this.driver.readResult.artifacts.map(item => item.file.path.split('/').at(-1)))].sort()).toEqual([...files].sort());
  }
  runTests(): Promise<void> { return this.driver.runTests(); }
  expectTests(passed: number, failed: number): void {
    expect(this.driver.compiled.code, this.driver.compiled.stderr).toBe(0);
    expect(this.driver.outcomes.filter(item => item.status === 'passed').length, JSON.stringify(this.driver.execution)).toBe(passed);
    expect(this.driver.outcomes.filter(item => item.status === 'failed').length).toBe(failed);
    expect(this.driver.outcomes.filter(item => item.status === 'skipped')).toEqual([]);
    expect(this.driver.execution.code).toBe(failed ? 1 : 0);
  }
  expectNoFailure(text: string): void { expect(this.driver.outcomes.map(item => item.failure).join('\n')).not.toContain(text); }
  expectFailure(text: string): void { expect(this.driver.outcomes.map(item => item.failure).join('\n')).toContain(text); }
  expectObligation(code: string): void { expect(this.driver.written.obligations?.map(item => item.code)).toContain(code); }
}
