import { expect } from 'vitest';
import { KotlinDeliveryDriver } from '../driver/kotlin-delivery.js';

export class KotlinDelivery {
  private static readonly instances: KotlinDelivery[] = [];
  private constructor(readonly driver: KotlinDeliveryDriver) {}
  static async create(): Promise<KotlinDelivery> {
    const project = new KotlinDelivery(new KotlinDeliveryDriver()); this.instances.push(project); await project.driver.initialize(); await project.driver.configureNative(); return project;
  }
  static async newProject(): Promise<KotlinDelivery> {
    const project = new KotlinDelivery(new KotlinDeliveryDriver()); this.instances.push(project); await project.driver.initialize(); return project;
  }
  async prepareKotlin(): Promise<void> { await this.driver.prepareKotlin(); expect(this.driver.prepared.problems).toEqual([]); expect(this.driver.prepared.value?.target).toBe('kotlin'); }
  async acceptStarter(): Promise<void> { await this.driver.initializeKotlin(true); expect(this.driver.initialized.problems).toEqual([]); expect(this.driver.initialized.status).toBe('applied'); }
  async declineStarter(): Promise<void> { await this.driver.initializeKotlin(false); expect(this.driver.initialized.status).toBe('declined'); }
  expectRequiredPackages(packages: { name: string; version: string; phases: string[] }[]): void {
    expect(this.driver.prepared.value?.configuration.packages.map(({ name, version, phases }) => ({ name, version, phases }))).toEqual(packages);
  }
  async expectEmptyDestination(): Promise<void> { expect(await this.driver.capturedFiles()).toEqual(new Map()); }
  expectStarterFiles(paths: string[]): void { expect([...this.driver.files.keys()].sort()).toEqual([...paths].sort()); }
  async installDependencies(): Promise<void> { await this.driver.acquire(true); expect(this.driver.packages.problems).toEqual([]); }
  async readDependencies(): Promise<void> { await this.driver.acquire(false); expect(this.driver.packages.problems).toEqual([]); }
  async attemptInstallDependencies(): Promise<void> { await this.driver.acquire(true); }
  async attemptReadDependencies(): Promise<void> { await this.driver.acquire(false); }
  appendBuildConfiguration(text: string): Promise<void> { return this.driver.appendBuild(text); }
  expectDependencyFailure(code: string): void {
    expect(this.driver.packages.value === undefined).toBe(true);
    expect(this.driver.packages.problems.map(problem => problem.code)).toContain(code);
    expect(this.driver.packages.packages.every(item => item.installed === undefined)).toBe(true);
  }
  expectInstallationRefusedAt(path: string): void {
    expect(this.driver.packages.value === undefined).toBe(true);
    expect(this.driver.packages.problems).toContainEqual(expect.objectContaining({ code: 'unsupported-native-input',
      at: expect.objectContaining({ path: ['project', this.driver.root, ...path.split('/')] }) }));
    expect(this.driver.packages.problems.map(problem => problem.code)).toContain('installation-effects');
  }
  async expectNativeCaptureRefusedAt(path: string): Promise<void> {
    const snapshot = await this.driver.context.readSnapshot();
    expect(snapshot.complete).toBe(false);
    expect(snapshot.problems).toContainEqual(expect.objectContaining({ code: 'unsupported-native-input',
      at: expect.objectContaining({ path: ['project', this.driver.root, ...path.split('/')] }) }));
  }
  expectInstalledPackage(name: string, version: string): void {
    expect(this.driver.packages.value).toContainEqual({ name, version });
    expect(this.driver.packages.packages).toContainEqual(expect.objectContaining({ name, selected: version, installed: version }));
  }
  static async dispose(): Promise<void> { for (const project of this.instances.splice(0)) await project.driver.dispose(); }
  source(text: string): void { this.driver.source(text); }
  sourceFile(module: string, text: string): void { this.driver.sourceFile(module, text); }
  moveSource(module: string, rootNames: string[]): void { this.driver.moveSource(module, rootNames); }
  associateNative(name: string, file: string, declarations: string[]): void {
    this.driver.associate(name, file, declarations.map(name => name.endsWith('()')
      ? { kind: 'function', name: name.slice(0, -2), parameters: [] } : { kind: 'class', name }));
  }
  async expectBuildRefused(code: string): Promise<void> {
    const before = await this.driver.capturedFiles(); await this.driver.build();
    expect(this.driver.written.problems.map(problem => problem.code)).toContain(code);
    expect(this.driver.written.receipt).toBeUndefined(); expect(this.driver.files).toEqual(before);
  }
  expectDefinitionFile(name: string, file: string): void {
    const id = this.driver.subject(this.driver.current, name);
    expect(this.driver.written.artifacts).toContainEqual(expect.objectContaining({ specId: id, locator: expect.objectContaining({ value: expect.objectContaining({ file }) }) }));
  }
  external(module: string, text: string): void { this.driver.external(module, text); }
  workspace(sources: Record<string, string>): void { this.driver.workspace(sources); }
  identifier(module: string, path: string[]): string { return this.driver.identifier(module, path); }
  options(options: Record<string, unknown>): void { this.driver.options = structuredClone(options); }
  planContracts(): Promise<void> { return this.driver.plan(); }
  expectNoWritePlan(): void { expect(this.driver.planned.value === undefined).toBe(true); }
  expectProblem(code: string): void { expect(this.driver.planned.problems.map(problem => problem.code)).toContain(code); }
  expectNativeParameters(name: string, parameters: string[]): void {
    const id = this.driver.subject(this.driver.current, name);
    expect(this.driver.written.artifacts).toContainEqual(expect.objectContaining({ specId: id, locator: expect.objectContaining({
      format: 'kotlin-symbol-1', value: expect.objectContaining({ declaration: expect.arrayContaining([expect.objectContaining({ kind: 'function', parameters })]) }),
    }) }));
  }
  expectIncomingCaller(path: string): void {
    expect(this.driver.searchResult.incoming.coverage.complete, JSON.stringify(this.driver.searchResult.problems)).toBe(true);
    expect(this.driver.searchResult.incoming.uses).toContainEqual(expect.objectContaining({ at: expect.objectContaining({ value: expect.objectContaining({ file: path }) }) }));
  }
  change(text: string, renames: Readonly<Record<string, string>> = {}, retire: readonly string[] = []): void { this.driver.source(text, renames, retire); }
  implement(name: string, body: string): Promise<void> { return this.driver.replace('src/main/kotlin/store/' + name.split('.')[0] + '.kt', 'throw NotImplementedError("Not implemented: ' + name + '")', body); }
  read(name: string): Promise<void> { return this.driver.read(name); }
  expectReadText(text: string): void {
    expect(this.driver.readResult.coverage.complete, JSON.stringify(this.driver.readResult.problems)).toBe(true);
    expect(this.driver.readResult.artifacts.some(artifact => Buffer.from(artifact.file.bytes).toString('utf8').includes(text))).toBe(true);
  }
  async expectUpdateRefused(code: string): Promise<void> {
    const before = await this.driver.capturedFiles();
    await this.driver.update(); expect(this.driver.written.problems.map(problem => problem.code)).toContain(code); expect(this.driver.written.receipt).toBeUndefined();
    expect(this.driver.files).toEqual(before);
  }
  expectFileMissingText(path: string, text: string): void { expect(this.driver.files.get(path)).not.toContain(text); }
  async updateContracts(): Promise<void> {
    await this.driver.update(); expect(this.driver.written.problems).toEqual([]); expect(['applied', 'unchanged']).toContain(this.driver.written.receipt?.status);
  }
  expectFileContains(path: string, text: string): void { expect(this.driver.files.get(path)).toContain(text); }
  expectFileText(path: string, text: string): void { expect(this.driver.files.get(path)).toBe(text); }
  expectMissingFile(path: string): void { expect(this.driver.files.has(path)).toBe(false); }
  file(path: string, text: string): Promise<void> { return this.driver.file(path, text); }
  search(name: string): Promise<void> { return this.driver.search(name); }
  expectIncomingCall(path: string, start: number, end: number): void {
    expect(this.driver.searchResult.incoming.coverage.complete, JSON.stringify(this.driver.searchResult.problems)).toBe(true);
    expect(this.driver.searchResult.incoming.uses).toEqual(expect.arrayContaining([expect.objectContaining({
      target: expect.objectContaining({ kind: 'project' }),
      at: expect.objectContaining({ format: 'kotlin-site-1', value: expect.objectContaining({ file: path, start, end }) }),
    })]));
  }
  expectSearchScope(paths: string[]): void {
    expect(this.driver.searchResult.incoming.coverage.complete, JSON.stringify(this.driver.searchResult.problems)).toBe(true);
    expect(this.driver.searchResult.incoming.coverage.scope.map(at => (at.value as { file: string }).file).sort()).toEqual([...paths].sort());
  }
  expectIncompleteSearch(code: string): void {
    expect(this.driver.searchResult.incoming.coverage.complete).toBe(false);
    expect(this.driver.searchResult.problems.map(problem => problem.code)).toContain(code);
  }
  async buildContracts(): Promise<void> {
    await this.driver.build(); expect(this.driver.written.problems).toEqual([]); expect(this.driver.written.receipt?.status).toBe('applied');
  }
  compileConsumer(text: string): Promise<void> { return this.driver.compile(text); }
  runConsumer(text: string): Promise<void> { return this.driver.execute(text); }
  expectNativeCompilationPassed(): void { expect(this.driver.compiled, this.driver.compiled.stderr).toMatchObject({ code: 0 }); }
  expectNativeCompilationFailedAt(text: string): void { expect(this.driver.compiled.code).not.toBe(0); expect(this.driver.compiled.stderr).toContain(text); }
  expectStdout(text: string): void { this.expectNativeCompilationPassed(); expect(this.driver.execution.code, this.driver.execution.stderr).toBe(0); expect(this.driver.execution.stdout.trim()).toBe(text); }
  expectUnimplemented(name: string): void { this.expectNativeCompilationPassed(); expect(this.driver.execution.code).not.toBe(0); expect(this.driver.execution.stderr).toContain('NotImplementedError'); expect(this.driver.execution.stderr).toContain(name); }
}
