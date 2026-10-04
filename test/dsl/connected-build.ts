import { expect } from 'vitest';
import { ConnectedBuildDriver } from '../driver/connected-build.js';

export class ConnectedBuild {
  private constructor(private readonly driver: ConnectedBuildDriver) {}
  static async create(options: { connected?: boolean } = {}): Promise<ConnectedBuild> {
    const driver = new ConnectedBuildDriver(); await driver.initialize(options.connected ?? true); return new ConnectedBuild(driver);
  }
  static prepare = ConnectedBuildDriver.prepare;
  source(name: string, text: string): Promise<void> { return this.driver.write('spec/' + name, text); }
  file(name: string, text: string): Promise<void> { return this.driver.write('project/' + name, text); }
  async entries(entries: string[]): Promise<void> { this.driver.manifest.build = { entries }; await this.driver.saveManifest(); }
  async rememberAllBytes(): Promise<void> { this.driver.before = await this.driver.capture(); }
  run(args: string[]): Promise<void> { return this.driver.run(args); }
  expectExit(code: number): void { expect(this.driver.result, this.driver.result.stderr).toMatchObject({ code }); }
  expectStatus(status: string): void { expect(this.driver.report).toMatchObject({ format: 1, status }); }
  async expectAllBytesUnchanged(): Promise<void> { expect(await this.driver.capture()).toEqual(this.driver.before); }
  expectNoNativeExecution(): void {
    expect(this.driver.report.stages.every((stage: any) => stage.native === undefined && stage.execution === undefined)).toBe(true);
  }
  expectNoInitializationPrompt(): void { expect(this.driver.result.stdout + this.driver.result.stderr).not.toContain('Initialize'); }
  expectMessageContains(text: string): void { expect(this.driver.result.stdout + this.driver.result.stderr).toContain(text); }
  async expectLocatedProblem(code: string, file: string, text: string): Promise<void> {
    const source = await this.driver.sourceText(file);
    const finding = this.driver.report.problems.find((problem: any) => problem.code === code && problem.at.kind === 'source'
      && problem.at.range.sourceId.endsWith('/' + file) && Array.from(source).slice(problem.at.range.start.offset, problem.at.range.end.offset).join('') === text);
    expect(finding, JSON.stringify(this.driver.report)).toBeDefined();
  }
  expectSyntaxIn(file: string): void {
    expect(this.driver.report.syntax.some((finding: any) => finding.primaryRange.sourceId.endsWith('/' + file))).toBe(true);
  }
  dispose(): Promise<void> { return this.driver.dispose(); }
}
