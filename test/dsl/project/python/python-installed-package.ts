import { expect, onTestFinished } from 'vitest';
import { PythonInstalledDriver } from '../../../driver/project/python/python-installed-package.js';

export class InstalledPython {
  private generated?: Record<string, string>;
  private constructor(private readonly driver: PythonInstalledDriver) { onTestFinished(() => driver.dispose()); }
  static prepare = PythonInstalledDriver.prepare;
  static finish = PythonInstalledDriver.finish;
  static async installPackedProduct(): Promise<InstalledPython> {
    const driver = new PythonInstalledDriver(), consumer = new InstalledPython(driver);
    await driver.installProduct();
    expect(driver.observed.declarations, driver.package.result.stderr).toMatchObject({ code: 0 });
    return consumer;
  }
  initialize(): Promise<void> { return this.driver.run('init'); }
  install(): Promise<void> { return this.driver.run('install'); }
  source(text: string): Promise<void> { return this.driver.run('source', { source: text }); }
  build(): Promise<void> { return this.driver.run('build'); }
  implementBasket(copies: number): Promise<void> { return this.driver.run('implement', { copies }); }
  test(): Promise<void> { return this.driver.run('test'); }
  expectStatus(status: string): void {
    const actual = this.driver.observed.command!;
    expect(actual.code, actual.stdout + actual.stderr).toBe(0);
    expect(actual.report).toMatchObject({ status, exitCode: 0, problems: [] });
  }
  rememberGeneratedCode(): void {
    this.generated = structuredClone(this.driver.observed.generated);
    expect(Object.keys(this.generated)).toContain('test/acceptance/test_shopping.py');
    const test = this.generated['test/acceptance/test_shopping.py']!;
    for (const step of ['bookIsAvailable("Dune")', 'startWithEmptyBasket()', 'addBook("Dune")', 'expectBookQuantity("Dune", 1.0)'])
      expect(test).toContain(step);
  }
  expectScenarioPassed(title: string): void {
    this.expectStatus('tested');
    const execution = this.driver.observed.command!.report.stages.find(stage => stage.name === 'execution')!;
    expect(execution).toMatchObject({ status: 'passed', native: { exitCode: 0 },
      tests: [{ title, state: 'passed', errors: [] }], errors: [] });
    expect(execution.collected).toHaveLength(1);
  }
  expectWrongQuantity(expected: number, actual: number): void {
    const command = this.driver.observed.command!;
    expect(command.code, command.stdout + command.stderr).toBe(1);
    expect(command.report.status).toBe('failed');
    const execution = command.report.stages.find(stage => stage.name === 'execution')!;
    expect(execution.tests).toHaveLength(1);
    expect(execution.tests![0]!.state).toBe('failed');
    expect(JSON.stringify(execution.tests![0]!.errors)).toContain('Expected ' + expected);
    expect(JSON.stringify(execution.tests![0]!.errors)).toContain('actual ' + actual);
    expect(execution.native!.exitCode).not.toBe(0);
  }
  expectGeneratedCodeUnchanged(): void { expect(this.driver.observed.generated).toEqual(this.generated); }
  expectInstalledProductOnly(): void {
    expect(this.driver.package.location.insidePackage).toBe(true);
    expect(this.driver.observed.executable.replaceAll('\\', '/')).toContain('/node_modules/executable-specification-language/dist/cli-entry.js');
    expect(this.driver.observed.privateImportDenied).toBe('ERR_PACKAGE_PATH_NOT_EXPORTED');
    expect(this.driver.observed.command!.stderr).toContain('PYTHON-CLI-GUARDS:checkout-denied,import-denied,network-denied,acquisition-denied');
  }
}
