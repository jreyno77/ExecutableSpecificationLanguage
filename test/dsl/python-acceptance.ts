import { expect } from 'vitest';
import { PythonAcceptanceDriver } from '../driver/python-acceptance.js';

export class PythonAcceptance {
  private static readonly examples: PythonAcceptance[] = [];
  private constructor(private readonly driver: PythonAcceptanceDriver) {}
  static async create(): Promise<PythonAcceptance> {
    const value = new PythonAcceptance(new PythonAcceptanceDriver()); this.examples.push(value); await value.driver.initializeAcceptance(); return value;
  }
  static async dispose(): Promise<void> { for (const value of this.examples.splice(0)) await value.driver.dispose(); }
  aShopperCanAddAnAvailableBook(title: string, quantity: number): void { this.driver.authorShopping(title, quantity); }
  aBookRetainsItsDeclaredData(): void { this.driver.authorBook(); }
  numbersRetainTheirDeclaredMeaning(): void { this.driver.authorNumberComparison(); }
  source(text: string): void { this.driver.source(text); }
  reviseExpectedQuantity(title: string, quantity: number): void { this.driver.reviseExpectedQuantity(title, quantity); }
  changeGeneratedQuantity(quantity: number): Promise<void> { return this.driver.changeGeneratedQuantity(quantity); }
  tryUpdateTests(): Promise<void> { return this.driver.updateTests(); }
  async updateTests(): Promise<void> {
    await this.tryUpdateTests(); expect(this.driver.written.problems, JSON.stringify(this.driver.written.problems)).toEqual([]);
    expect(this.driver.written.receipt?.status).toBe('applied');
  }
  expectUpdateProblem(code: string): void {
    expect(this.driver.written.receipt).toBeUndefined();
    expect(this.driver.written.problems.map(problem => problem.code), JSON.stringify(this.driver.written)).toContain(code);
  }
  async expectScenarioCommentRetained(): Promise<void> { expect(await this.driver.scenarioText()).toContain('# Keep the quantity explanation.'); }
  async expectRememberedImplementationUnchanged(): Promise<void> {
    const retained = (file: { path: string }) => file.path !== 'test/acceptance/test_shopping.py';
    expect((await this.driver.rememberedFiles()).filter(retained)).toEqual(this.driver.remembered.filter(retained).map(file => ({ path: file.path, bytes: Buffer.from(file.bytes) })));
  }
  rememberGeneratedFiles(): Promise<void> { return this.driver.rememberGeneratedFiles(); }
  addReadableNativeEdits(): Promise<void> { return this.driver.addReadableNativeEdits(); }
  addDriverNamedNeighbor(): Promise<void> { return this.driver.addDriverNamedNeighbor(); }
  removeExpectedQuantity(): Promise<void> { return this.driver.removeExpectedQuantity(); }
  readScenario(): Promise<void> { return this.driver.readScenario(); }
  expectNoEdits(): void { expect(this.driver.written.receipt?.status).toBe('unchanged'); expect(this.driver.written.receipt?.outcomes).toEqual([]); }
  async expectRememberedFilesUnchanged(): Promise<void> {
    expect(await this.driver.rememberedFiles()).toEqual(this.driver.remembered.map(file => ({ path: file.path, bytes: Buffer.from(file.bytes) })));
  }
  expectCompleteScenarioRead(): void {
    expect(this.driver.scenarioRead.problems, JSON.stringify(this.driver.scenarioRead.problems)).toEqual([]);
    expect(this.driver.scenarioRead.coverage.complete).toBe(true);
    expect(this.driver.scenarioRead.artifacts.map(artifact => artifact.file.path)).toContain('test/acceptance/test_shopping.py');
  }
  expectCoverageProblem(code: string): void {
    expect(this.driver.scenarioRead.coverage.complete).toBe(false);
    expect(this.driver.scenarioRead.problems.map(problem => problem.code), JSON.stringify(this.driver.scenarioRead)).toContain(code);
  }
  implementTakingOneCopy(): Promise<void> { return this.driver.implementTakingOneCopy(); }
  observePosition(expression: string): Promise<void> { return this.driver.observePosition(expression); }
  async expectNativeTypesAgree(): Promise<void> {
    await this.driver.checkGeneratedTypes();
    expect(this.driver.native.code, this.driver.native.text).toBe(0); expect(this.driver.native.text).not.toContain('error:');
  }
  expectComparisonFailed(): void {
    expect(this.driver.runtime.code, this.driver.runtime.text).not.toBe(0);
    expect(this.driver.runtime.text).toContain('AssertionError'); expect(this.driver.runtime.text).toContain('1 failed');
  }
  expectArithmeticFailure(operation: string): void {
    expect(this.driver.runtime.code, this.driver.runtime.text).not.toBe(0);
    expect(this.driver.runtime.text).toContain(operation + ' by zero'); expect(this.driver.runtime.text).toContain('1 failed');
  }
  expectVerificationRequired(text: string): void {
    expect(this.driver.written.obligations).toMatchObject([{ code: 'unimplemented-verification', message: expect.stringContaining(text) }]);
    this.expectUnimplemented(text);
  }
  observeTextAsNumbers(): Promise<void> { return this.driver.observeTextAsNumbers(); }
  expectInvalidNumber(): void {
    expect(this.driver.runtime.code, this.driver.runtime.text).not.toBe(0);
    expect(this.driver.runtime.text).toContain('Expected a finite Number'); expect(this.driver.runtime.text).toContain('1 failed');
  }
  generateBookContract(): Promise<void> { return this.driver.generateBookContract(); }
  observeBook(expression: string): Promise<void> { return this.driver.observeBook(expression); }
  expectInvalidBook(): void {
    expect(this.driver.runtime.code, this.driver.runtime.text).not.toBe(0);
    expect(this.driver.runtime.text).toContain('AssertionError'); expect(this.driver.runtime.text).toContain('1 failed');
  }
  async generateTests(): Promise<void> {
    await this.driver.generate(); expect(this.driver.written.problems, JSON.stringify(this.driver.written.problems)).toEqual([]);
    expect(['applied', 'unchanged']).toContain(this.driver.written.receipt?.status);
  }
  implementBasket(copies: number): Promise<void> { return this.driver.implementBasket(copies); }
  useExistingBasketDriver(options: Parameters<PythonAcceptanceDriver['useExistingBasketDriver']>[0]): Promise<void> { return this.driver.useExistingBasketDriver(options); }
  useExistingBookDriver(options: Parameters<PythonAcceptanceDriver['useExistingBookDriver']>[0]): Promise<void> { return this.driver.useExistingBookDriver(options); }
  shadowSelectedDriver(): Promise<void> { return this.driver.shadowSelectedDriver(); }
  useInheritedBasketDriver(): Promise<void> { return this.driver.useInheritedBasketDriver(); }
  supplyDriverNumberType(options: Parameters<PythonAcceptanceDriver['supplyDriverNumberType']>[0]): Promise<void> { return this.driver.supplyDriverNumberType(options); }
  async expectStartupNotRun(): Promise<void> { expect(await this.driver.startupRan()).toBe(false); }
  readOperation(name: string): Promise<void> { return this.driver.readOperation(name); }
  expectOperationFiles(paths: string[]): void {
    expect(this.driver.scenarioRead.problems, JSON.stringify(this.driver.scenarioRead.problems)).toEqual([]);
    expect(this.driver.scenarioRead.coverage.complete).toBe(true);
    expect(this.driver.scenarioRead.artifacts.map(artifact => artifact.file.path).sort()).toEqual([...paths].sort());
  }
  tryGenerateTests(): Promise<void> { return this.driver.generate(); }
  expectGenerationProblem(code: string): void { this.expectUpdateProblem(code); }
  keepExistingCatalogDsl(title: string): Promise<void> { return this.driver.keepExistingCatalogDsl(title); }
  async expectCatalogDslUnchanged(): Promise<void> { expect(await this.driver.catalogDslText()).toBe(this.driver.catalogDsl); }
  async expectSelectedDriverUnchanged(): Promise<void> {
    const result = await this.driver.selectedDriverFiles(); expect(result.actual).toBe(result.expected); expect(result.duplicate).toBe(false);
  }
  async expectNoAcceptanceWrites(): Promise<void> { expect(await this.driver.acceptanceFiles()).toEqual([]); }
  runTests(): Promise<void> { return this.driver.runGeneratedTests(); }
  expectPassed(count: number): void { expect(this.driver.runtime.code, this.driver.runtime.text).toBe(0); expect(this.driver.runtime.text).toContain(count + ' passed'); }
  expectWrongQuantity(actual: number, expected: number): void {
    expect(this.driver.runtime.code, this.driver.runtime.text).not.toBe(0);
    expect(this.driver.runtime.text).toContain('Expected ' + expected + ', actual ' + actual);
    expect(this.driver.runtime.text).toContain('1 failed');
  }
  expectUnimplemented(operation: string): void {
    expect(this.driver.runtime.code).not.toBe(0); expect(this.driver.runtime.text).toContain('NotImplementedError'); expect(this.driver.runtime.text).toContain(operation);
  }
  expectReadableSteps(steps: string[]): void {
    for (const step of steps) expect(this.driver.scenario).toContain(step);
    expect(this.driver.scenario).not.toMatch(/sys\.path|http|\.basket/);
  }
}
