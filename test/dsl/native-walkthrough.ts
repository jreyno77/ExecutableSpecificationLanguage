import { isAbsolute } from 'node:path';
import { expect } from 'vitest';
import { NativeWalkthroughDriver } from '../driver/native-walkthrough.js';

export class NativeWalkthrough {
  private before: Record<string, string> = {};
  private selected?: { id: string; file: string; title: string; selector: string };
  private constructor(private readonly driver: NativeWalkthroughDriver) {}
  static async installed(target: 'java' | 'kotlin' | 'python'): Promise<NativeWalkthrough> {
    const driver = new NativeWalkthroughDriver(target); await driver.prepare(); return new NativeWalkthrough(driver);
  }
  async expectNoDevelopmentCheckout(): Promise<void> {
    const installed = this.driver.package;
    for (const path of ['src', '.git', '.local-docs']) expect(await installed.absent(path), path).toBe(true);
    expect(await installed.artifactDigest()).toBe(installed.metadata.sha256);
    expect(installed.metadata.commit).toMatch(/^[a-f0-9]{40}$/);
    const paths = await installed.installedPaths();
    expect(paths.version).toBe(installed.metadata.version);
    expect(isAbsolute(paths.within) || paths.within.startsWith('..')).toBe(false);
    const executable = await this.driver.installedExecutable();
    expect(isAbsolute(executable) || executable.startsWith('..')).toBe(false);
    expect(executable.replaceAll('\\', '/')).toBe('executable-specification-language/dist/cli-entry.js');
    console.log(JSON.stringify({ delivery: installed.metadata, installed: paths }));
  }
  copyShippedShoppingSpecification(): Promise<void> { return this.driver.copySpecification(); }
  private async success(command: 'init' | 'install' | 'check' | 'build', status: string): Promise<void> {
    await this.driver.command(command);
    expect(this.driver.result.code, this.driver.result.stdout + this.driver.result.stderr).toBe(0);
    expect(this.driver.report.status).toBe(status); expect(this.driver.report.problems).toEqual([]);
  }
  initializeDocumentedJavaProject(): Promise<void> { expect(this.driver.target).toBe('java'); return this.success('init', 'initialized'); }
  initializeDocumentedKotlinProject(): Promise<void> { expect(this.driver.target).toBe('kotlin'); return this.success('init', 'initialized'); }
  initializeDocumentedPythonProject(): Promise<void> { expect(this.driver.target).toBe('python'); return this.success('init', 'initialized'); }
  appendDocumentedAcceptanceOutput(): Promise<void> { return this.driver.appendAcceptanceOutput(); }
  async installCheckAndBuild(): Promise<void> {
    await this.success('install', 'installed'); await this.success('check', 'checked'); await this.success('build', 'built');
  }
  async expectReadableSteps(steps: string[]): Promise<void> {
    const paths = Object.keys(await this.driver.generatedFiles()).filter(path => path.includes('/acceptance/'));
    expect(paths).toHaveLength(1);
    const source = await this.driver.text(paths[0]!); for (const step of steps) expect(source).toContain(step);
    expect(await this.driver.text(this.driver.driverPath)).toContain('Not implemented');
  }
  implementDocumentedBasket(): Promise<void> { return this.driver.implementBasket(); }
  test(): Promise<void> { return this.driver.command('test'); }
  private executed(title: string, state: 'passed' | 'failed') {
    const stages = this.driver.report.stages, executions = stages.filter(stage => stage.name === 'execution');
    expect(executions, this.driver.result.stdout + this.driver.result.stderr).toHaveLength(1);
    expect(stages.filter(stage => stage.name !== 'execution').every(stage => stage.status === 'passed')).toBe(true);
    const execution = executions[0]!; expect(execution.status).toBe(state); expect(execution.errors).toEqual([]);
    expect(execution.tests).toHaveLength(1);
    const test = execution.tests![0]!; expect(test.id).toEqual(expect.any(String)); expect(test.id.length).toBeGreaterThan(0);
    expect(test.file).toContain('/acceptance/'); expect(test.title).toBe(title); expect(test.state).toBe(state);
    expect(test.errors).toEqual(expect.any(Array)); expect(test.errors.every(error => typeof error === 'string')).toBe(true);
    expect(execution.native?.exitCode).toBe(state === 'passed' ? 0 : 1); expect(execution.native?.signal).toBeNull();
    let selector: string;
    if (this.driver.target === 'python') {
      expect(execution.collected).toHaveLength(1);
      expect(execution.collected![0]).toMatchObject({ id: test.id, file: test.file, title, nodeid: test.nodeid });
      expect(test.nodeid).toEqual(expect.any(String)); expect(test.nodeid).toContain(test.file + '::');
      expect(test.phases).toHaveLength(3);
      for (const when of ['setup', 'call', 'teardown']) {
        const phases = test.phases!.filter(phase => phase.when === when); expect(phases).toHaveLength(1);
        expect(phases[0]).toMatchObject({ nodeid: test.nodeid, file: test.file, outcome: when === 'call' ? state : 'passed', xfail: false });
      }
      selector = test.nodeid!;
    } else {
      expect(execution.native?.closed).toBe(true); expect(execution.native?.error).toBeUndefined();
      const args = execution.native!.args, selections = args.flatMap((arg, index) => arg === '--select-method' ? [args[index + 1]] : []);
      expect(selections).toHaveLength(1); expect(selections[0]).toMatch(/^[^#]+#[^()]+\(\)$/);
      expect(args).toContain('org.junit.platform.console.ConsoleLauncher'); selector = selections[0]!;
    }
    const current = { id: test.id, file: test.file, title: test.title, selector };
    if (this.selected) expect(current).toEqual(this.selected); else this.selected = current;
    return test;
  }
  expectPassed(title: string): void {
    expect(this.driver.result.code, this.driver.result.stdout + this.driver.result.stderr).toBe(0);
    expect(this.driver.report.status).toBe('tested'); expect(this.driver.report.problems).toEqual([]);
    expect(this.executed(title, 'passed').errors).toEqual([]);
  }
  expectQuantityFailure(title: string, expected: number, actual: number): void {
    expect(this.driver.result.code).toBe(1); expect(this.driver.report.status).toBe('failed');
    expect(this.selected, 'First establish the actual passing case before faulting its application.').toBeDefined();
    const test = this.executed(title, 'failed'); expect(test.errors.length).toBeGreaterThan(0);
    if (this.driver.target === 'python') {
      expect(this.driver.report.problems).toEqual([]);
      expect(test.errors.some(error => error.includes('AssertionError') && error.includes('Expected ' + expected + ', actual ' + actual))).toBe(true);
    } else {
      expect(this.driver.report.problems.map(problem => problem.code)).toEqual(['generated-tests-not-executed']);
      expect(test.errors.some(error => error.includes('AssertionFailedError')
        && error.includes('expected: <' + expected.toFixed(1) + '> but was: <' + actual.toFixed(1) + '>'))).toBe(true);
    }
  }
  async rememberGeneratedTests(): Promise<void> {
    this.before = await this.driver.generatedFiles();
    expect(Object.keys(this.before).some(path => path.includes('/acceptance/'))).toBe(true);
    expect(Object.keys(this.before).some(path => path.includes('/dsl/'))).toBe(true);
  }
  async removeActualBasketIncrement(): Promise<void> { const changed = await this.driver.removeIncrement(); expect(changed.actual).toBe(changed.expected); }
  restoreDocumentedBasket(): Promise<void> { return this.driver.restoreBasket(); }
  async expectGeneratedTestsUnchanged(): Promise<void> { expect(Object.keys(this.before).length).toBeGreaterThan(0); expect(await this.driver.generatedFiles()).toEqual(this.before); }
}
