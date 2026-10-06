import { expect, onTestFinished } from 'vitest';
import { KotlinAcceptanceDriver } from '../../../driver/project/kotlin/kotlin-acceptance.js';

export class KotlinAcceptance {
  private constructor(private readonly driver: KotlinAcceptanceDriver) { onTestFinished(() => driver.dispose()); }
  static async connect(): Promise<KotlinAcceptance> {
    const driver = new KotlinAcceptanceDriver(), example = new KotlinAcceptance(driver); await driver.prepare(); return example;
  }
  replaceNativeText(path: string, before: string, after: string): Promise<void> { return this.driver.replace(path, before, after); }
  nativeFile(path: string, text: string): Promise<void> { return this.driver.file(path, text); }
  testRoot(path: string): void { this.driver.acceptanceOptions.testRoot = path; }
  external(module: string, text: string): void { this.driver.external(module, text); }
  importType(selector: { id: string } | { declaration: string[]; module?: string }, name: string, as?: string): void { this.driver.importType(selector, name, as); }
  source(text: string, renames: Readonly<Record<string, string>> = {}, retired: readonly string[] = []): void { this.driver.source(text, renames, retired); }
  nameOperation(name: string, native: string): void { this.driver.nameOperation(name, native); }
  nameExample(title: string, native: string): void { this.driver.nameExample(title, native); }
  nameGroupFor(title: string, native: string): void { this.driver.nameGroupFor(title, native); }
  readGroupFor(title: string): Promise<void> { return this.driver.readGroupFor(title); }
  changeGroups(text: string, retained: readonly string[], retired: readonly string[] = []): void { this.driver.changeGroups(text, retained, retired); }
  retireExamples(text: string, titles: readonly string[]): void { this.driver.retireExamples(text, titles); }
  addComparisonNeighbor(text: string): Promise<void> { return this.driver.addComparisonNeighbor(text); }
  rememberComparison(title: string): Promise<void> { return this.driver.rememberComparison(title); }
  async expectComparisonRetained(title: string): Promise<void> { expect(await this.driver.hasRememberedComparison(title)).toBe(true); }
  async expectComparisonRemoved(title: string): Promise<void> { expect(await this.driver.hasRememberedComparison(title)).toBe(false); }
  callComparisonFrom(title: string, file: string, name: string, arguments_: string): Promise<void> { return this.driver.callComparisonFrom(title, file, name, arguments_); }
  eraseExpectation(title: string): Promise<void> { return this.driver.eraseExpectation(title); }
  async expectComparisonContains(text: string): Promise<void> { expect(await this.driver.comparisonText()).toContain(text); }
  async expectComparisonExcludes(text: string): Promise<void> { expect(await this.driver.comparisonText()).not.toContain(text); }
  weakenFiniteNumberGuard(): Promise<void> { return this.driver.replace('src/test/kotlin/store/tests/dsl/ExpecChecks.kt', 'require(value.isFinite())', 'require(true)'); }
  deleteGroupFor(title: string): Promise<void> { return this.driver.deleteGroupFor(title); }
  async expectNoNativeGroup(title: string): Promise<void> {
    await this.driver.searchGroupFor(title);
    expect(this.driver.searchResult.definitions).toEqual([]);
    expect(this.driver.searchResult.problems.map(problem => problem.code)).toContain('native-definition-unavailable');
  }
  async expectGroupDefinedIn(title: string, file: string): Promise<void> {
    await this.driver.searchGroupFor(title); this.expectCompleteSearch();
    expect(this.driver.searchResult.definitions.map(item => (item.value as { file: string }).file.split('/').at(-1))).toEqual([file]);
  }
  runTestClasses(classes: readonly string[]): Promise<void> { return this.driver.runTests(false, classes); }
  implementDriver(text: string): Promise<void> { return this.driver.driver(text); }
  implementDriverOperation(name: string, body: string): Promise<void> { return this.driver.implementDriverOperation(name, body); }
  buildContracts(): Promise<void> { return this.driver.contracts(); }
  implement(name: string, body: string): Promise<void> { return this.driver.implement(name, body); }
  async buildAcceptance(): Promise<void> {
    await this.driver.generate(); expect(this.driver.written.problems, this.driver.failureContext).toEqual([]); expect(this.driver.written.receipt?.status).toBe('applied');
  }
  resourceFixture(setupFailure?: string, cleanupFailure?: string): Promise<void> { return this.driver.resourceFixture(setupFailure, cleanupFailure); }
  addTestMember(text: string): Promise<void> { return this.driver.addTestMember(text); }
  allowDriverAdoption(): void { this.driver.acceptanceOptions.adoptExisting = true; }
  selectDriver(file: string, name: string): void { this.driver.selectDriver(file, name); }
  mapOperation(name: string, file: string, owner: string, method: string, parameters: string[]): void { this.driver.mapOperation(name, file, owner, method, parameters); }
  selectFixture(file: string, name: string): void { this.driver.selectFixture(file, name); }
  rememberFile(path: string): Promise<void> { return this.driver.rememberFile(path); }
  async expectFileUnchanged(path: string): Promise<void> { expect(await this.driver.unchangedFile(path)).toBe(true); }
  async updateAcceptance(): Promise<void> {
    await this.driver.generate('update'); expect(this.driver.written.problems, this.driver.failureContext).toEqual([]); expect(this.driver.written.receipt?.status).toBe('applied');
  }
  async repeatAcceptance(): Promise<void> {
    await this.driver.generate(); expect(this.driver.written.problems, this.driver.failureContext).toEqual([]); expect(this.driver.written.receipt?.status).toBe('unchanged');
  }
  async expectNoNativeFile(path: string): Promise<void> { expect((await this.driver.capturedFiles()).has(path)).toBe(false); }
  expectNoRuntimeOutput(text: string): void { expect(this.driver.execution.stdout + this.driver.execution.stderr).not.toContain(text); }
  async expectAcceptanceRefused(code: string): Promise<void> {
    await this.driver.generate('update'); expect(this.driver.written.problems.map(item => item.code)).toContain(code); expect(this.driver.written.receipt).toBeUndefined();
  }
  async expectCreateRefused(code: string): Promise<void> {
    await this.driver.generate(); expect(this.driver.written.problems.map(item => item.code)).toContain(code); expect(this.driver.written.receipt).toBeUndefined();
  }
  async expectInsertRefused(code: string): Promise<void> {
    await this.driver.generate('insert'); expect(this.driver.written.problems.map(item => item.code)).toContain(code); expect(this.driver.written.receipt).toBeUndefined();
  }
  removeNativeFile(path: string): Promise<void> { return this.driver.removeFile(path); }
  readExample(title: string): Promise<void> { return this.driver.readExample(title); }
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
