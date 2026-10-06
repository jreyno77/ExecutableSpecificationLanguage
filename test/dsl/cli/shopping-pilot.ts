import { expect, onTestFinished } from 'vitest';
import { ShoppingPilotDriver } from '../../driver/cli/shopping-pilot.js';

export class ShoppingPilot {
  private constructor(private readonly driver: ShoppingPilotDriver) {}
  static async create(title: string, expectedQuantity: number): Promise<ShoppingPilot> {
    const driver = new ShoppingPilotDriver(); onTestFinished(() => driver.dispose());
    await driver.author(title, expectedQuantity); return new ShoppingPilot(driver);
  }
  async initializeAndInstall(): Promise<void> {
    await this.driver.cli(['init', '--root', './game', '--target', 'typescript', '--yes']); this.expectExit(0);
    await this.driver.cli(['install']); this.expectExit(0); await this.driver.configureNativeTests();
  }
  async build(): Promise<void> { await this.driver.cli(['build']); this.expectExit(0); }
  connectHttpFixture(): Promise<void> { return this.driver.connectHttpFixture(); }
  rememberGeneratedTests(): Promise<void> { return this.driver.rememberGenerated(); }
  runScenarios(): Promise<void> { return this.driver.runScenarios(); }
  repairActualAddEndpoint(): Promise<void> { return this.driver.repairAdd(); }
  expectExit(code: number): void { expect(this.driver.result, JSON.stringify(this.driver.report) + this.driver.result.stderr).toMatchObject({ code }); }
  expectQuantityDifference(expected: number, actual: number): void {
    this.expectExit(1);
    expect(this.driver.report).toMatchObject({ stages: expect.arrayContaining([expect.objectContaining({ name: 'execution', status: 'failed',
      tests: expect.arrayContaining([expect.objectContaining({ state: 'failed', errors: expect.arrayContaining([expect.objectContaining({ expected: String(expected), actual: String(actual) })]) })]),
    })]) });
  }
  expectScenarioPassed(title: string): void {
    this.expectExit(0);
    expect(this.driver.report).toMatchObject({ stages: expect.arrayContaining([expect.objectContaining({ name: 'execution', status: 'passed',
      native: expect.objectContaining({ exitCode: 0 }), tests: expect.arrayContaining([expect.objectContaining({ title, state: 'passed' })]),
    })]) });
  }
  async expectActualQuantity(title: string, actual: number): Promise<void> {
    expect(await this.driver.events()).toContainEqual(expect.objectContaining({ event: 'observed', title, actual }));
  }
  async expectAllServersClosed(): Promise<void> {
    const events = await this.driver.events(), started = events.filter(item => item.event === 'started');
    expect(started).toHaveLength(1);
    for (const server of started) expect(events.filter(item => item.id === server.id && item.event === 'closed')).toEqual([expect.objectContaining({ listening: false })]);
  }
  async expectGeneratedTestsUnchanged(): Promise<void> { const files = await this.driver.generatedBytes(); expect(files.after).toEqual(files.before); }
}
