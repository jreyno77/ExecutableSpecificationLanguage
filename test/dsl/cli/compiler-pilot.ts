import { expect, onTestFinished } from 'vitest';
import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CompilerPilotDriver } from '../../driver/cli/compiler-pilot.js';

export class CompilerPilot {
  private savedImplementation: Record<string, string> = {};
  private original?: CompilerPilotDriver;
  private constructor(private driver: CompilerPilotDriver) {}
  static async fromExamples(examples: string): Promise<CompilerPilot> {
    const driver = new CompilerPilotDriver(); onTestFinished(() => driver.dispose(), 30_000);
    await driver.author(`opaque type CompilationInput
opaque type Compilation
concept Compiler {
  public compile
  capability compile(input: CompilationInput) returns Compilation
}
examples {
  action readSource(source: Text) returns Nothing
  observation problemFound(code: Text, text: Text, line: Number, column: Number) returns Boolean
  observation acceptedWithoutProblems() returns Boolean
  check expectProblem(code: Text, text: Text, line: Number, column: Number) {
    let found = problemFound(code, text, line, column)
    assert found == true
  }
  check expectAccepted() {
    let accepted = acceptedWithoutProblems()
    assert accepted == true
  }
${examples}
}`);
    return new CompilerPilot(driver);
  }
  async initializeAndInstall(): Promise<void> {
    await this.driver.cli(['init', '--root', './project', '--target', 'typescript', '--yes']); this.expectExit(0);
    await this.driver.configureTests(); await this.driver.cli(['install']); this.expectExit(0);
  }
  async build(): Promise<void> { await this.driver.cli(['build']); this.expectExit(0); }
  async expectCompilerContract(): Promise<void> {
    expect(await this.driver.text('project/reference/Compiler.md')).toContain('compile(input: CompilationInput) returns Compilation');
  }
  useCompilerDriver(observation: 'suppress-real-problems' | 'actual-packaged-compiler'): Promise<void> {
    return this.driver.useDriver(observation === 'suppress-real-problems');
  }
  runGeneratedTests(): Promise<void> { return this.driver.runScenarios(); }
  private expectExit(code: number): void {
    const report = this.driver.report as { status: string; problems: unknown[]; stages: { name: string; status: string }[] };
    expect(this.driver.result.code, JSON.stringify({ status: report.status, problems: report.problems,
      stages: report.stages.map(({ name, status }) => ({ name, status })) }) + this.driver.result.stderr).toBe(code);
  }
  expectMissingDiagnosticFails(): void {
    this.expectExit(1);
    expect(this.driver.report, JSON.stringify(this.driver.report) + this.driver.result.stderr).toMatchObject({ status: 'failed', stages: expect.arrayContaining([expect.objectContaining({ name: 'execution', status: 'failed',
      tests: expect.arrayContaining([expect.objectContaining({ state: 'failed', errors: expect.arrayContaining([expect.objectContaining({ actual: 'false', expected: 'true' })]) })]),
    })]) });
  }
  expectPassed(titles: string[]): void {
    this.expectExit(0);
    const execution = (this.driver.report as { stages: { name: string; tests?: { title: string; state: string }[] }[] }).stages.find(stage => stage.name === 'execution');
    expect(execution?.tests?.map(test => ({ title: test.title, state: test.state }))).toEqual(titles.map(title => ({ title, state: 'passed' })));
  }
  async expectActualDiagnostic(code: string, text: string, line: number, column: number): Promise<void> {
    const observations = await this.driver.observations();
    expect(observations.some(item => item.diagnostics.some(diagnostic => diagnostic.code === code && diagnostic.text === text
      && diagnostic.line === line && diagnostic.column === column))).toBe(true);
  }
  async expectAcceptedSource(source: string): Promise<void> {
    expect(await this.driver.observations()).toContainEqual(expect.objectContaining({ source, accepted: true, syntax: [], diagnostics: [], deferred: [] }));
  }
  async rememberImplementation(): Promise<void> { this.savedImplementation = await this.driver.implementationBytes(); }
  async expectImplementationKept(): Promise<void> {
    expect(Object.keys(this.savedImplementation)).toContain('compiler/compiler.js');
    expect(Object.keys(this.savedImplementation)).toContain('language/langium/reader.js');
    expect(await this.driver.implementationBytes()).toEqual(this.savedImplementation);
  }
  async addAcceptedSource(source: string): Promise<void> {
    const text = this.driver.source;
    this.driver.source = text.slice(0, text.lastIndexOf('}')) + `  scenario "matching capability is accepted" {
    when readSource(${JSON.stringify(source)})
    then expectAccepted()
  }
}`;
    await this.driver.file('main.expec', this.driver.source);
  }
  async expectExistingCompilerRegressions(): Promise<void> {
    const result = await this.driver.independentRegressions(); expect(result.success).toBe(true); expect(result.numPassedTests).toBeGreaterThan(0);
  }
  async retainBootstrap(): Promise<void> { await this.driver.rememberBootstrapInputs(); }
  async breakGeneratedDsl(): Promise<void> { await this.driver.file('project/test/dsl/compiler.ts', 'export class {'); }
  async expectCandidateSyntaxFailure(): Promise<void> {
    await this.driver.run([this.driver.path('project/node_modules/typescript/bin/tsc'), '--noEmit', '-p', 'tsconfig.json'], 'project');
    expect(this.driver.result.code).not.toBe(0);
    expect(this.driver.result.stdout).toContain('test/dsl/compiler.ts'); expect(this.driver.result.stdout).toContain('error TS');
  }
  async bootstrapFreshCopy(): Promise<void> {
    this.original = this.driver; const fresh = new CompilerPilotDriver(); onTestFinished(() => fresh.dispose(), 30_000);
    await fresh.restoreInputs(this.original.bootstrapInputs); this.driver = fresh;
    for (const [path, text] of Object.entries(this.original.bootstrapInputs)) expect(await fresh.text(fresh.bootstrapPath(path)), 'Trusted bootstrap input: ' + path).toBe(text);
    await fresh.cli(['install']); this.expectExit(0);
  }
  async restoreTrustedDriver(): Promise<void> {
    const text = this.original!.bootstrapInputs['project/test/driver/compiler.ts']!;
    expect(await this.driver.text('project/test/driver/compiler.ts')).toContain('Not implemented:');
    expect(await this.driver.text('bootstrap/compiler.ts')).toBe(text);
    await this.driver.file('project/test/driver/compiler.ts', text);
    expect(await this.driver.text('project/test/driver/compiler.ts')).toBe(text);
  }
  async expectTrustedBootstrapUsed(): Promise<void> {
    expect(this.original).toBeDefined(); expect(this.driver.root).not.toBe(this.original!.root);
    expect(this.driver.artifactDigest).toMatch(/^[a-f0-9]{64}$/); expect(this.driver.artifactDigest).toBe(this.original!.artifactDigest);
    expect(this.driver.version).toBe(this.original!.version);
    expect(await this.original!.text('project/test/dsl/compiler.ts')).toBe('export class {');
    for (const item of await this.driver.observations()) {
      const actual = await realpath(fileURLToPath(item.packageUrl));
      expect(actual).toBe(await realpath(join(this.driver.root, 'project/node_modules/executable-specification-language/dist/index.js')));
      expect(actual).not.toBe(await realpath(join(this.original!.root, 'project/node_modules/executable-specification-language/dist/index.js')));
    }
    expect(await this.driver.implementationBytes()).toEqual(this.savedImplementation);
  }
}
