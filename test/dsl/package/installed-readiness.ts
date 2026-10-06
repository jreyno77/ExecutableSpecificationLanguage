import { expect, onTestFinished } from 'vitest';
import { InstalledReadinessDriver } from '../../driver/package/installed-readiness.js';

export class InstalledReadiness {
  private constructor(private readonly driver: InstalledReadinessDriver) {}
  static async fromSource(source: string): Promise<InstalledReadiness> {
    const driver = new InstalledReadinessDriver(); onTestFinished(() => driver.package.dispose());
    await driver.prepare(source); return new InstalledReadiness(driver);
  }
  async initializeAndInstall(): Promise<void> {
    await this.driver.command(['init', '--root', './game', '--target', 'typescript', '--yes']); this.expectExit(0);
    await this.driver.command(['install']); this.expectExit(0);
    await this.driver.observeRunnerStart();
  }
  async build(): Promise<void> { await this.driver.command(['build']); this.expectExit(0); }
  async runTests(): Promise<void> { await this.driver.command(['test']); }
  expectExit(code: number): void { expect(this.driver.result.code, JSON.stringify({ status: this.driver.report.status, problems: this.driver.report.problems }) + this.driver.result.stderr).toBe(code); }
  async expectCollectedAndPassed(titles: string[]): Promise<void> {
    this.expectExit(0);
    const stage = this.driver.report.stages.find(item => item.name === 'execution');
    expect(stage?.collected?.map(item => item.title).sort()).toEqual([...titles].sort());
    expect(stage?.tests?.map(item => ({ title: item.title, state: item.state }))).toEqual(titles.map(title => ({ title, state: 'passed' })));
    expect(await this.driver.runnerStarted()).toBe(true);
    expect(await this.driver.runnerForks()).toHaveLength(1);
  }
  withdrawConfirmedCase(title: string): Promise<void> { return this.driver.withdraw(title); }
  rememberProjectFiles(): Promise<void> { return this.driver.remember(); }
  expectProblem(code: string): void { expect(this.driver.report.problems).toContainEqual(expect.objectContaining({ code })); }
  async expectNoNativeExecution(): Promise<void> {
    expect(this.driver.report.stages).not.toContainEqual(expect.objectContaining({ name: 'execution' }));
    expect(await this.driver.runnerStarted()).toBe(false);
    expect(await this.driver.runnerForks()).toEqual([]);
  }
  async expectProjectFilesUnchanged(): Promise<void> { expect(await this.driver.unchanged()).toBe(true); }
}
