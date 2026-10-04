import { expect } from 'vitest';
import { readFile, stat } from 'node:fs/promises';
import { ConnectedExecutionDriver } from '../driver/connected-execution.js';
export class ConnectedExecution {
  private readonly driver = new ConnectedExecutionDriver();
  static prepare = ConnectedExecutionDriver.prepare;
  prepareShopping(): Promise<void> { return this.driver.prepareShopping(); }
  freshShopping(): Promise<void> { return this.driver.restoreShopping(); }
  run(): Promise<void> { return this.driver.run(['test', '--config', 'spec/expec.json', '--json'], '', undefined, 90_000); }
  expectExit(code: number): void { expect(this.driver.result, this.driver.result.stdout + this.driver.result.stderr).toMatchObject({ code }); }
  expectNativePassed(title: string): void {
    const stage = this.driver.report.stages.find((stage: any) => stage.name === 'execution');
    expect(stage).toMatchObject({ status: 'passed', native: { exitCode: 0 }, tests: expect.arrayContaining([expect.objectContaining({ title, state: 'passed' })]) });
  }
  async expectActualQuantity(title: string, actual: number): Promise<void> { expect(await this.driver.events()).toContainEqual(expect.objectContaining({ event: 'observed', title, actual })); }
  async expectServerClosed(): Promise<void> { expect(await this.driver.events()).toContainEqual(expect.objectContaining({ event: 'closed', listening: false })); }
  configureShop(value: object): Promise<void> { return this.driver.options(value); }
  configureNative(value: object): Promise<void> { return this.driver.write('project/vitest.config.ts', 'import { defineConfig } from "vitest/config"; export default defineConfig(' + JSON.stringify({ test: value }) + ');'); }
  file(path: string, text: string): Promise<void> { return this.driver.write('project/' + path, text); }
  edit(path: string, from: string, to: string): Promise<void> { return this.driver.edit('project/' + path, from, to); }
  editSource(from: string, to: string): Promise<void> { return this.driver.edit('spec/main.expec', from, to); }
  runnerUnavailable(): Promise<void> { return this.driver.runnerUnavailable(); }
  expectProblem(code: string): void { expect(this.driver.report.problems).toContainEqual(expect.objectContaining({ code })); }
  expectNativeState(title: string, state: string): void {
    const stage = this.driver.report.stages.find((stage: any) => stage.name === 'execution');
    expect(stage.tests).toContainEqual(expect.objectContaining({ title, state }));
  }
  expectNativeFailure(expected: number, actual: number): void {
    const tests = this.driver.report.stages.find((stage: any) => stage.name === 'execution').tests;
    expect(tests.flatMap((test: any) => test.errors)).toContainEqual(expect.objectContaining({ expected: String(expected), actual: String(actual) }));
  }
  expectNativeMessage(text: string): void { expect(JSON.stringify(this.driver.report.stages)).toContain(text); }
  expectStderr(text: string): void { expect(this.driver.result.stderr).toContain(text); }
  expectSingleJson(): void { expect(JSON.parse(this.driver.result.stdout)).toMatchObject({ format: 1, command: 'test' }); }
  async expectGeneratedUnchanged(): Promise<void> { expect(await this.driver.unchanged(['project/test/acceptance/shopping.test.ts', 'project/test/dsl/shopping.ts'])).toBe(true); }
  async expectNoFile(path: string): Promise<void> { await expect(stat(this.driver.path('project/' + path))).rejects.toMatchObject({ code: 'ENOENT' }); }
  async expectNoRequests(): Promise<void> { await this.expectNoFile('shop-events.jsonl'); }
  expectNoNativeAttempt(): void { expect(this.driver.report.stages).not.toContainEqual(expect.objectContaining({ name: 'execution' })); }
  async nativeText(path: string): Promise<string> { return readFile(this.driver.path('project/' + path), 'utf8'); }
  dispose(): Promise<void> { return this.driver.dispose(); }
}
