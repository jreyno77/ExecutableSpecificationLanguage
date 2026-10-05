import { expect } from 'vitest';
import { KotlinCliDriver } from '../driver/kotlin-cli.js';

export class KotlinCli {
  private rememberedProject?: Record<string,string>;
  private constructor(private readonly driver: KotlinCliDriver) {}
  static prepare = KotlinCliDriver.prepare;
  static async create(): Promise<KotlinCli> {
    const driver = new KotlinCliDriver(); await driver.initialize(false); return new KotlinCli(driver);
  }
  source(text: string): Promise<void> { return this.driver.write('spec/main.expec', text); }
  starter(): Promise<void> { return this.driver.starter(); }
  initialize(): Promise<void> { return this.driver.command('init', ['--root', '../project', '--target', 'kotlin', '--java-home', this.driver.javaHome, '--yes']); }
  acceptance(): Promise<void> { return this.driver.acceptance(); }
  implement(body: string): Promise<void> { return this.driver.implement(body); }
  addFailingNeighbor(): Promise<void> { return this.driver.neighbor(); }
  forgetExampleArtifact(title: string): Promise<void> { return this.driver.forgetExampleArtifact(title); }
  disableExample(): Promise<void> { return this.driver.disableExample(); }
  test(): Promise<void> { return this.driver.command('test'); }
  expectTests(expected: { title: string; state: string }[]): void {
    const execution = this.driver.report.stages.find((stage: any) => stage.name === 'execution');
    expect(execution, JSON.stringify(this.driver.report)).toBeDefined();
    expect(execution.tests.map((test: any) => ({title:test.title,state:test.state}))).toEqual(expected);
  }
  expectFailure(text: string): void {
    const execution = this.driver.report.stages.find((stage: any) => stage.name === 'execution');
    expect(execution.tests.flatMap((test: any) => test.errors).join('\n')).toContain(text);
  }
  expectProblem(code: string): void { expect(this.driver.report.problems).toEqual(expect.arrayContaining([expect.objectContaining({ code })])); }
  expectNoExecutedTests(): void {
    expect(this.driver.report.stages.filter((stage: any) => stage.name === 'execution')).toEqual([]);
    expect(this.driver.nativeCommands.filter(command => command.includes('ConsoleLauncher'))).toEqual([]);
  }
  install(): Promise<void> { return this.driver.command('install'); }
  build(): Promise<void> { return this.driver.command('build'); }
  expectExit(code: number): void { expect(this.driver.result, this.driver.result.stdout + this.driver.result.stderr).toMatchObject({ code }); }
  expectStage(name: string, status: string): void {
    expect(this.driver.report.stages).toEqual(expect.arrayContaining([expect.objectContaining({ name, status })]));
  }
  async expectInitialized(): Promise<void> {
    const manifest = JSON.parse(await this.driver.sourceText('expec.json'));
    expect(manifest.project).toEqual({ root: '../project' });
    expect(manifest.outputs).toContainEqual({ id: 'kotlin', options: { directory: 'src/main/kotlin', package: 'generated' } });
    expect(manifest.packages).toContainEqual(expect.objectContaining({ name: 'maven:org.jetbrains.kotlin:kotlin-gradle-plugin', version: '2.4.10', phases: ['build'] }));
    expect(JSON.parse(await this.driver.text('expec.kotlin.json')).javaHome).toBe(this.driver.javaHome);
  }
  async rememberProjectBytes(): Promise<void> { this.rememberedProject = await this.driver.capture(['native-processes.jsonl']); }
  async expectProjectBytesUnchanged(): Promise<void> { expect(await this.driver.capture(['native-processes.jsonl'])).toEqual(this.rememberedProject); }
  expectNoGradleLaunch(): void { expect(this.driver.nativeCommands.filter(command => command.includes('GradleWrapperMain'))).toEqual([]); }
  async expectNoNativeBuildOrTests(): Promise<void> {
    expect(this.driver.nativeCommands).toEqual([]);
    for (const path of ['build', '.gradle', '.expec/kotlin/classpath.json', 'src/test/kotlin']) expect(await this.driver.absent(path), path).toBe(true);
  }
  async expectInstalledPackage(name: string, version: string): Promise<void> {
    expect(this.driver.nativeCommands.some(command => command.includes('GradleWrapperMain'))).toBe(true);
    const stage = this.driver.report.stages.find((item: any) => item.name === 'installation');
    expect(stage.packages.value).toContainEqual({ name, version });
    expect((await this.driver.nativeReport()).packages).toContainEqual(expect.objectContaining({ name, version }));
  }
  async expectContract(file: string, declaration: string): Promise<void> { expect(await this.driver.text('src/main/kotlin/generated/' + file)).toContain(declaration); }
  async rememberBuildInputs(): Promise<void> {
    this.driver.before = await this.driver.capture(['.gradle', '.kotlin', 'build']);
  }
  async expectNativeBuildInputsUnchanged(): Promise<void> {
    const current = await this.driver.capture(['.gradle', '.kotlin', 'build']);
    for (const [path, bytes] of Object.entries(this.driver.before)) if (/\.gradle(?:\.kts)?$|gradle\.lockfile$|classpath\.json$|expec\.kotlin\.json$/.test(path)) expect(current[path], path).toBe(bytes);
  }
  dispose(): Promise<void> { return this.driver.dispose(); }
}
