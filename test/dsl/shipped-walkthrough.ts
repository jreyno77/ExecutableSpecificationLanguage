import { expect, onTestFinished } from 'vitest';
import { ShippedWalkthroughDriver } from '../driver/shipped-walkthrough.js';

export class ShippedWalkthrough {
  private constructor(private readonly driver: ShippedWalkthroughDriver) {}
  static async install(): Promise<ShippedWalkthrough> {
    const driver = new ShippedWalkthroughDriver(); onTestFinished(() => driver.package.dispose());
    await driver.prepare(); return new ShippedWalkthrough(driver);
  }
  expectDocumentedShoppingFiles(): void {
    expect([...this.driver.files.keys()], 'The installed README must contain the actual copyable shopping files.').toEqual([
      'main.expec', 'expec.json', 'game/tsconfig.json', 'game/src/basket.ts', 'game/test/driver/shopping.ts',
    ]);
  }
  copySpecification(): Promise<void> { return this.driver.copy(['main.expec', 'expec.json']); }
  async command(args: string[]): Promise<void> { await this.driver.command(args); }
  expectSuccess(): void { expect(this.driver.result.code, JSON.stringify({ status: this.driver.report.status, problems: this.driver.report.problems }) + this.driver.result.stderr).toBe(0); }
  async configureDocumentedNativeProject(): Promise<void> { await this.driver.copy(['game/tsconfig.json']); }
  async expectReadableSteps(steps: string[]): Promise<void> {
    const source = await this.driver.text('game/test/acceptance/shopping.test.ts');
    for (const step of steps) expect(source).toContain(step);
    expect(await this.driver.text('game/test/driver/shopping.ts')).toContain('Not implemented');
  }
  async implementBasket(mode: 'missing-add' | 'working'): Promise<void> {
    await this.driver.copy(['game/src/basket.ts', 'game/test/driver/shopping.ts']);
    if (mode === 'missing-add') await this.driver.breakBasket();
  }
  expectQuantityFailure(title: string, expected: number, actual: number): void {
    expect(this.driver.result.code).toBe(1);
    const test = this.driver.report.stages.find(stage => stage.name === 'execution')?.tests?.find(test => test.title === title);
    expect(test?.state, this.driver.result.stdout + this.driver.result.stderr).toBe('failed');
    expect(test?.errors).toContainEqual(expect.objectContaining({ actual: String(actual), expected: String(expected) }));
  }
  expectPassed(title: string): void {
    this.expectSuccess(); expect(this.driver.report.status).toBe('tested');
    expect(this.driver.report.stages.find(stage => stage.name === 'execution')?.tests).toContainEqual(expect.objectContaining({ title, state: 'passed' }));
  }
  source(text: string): Promise<void> { return this.driver.file('main.expec', text); }
  async expectUnknownDeclaration(name:string,file:string): Promise<void> {
    this.expectProblem('unresolved-reference');
    const problem=this.driver.report.problems.find(problem=>problem.code==='unresolved-reference'),range=problem?.at?.range;
    expect(range?.sourceId).toContain(file);expect(range).toBeDefined();
    expect((await this.driver.text(file)).slice(range!.start.offset,range!.end.offset)).toBe(name);
    expect(this.driver.report.stages.some(stage=>stage.name==='execution')).toBe(false); expect(this.driver.report.status).not.toBe('tested');
  }
  async withoutPackageRequirements(): Promise<void> { await this.driver.removePackageRequirements(); }
  rememberWorkingFiles(): Promise<void> { return this.driver.remember(''); }
  declineInitialization(): Promise<void> { return this.driver.declineInitialization(); }
  async expectDeclinedWithoutChanges(): Promise<void> {
    expect(this.driver.answered).toBe(true); expect(this.driver.result.code).toBe(3); expect(this.driver.result.stderr).toContain('declined:');
    expect(await this.driver.unchanged('')).toBe(true);
  }
  rememberProjectFiles(): Promise<void> { return this.driver.remember(); }
  expectProblem(code: string): void { expect(this.driver.result.code).toBe(1); expect(this.driver.report.problems).toContainEqual(expect.objectContaining({ code })); }
  async expectProjectFilesUnchanged(): Promise<void> { expect(await this.driver.unchanged()).toBe(true); }
}
