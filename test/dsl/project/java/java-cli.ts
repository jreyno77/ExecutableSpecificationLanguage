import { promises as fs } from 'node:fs';
import { expect } from 'vitest';
import { JavaCliDriver } from '../../../driver/project/java/java-cli.js';

export class JavaCommands {
  private static readonly examples: JavaCommands[] = [];
  private constructor(private readonly driver: JavaCliDriver) {}
  static prepare = JavaCliDriver.prepare;
  static async create(): Promise<JavaCommands> {
    const p = new JavaCommands(new JavaCliDriver()); this.examples.push(p); await p.driver.initializeJava(); return p;
  }
  static async dispose(): Promise<void> { for (const p of this.examples.splice(0)) await p.driver.dispose(); }
  source(text: string): Promise<void> { return this.driver.source(text); }
  localSource(file: string, text: string): Promise<void> { return this.driver.write('spec/' + file, text); }
  sourceLibrary(name: string, text: string): Promise<void> { return this.driver.sourceLibrary(name, text); }
  initialize(javaHome?: string): Promise<void> { return this.driver.init(javaHome); }
  install(): Promise<void> { return this.driver.cli('install'); }
  build(): Promise<void> { return this.driver.cli('build'); }
  test(): Promise<void> { return this.driver.cli('test'); }
  catalog(): Promise<void> { return this.driver.localCatalog(); }
  requireCatalog(version?: string): Promise<void> { return this.driver.requireCatalog(version); }
  implementBasket(copies: number): Promise<void> { return this.driver.implementBasket(copies); }
  removeGeneratedCall(call: string): Promise<void> { return this.driver.removeGeneratedCall(call); }
  testObservingNativeProcesses(): Promise<void> { return this.driver.testObservingNativeProcesses(); }
  expectNoNativeExecution(): void {
    expect(this.driver.report.stages.some((stage: { name: string }) => stage.name === 'execution' || stage.name.startsWith('compilation:'))).toBe(false);
    expect(this.driver.nativeCalls.some(call => call.includes('ExpecJava'))).toBe(true);
    expect(this.driver.nativeCalls.some(call => /javac(?:\.exe)?$/.test(call[0]!) || call.includes('org.junit.platform.console.ConsoleLauncher'))).toBe(false);
  }
  expectStatus(status: string, code = 0): void { expect(this.driver.report.status, JSON.stringify(this.driver.report)).toBe(status); expect(this.driver.result.code, this.driver.result.stderr).toBe(code); }
  expectProblem(code: string): void { expect(this.driver.report.problems.map((problem: { code: string }) => problem.code), JSON.stringify(this.driver.report)).toContain(code); }
  async expectNoProject(): Promise<void> { await expect(fs.stat(this.driver.path('project'))).rejects.toMatchObject({ code: 'ENOENT' }); }
  async expectStarterOnly(): Promise<void> {
    for (const file of ['build.gradle', 'settings.gradle', 'gradlew', 'gradlew.bat', 'expec.java.json']) expect((await fs.readFile(this.driver.path('project/' + file))).length).toBeGreaterThan(0);
    for (const file of ['gradle.lockfile', '.expec/java/classpath.json', 'src/test/java/generated']) await expect(fs.stat(this.driver.path('project/' + file))).rejects.toMatchObject({ code: 'ENOENT' });
    const manifest = JSON.parse(await fs.readFile(this.driver.path('spec/expec.json'), 'utf8'));
    expect(manifest.outputs.map((output: { id: string }) => output.id)).toEqual(['java', 'java-acceptance']);
    for (const name of ['maven:org.junit.jupiter:junit-jupiter', 'maven:org.junit.platform:junit-platform-launcher', 'maven:org.junit.platform:junit-platform-console', 'maven:org.junit.platform:junit-platform-reporting'])
      expect(manifest.packages).toContainEqual(expect.objectContaining({ name, version: '6.1.3', phases: ['test'] }));
  }
  async rememberLock(): Promise<void> { this.driver.lock = await fs.readFile(this.driver.path('project/gradle.lockfile')); }
  async expectSameNativeBuild(): Promise<void> {
    expect(await fs.readFile(this.driver.path('project/gradle.lockfile'))).toEqual(this.driver.lock);
    expect(await fs.readFile(this.driver.path('project/build.gradle'), 'utf8')).toBe(this.driver.buildText);
  }
  async expectCatalogInstalled(): Promise<void> {
    const stage = this.driver.report.stages.find((stage: { name: string }) => stage.name === 'installation');
    expect(stage.packages.packages).toContainEqual({ name: 'maven:example.books:catalog', requested: '1.0.0', selected: '1.0.0', installed: '1.0.0' });
    const report = JSON.parse(await fs.readFile(this.driver.path('project/.expec/java/classpath.json'), 'utf8'));
    expect(report.packages).toContainEqual(expect.objectContaining({ name: 'maven:example.books:titles', version: '1.2.0' }));
  }
  expectInstallationStopped(): void {
    this.expectStatus('installation-failed', 1);
    const stage = this.driver.report.stages.find((stage: { name: string }) => stage.name === 'installation');
    expect(stage.packages.value).toBeUndefined(); expect(stage.packages.effects.length).toBeGreaterThan(0);
    expect(stage.packages.packages.find((item: { name: string }) => item.name === 'maven:example.books:catalog').installed).toBeUndefined();
  }
  expectNativeTest(passed: boolean, quantity: number): void {
    this.expectStatus(passed ? 'tested' : 'failed', passed ? 0 : 1);
    const execution = this.driver.report.stages.find((stage: { name: string }) => stage.name === 'execution');
    expect(execution.tests).toHaveLength(1); expect(execution.tests[0].state).toBe(passed ? 'passed' : 'failed');
    expect(execution.native.command).toMatch(/java(?:\.exe)?$/); expect(execution.native.exitCode).toBe(passed ? 0 : 1);
    expect(this.driver.result.stderr).toContain('BASKET:Dune:' + quantity + '.0');
    if (!passed) expect(JSON.stringify(execution.tests[0].errors)).toMatch(/expected.*1\.0.*(?:but was|actual).*2\.0/s);
  }
  expectExecutedTitles(titles: string[]): void {
    this.expectStatus('tested'); const execution = this.driver.report.stages.find((stage: { name: string }) => stage.name === 'execution');
    expect(execution.tests.map((test: { title: string }) => test.title)).toEqual(titles);
    expect(execution.tests.every((test: { state: string }) => test.state === 'passed')).toBe(true);
  }
}
