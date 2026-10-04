import { afterEach, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { ExecutionDriver, type ShopOptions } from '../driver/scenario-execution.js';
const projects: ExecutionDriver[] = [];
afterEach(async () => { for (const project of projects.splice(0)) await project.dispose(); });
const operations = `setup bookIsAvailable(title: Text) returns Nothing
  setup startWithEmptyBasket() returns Nothing
  action addBook(title: Text) returns Nothing
  observation bookQuantity(title: Text) returns Number
  check expectBookQuantity(title: Text, expected: Number) { let actual = bookQuantity(title)
    assert actual == expected }`;
export class ExecutionExamples {
  constructor(readonly driver: ExecutionDriver) {}
  static async fromSource(text: string): Promise<ExecutionExamples> {
    const driver = new ExecutionDriver(); projects.push(driver); await driver.initial(text); return new ExecutionExamples(driver);
  }
  static shoppingProject(): Promise<ExecutionExamples> { return this.fromSource(`examples { ${operations}
  scenario "a shopper can add an available book" {
    given bookIsAvailable("Dune")
    given startWithEmptyBasket()
    when addBook("Dune")
    then expectBookQuantity("Dune", 1)
  }
}`); }
  static emptyAndAddingScenarios(): Promise<ExecutionExamples> { return this.fromSource(`examples { ${operations}
  action leaveBasketAlone() returns Nothing {}
  scenario "empty basket" { given startWithEmptyBasket()
    when leaveBasketAlone()
    then expectBookQuantity("Dune", 0) }
  scenario "add one book" { given bookIsAvailable("Dune")
    when addBook("Dune")
    then expectBookQuantity("Dune", 1) }
}`); }
  connectHttpShopFixture(options: ShopOptions & { requiresConstructorArgument?: 'serverUrl' } = {}): Promise<void> { return this.driver.fixture(options); }
  connectHttpReceipts(options: { nextReceipt: string }): Promise<void> { return this.driver.fixture(options); }
  changeNextActualReceipt(nextReceipt: string): Promise<void> { return this.driver.configure({ nextReceipt }); }
  generateAcceptance(): Promise<void> { return this.driver.generateSelected(); }
  regenerateAcceptance(): Promise<void> { return this.generateAcceptance(); }
  runNativeVitest(options: Parameters<ExecutionDriver['runNative']>[0] = {}): Promise<void> { return this.driver.runNative(options); }
  private assertions() { return this.driver.nativeResult!.testResults.flatMap(result => result.assertionResults); }
  expectPassed(title: string): void { expect(this.driver.nativeExit).toBe(0); expect(this.driver.nativeResult!.success).toBe(true); expect(this.assertions().filter(item => item.title === title).map(item => item.status)).toEqual(['passed']); }
  expectPassedScenarios(titles: string[]): void { expect(this.driver.nativeExit).toBe(0); expect(this.driver.nativeResult!.success).toBe(true); expect(this.assertions().map(item => item.title).sort()).toEqual([...titles].sort()); expect(this.assertions().every(item => item.status === 'passed')).toBe(true); }
  expectFailed(title: string, values: { expected: number; actual: number }): void {
    expect(this.driver.nativeExit).toBe(1); expect(this.driver.nativeResult!.success).toBe(false);
    const assertion = this.assertions().find(item => item.title === title)!; expect(assertion.status).toBe('failed');
    expect(assertion.failureMessages.join('\n')).toContain('expected ' + values.actual + ' to strictly equal ' + values.expected);
  }
  expectActualBasketQuantity(title: string, quantity: number): void {
    expect(this.driver.events.filter(item => item.event === 'observed' && item.title === title).map(item => item.actual)).toEqual([quantity]);
    const closed = this.driver.events.filter(item => item.event === 'closed'); expect(closed).toHaveLength(1);
    expect(new Map(closed[0]!.contents).get(title) ?? 0).toBe(quantity);
  }
  expectAllAcquiredServersClosed(): void {
    const opened = this.driver.events.filter(item => item.event === 'started').map(item => item.id);
    expect(opened.length).toBeGreaterThan(0); expect(this.driver.events.filter(item => item.event === 'closed').map(item => item.id).sort()).toEqual(opened.sort());
    expect(this.driver.events.filter(item => item.event === 'closed').every(item => item.listening === false)).toBe(true);
  }
  async expectReadableShoppingSteps(): Promise<void> { expect(await this.driver.calls('test/acceptance/shopping.test.ts')).toEqual([
    'await shopping.bookIsAvailable("Dune")', 'await shopping.startWithEmptyBasket()', 'await shopping.addBook("Dune")', 'await shopping.expectBookQuantity("Dune", 1)',
  ]); }
  expectActualReceiptRead(receipt: string): void { expect(this.driver.events.filter(item => item.event === 'receipt-read').map(item => item.receipt)).toEqual([receipt]); }
  expectActualApplicationOrder(order: string[]): void { expect(this.driver.events.map(item => item.event)).toEqual(order); }
  expectIndependentApplicationResources(): void { expect(new Set(this.driver.events.filter(item => item.event === 'started').map(item => item.id)).size).toBe(2); const observed = this.driver.events.filter(item => item.event === 'observed'); expect(observed.map(item => item.actual).sort()).toEqual([0, 1]); expect(new Set(observed.map(item => item.id)).size).toBe(2); }
  expectNativeFailureContaining(message: string): void { expect(this.driver.nativeExit).toBe(1); expect(JSON.stringify(this.driver.nativeResult)).toContain(message); }
  expectSetupFailure(message: string): void { this.expectNativeFailureContaining(message); }
  expectNoDomainActions(): void { expect(this.driver.events.filter(item => !['started', 'closed'].includes(item.event))).toEqual([]); }
  expectNoPassingRunClaim(): void { expect(this.driver.nativeResult!.success).toBe(false); expect(this.driver.nativeExit).toBe(1); }
  expectNoSkippedOrTodoScenarios(): void { expect(this.assertions().map(item => item.status)).toEqual(['failed']); }
  expectActualObservationCount(count: number): void { expect(this.driver.events.filter(item => item.event === 'observed')).toHaveLength(count); }
  expectNativeAttemptCount(count: number): void { expect(this.assertions()).toHaveLength(count); expect(this.driver.events.filter(item => item.event === 'started')).toHaveLength(count); }
  expectDefaultDslAndDriverGenerated(): void { expect(this.driver.written.artifacts?.some(item => (item.locator.value as { file: string }).file === 'test/dsl/shopping.ts')).toBe(true); expect(this.driver.written.artifacts?.some(item => (item.locator.value as { file: string }).file === 'test/driver/shopping.ts')).toBe(true); }
  rememberDefaultFixture(): Promise<void> { return this.driver.rememberPaths(['test/dsl/shopping-test.ts']); }
  async expectDefaultFixtureUnchanged(): Promise<void> { expect(await this.driver.pathsUnchanged()).toBe(true); }
  async expectSelectedFixture(file: string, name: string): Promise<void> { expect(this.driver.written.problems).toEqual([]); expect(await this.driver.text('test/acceptance/shopping.test.ts')).toContain('import { ' + name + ' } from "../dsl/' + file.split('/').at(-1)!.replace('.ts', '.js') + '"'); }
  expectDefaultScaffoldsReportedAsUnselected(): void { expect(this.driver.written.obligations?.filter(item => item.code === 'unselected-default-scaffold')).toHaveLength(4); expect(this.driver.written.obligations?.some(item => item.code === 'implementation-required')).toBe(false); }
  authorManualCallerOfDefaultFixture(): Promise<void> { return this.driver.manualCaller(); }
  rememberManualCaller(): Promise<void> { return this.driver.rememberPaths(['test/manual.test.ts']); }
  async expectManualCallerUnchanged(): Promise<void> { expect(await this.driver.pathsUnchanged()).toBe(true); }
  async expectGeneratedTestsImport(file: string): Promise<void> { await this.expectSelectedFixture(file, 'test'); }
  authorCompatibleAlternateFixture(): Promise<void> { return this.driver.alternate(); }
  changeGeneratedFixtureImport(_file: string): Promise<void> { return this.driver.redirect(); }
  rememberProjectBytes(): Promise<void> { return this.driver.remember(); }
  async expectProjectBytesUnchanged(): Promise<void> { expect(await this.driver.unchanged()).toBe(true); }
  expectFixtureImportConflict(): void { expect(this.driver.written.problems.some(item => ['output-conflict', 'unsupported-native-test', 'generated-test-drift'].includes(item.code))).toBe(true); expect(this.driver.written.receipt).toBeUndefined(); }
  expectUnchangedReceipt(): void { expect(this.driver.written.problems).toEqual([]); expect(this.driver.written.receipt?.status).toBe('unchanged'); }
  denyRuntimeStarts(): Promise<void> { return this.driver.configure({ denyStart: true }); }
  async expectNoRuntimeStart(): Promise<void> { await expect(fs.access(this.driver.path('shop-events.jsonl'))).rejects.toThrow(); }
  expectGeneratedFilesUnchanged(): void { this.expectUnchangedReceipt(); }
  rememberFixtureAndDriverBytes(): Promise<void> { return this.driver.rememberPaths(['src/shop.ts', 'test/dsl/http-shopping-test.ts', 'test/driver/http-shopping.ts']); }
  async expectFixtureAndDriverBytesUnchanged(): Promise<void> { expect(await this.driver.pathsUnchanged()).toBe(true); }
  renameScenario(title: string): void { this.driver.rename('a shopper can add an available book', title); }
  async mapMissingNativeFixture(): Promise<void> { this.driver.selectFixture('test/dsl/missing-test.ts'); }
  expectLocatedFixtureMappingProblem(): void { expect(this.driver.written.problems.some(item => item.code === 'incompatible-fixture' && item.at.kind !== 'builtin')).toBe(true); expect(this.driver.written.receipt).toBeUndefined(); }
}
