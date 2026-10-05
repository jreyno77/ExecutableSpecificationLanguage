import { expect } from 'vitest';
import { PythonFixtureDriver } from '../driver/python-fixture.js';

export class PythonFixtures {
  private static readonly examples: PythonFixtures[] = [];
  private constructor(private readonly driver: PythonFixtureDriver) {}
  static async shopping(): Promise<PythonFixtures> {
    const value = new PythonFixtures(new PythonFixtureDriver()); this.examples.push(value);
    await value.driver.initializeAcceptance(); value.driver.authorShopping('Dune', 1); return value;
  }
  static async dispose(): Promise<void> { for (const value of this.examples.splice(0)) await value.driver.dispose(); }
  useResourceFixture(options?: Parameters<PythonFixtureDriver['useFixture']>[0]): Promise<void> { return this.driver.useFixture(options); }
  shadowDsl(): Promise<void> { return this.driver.shadowDsl(); }
  replaceFixtureDecorator(): Promise<void> { return this.driver.replaceFixtureDecorator(); }
  returnDerivedDslWithEmptyQuantityCheck(): Promise<void> { return this.driver.returnDerivedDslWithEmptyQuantityCheck(); }
  replaceQuantityCheckOnReturnedInstance(): Promise<void> { return this.driver.replaceQuantityCheckOnReturnedInstance(); }
  replaceQuantityCheckOnGeneratedClassDuringSetup(): Promise<void> { return this.driver.replaceQuantityCheckOnGeneratedClassDuringSetup(); }
  async generateTests(): Promise<void> {
    await this.driver.generate(); expect(this.driver.written.problems, JSON.stringify(this.driver.written.problems)).toEqual([]);
    expect(this.driver.written.receipt?.status).toBe('applied');
  }
  async expectGenerationRefused(code: string): Promise<void> {
    await this.driver.generate(); expect(this.driver.written.receipt !== undefined).toBe(false);
    expect(this.driver.written.problems.map(problem => problem.code), JSON.stringify(this.driver.written)).toContain(code);
    expect(await this.driver.acceptanceFiles()).toEqual([]);
  }
  runTests(): Promise<void> { return this.driver.runFixture(); }
  expectPassed(): void {
    expect(this.driver.runtime.code, this.driver.runtime.text).toBe(0);
    expect(this.driver.reports.map(report => [report.phase, report.outcome])).toEqual([['setup', 'passed'], ['call', 'passed'], ['teardown', 'passed']]);
  }
  expectFixtureAdmissionFailed(message: string): void {
    expect(this.driver.runtime.code, this.driver.runtime.text).toBe(1);
    expect(this.driver.reports.map(report => [report.phase, report.outcome])).toEqual([['setup', 'passed'], ['call', 'failed'], ['teardown', 'passed']]);
    expect(this.driver.reports.find(report => report.phase === 'call')?.detail).toContain(message);
  }
  expectFailedDuring(phases: string[], callPassed: boolean): void {
    expect(this.driver.runtime.code, this.driver.runtime.text).not.toBe(0);
    expect(this.driver.reports.filter(report => report.outcome === 'failed').map(report => report.phase)).toEqual(phases);
    expect(this.driver.reports.some(report => report.phase === 'call' && report.outcome === 'passed')).toBe(callPassed);
    if (phases.includes('setup')) expect(this.driver.reports.some(report => report.phase === 'call')).toBe(false);
    for (const phase of phases) expect(this.driver.reports.find(report => report.phase === phase)?.detail).toContain(phase === 'setup' ? 'setup failed' : 'cleanup failed');
  }
  expectSocketClosedAndRebindable(): Promise<void> { return this.driver.closedSocket(); }
  async expectFixtureUnchanged(): Promise<void> { expect(await this.driver.retainedFixture()).toBe(true); }
  expectFixtureName(name: string): void { expect(this.driver.scenario).toContain('(' + name + ': Shopping)'); expect(this.driver.scenario).toContain(name + '.addBook("Dune")'); }
}
