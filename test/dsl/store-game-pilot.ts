import { expect, onTestFinished } from 'vitest';
import { StoreGamePilotDriver } from '../driver/store-game-pilot.js';

export class StoreGamePilot {
  private remembered: Record<string, string> = {};
  private rememberedProject: Record<string, string> = {};
  private rememberedBody = '';
  private originalSave = '';
  private constructor(private readonly driver: StoreGamePilotDriver) {}
  private static async prepare(layout: 'original' | 'distributed' | 'generated'): Promise<StoreGamePilot> {
    const driver = new StoreGamePilotDriver(); onTestFinished(() => driver.dispose());
    await driver.prepare(layout); return new StoreGamePilot(driver);
  }
  static originalStoreGame(): Promise<StoreGamePilot> { return this.prepare('original'); }
  static distributedStoreGame(): Promise<StoreGamePilot> { return this.prepare('distributed'); }
  static generatedStoreGame(): Promise<StoreGamePilot> { return this.prepare('generated'); }
  static async adoptedOriginalStoreGame(): Promise<StoreGamePilot> { const pilot = await this.originalStoreGame(); await pilot.adoptMappedStoreGame(); return pilot; }
  static async adoptedDistributedStoreGame(): Promise<StoreGamePilot> { const pilot = await this.distributedStoreGame(); await pilot.adoptMappedStoreGame(); return pilot; }
  private method(subject: string) {
    const [owner, name] = subject.split('.');
    const found = this.driver.observed.classes.filter(item => item.name === owner).flatMap(item => item.methods).filter(method => method.name === name);
    expect(found, subject).toHaveLength(1); return found[0]!;
  }
  private expectWritten(): void {
    const result = this.driver.observed.written;
    expect(result, JSON.stringify({ problems: result?.problems, status: result?.receipt?.status,
      outcomes: result?.receipt?.outcomes.map(item => ({ state: item.state, change: item.change.kind, path: 'path' in item.change ? item.change.path : item.change.to })) }))
      .toMatchObject({ problems: [], receipt: { status: expect.stringMatching(/^(applied|unchanged)$/) } });
  }
  async adoptMappedStoreGame(): Promise<void> { await this.driver.recipe('adopt'); this.expectWritten(); this.originalSave = this.method('StoreGame.save').body!; }
  expectConfirmedMethods(names: string[]): void {
    for (const name of names) expect(this.driver.observed.artifacts).toContainEqual(expect.objectContaining({ specId: this.driver.observed.ids['StoreGame.' + name],
      locator: expect.objectContaining({ format: 'typescript-symbol-1', value: { file: 'src/game.ts', declaration: [{ kind: 'class', name: 'StoreGame' }, { kind: 'method', name, static: false }] } }) }));
  }
  rememberOriginalFileBytes(): Promise<void> { return this.rememberFiles(['src/game.ts']); }
  expectOriginalFileBytesKept(): Promise<void> { return this.expectRememberedFilesKept(); }
  async rememberFiles(paths: string[]): Promise<void> { for (const path of paths) this.remembered[path] = await this.driver.text('project/' + path); }
  async expectRememberedFilesKept(): Promise<void> { for (const [path, text] of Object.entries(this.remembered)) expect(await this.driver.text('project/' + path)).toBe(text); }
  expectNoDuplicateNativeClass(name: string): void { expect(this.driver.observed.classes.filter(item => item.name === name)).toHaveLength(1); }
  read(subject: string): Promise<void> { return this.driver.recipe('read', subject); }
  expectReadContains(texts: string[]): void {
    const read = this.driver.observed.read!;
    expect(read.problems, JSON.stringify(read.problems)).toEqual([]); expect(read.coverage.complete).toBe(true);
    for (const artifact of read.artifacts) expect(artifact.file.text).toBe(this.driver.observed.files[artifact.file.path]);
    expect(read.artifacts.length).toBeGreaterThan(0);
    for (const text of texts) expect(read.artifacts.some(artifact => artifact.file.text.includes(text)), text).toBe(true);
  }
  search(subject: string): Promise<void> { return this.driver.recipe('search', subject); }
  expectDefinition(file: string, name: string): void {
    const definitions = this.driver.observed.search!.definitions;
    expect(definitions.some(at => {
      const value = at.value as { file?: string; start?: number; end?: number; role?: string };
      return value.file === file && value.role === 'definition' && this.driver.observed.files[file]!.slice(value.start, value.end).includes(name);
    }), JSON.stringify(definitions)).toBe(true);
  }
  expectProjectOnlyIncoming(file: string, token: string): void {
    const uses = this.driver.observed.search!.incoming.uses;
    expect(uses.some(use => {
      const at = use.at.value as { file?: string; start?: number; end?: number; role?: string };
      return use.target.kind === 'project' && at.file === file && at.role === 'call'
        && this.driver.observed.files[file]!.slice(at.start, at.end) === token;
    }), JSON.stringify(uses)).toBe(true);
  }
  expectCompleteNativeCoverage(): void {
    const search = this.driver.observed.search!;
    expect(search.problems, JSON.stringify(search.problems)).toEqual([]);
    expect(search.incoming.coverage.complete).toBe(true); expect(search.outgoing.coverage.complete).toBe(true);
    expect(search.incoming.unresolved).toEqual([]); expect(search.outgoing.unresolved).toEqual([]);
  }
  checkNativeTypes(): Promise<void> { return this.driver.checkTypes(); }
  expectNativeTypesAccepted(): void { expect(this.driver.native, this.driver.native.stdout + this.driver.native.stderr).toMatchObject({ code: 0 }); }
  identity(subject: string): string { const id = this.driver.observed.ids[subject]; expect(id, subject).toBeDefined(); return id!; }
  async rememberMethodBody(subject: string): Promise<void> { await this.driver.recipe('inspect'); this.rememberedBody = this.method(subject).body!; }
  expectMethodBodyKept(subject: string): void { expect(this.method(subject).body).toBe(this.rememberedBody); }
  async renameSourceCapability(subject: string, name: string, decision: { retain: string }): Promise<void> {
    expect(subject).toBe('StoreGame.' + this.driver.saveName); this.driver.saveName = name;
    this.driver.decisions.push({ id: decision.retain, to: 'StoreGame.' + name }); await this.driver.author();
  }
  async declarePersistenceDependency(name: string): Promise<void> {
    this.driver.dependency = name;
    await this.driver.file('models.expec', (await this.driver.text('models.expec')) + '\nclass ' + name + ' {}\n'); await this.driver.author();
  }
  async promise(_subject: string, text: string): Promise<void> { this.driver.promise = text; await this.driver.author(); }
  updateThroughPublicRecipe(): Promise<void> { return this.driver.recipe('update'); }
  expectIdentity(subject: string, id: string): void { this.expectWritten(); expect(this.identity(subject)).toBe(id); }
  expectNativeSourceContains(text: string): void { expect(Object.values(this.driver.observed.files).some(source => source.includes(text)), text).toBe(true); }
  expectDeclaredDependency(owner: string, dependency: string): void { expect(this.driver.observed.declared.find(item => item.name === owner)?.dependencies).toContain(dependency); }
  expectUnverifiedPromise(text: string): void {
    this.expectNativeSourceContains(text); this.expectNativeSourceContains('Unverified implementation obligation.');
  }
  generatePersistenceVerification(text: string): Promise<void> { return this.driver.verifyPersistence(text); }
  expectObligation(code: string, text: string): void { this.expectWritten(); expect(this.driver.observed.written?.obligations).toContainEqual(expect.objectContaining({ code, message: expect.stringContaining(text) })); }
  runGeneratedVerification(): Promise<void> { return this.driver.runVerification(); }
  expectVerificationFailure(text: string): void {
    const result = this.driver.verification!; expect(result.code).not.toBe(0); expect(result.report.success).toBe(false);
    const cases = result.report.testResults.flatMap(file => file.assertionResults);
    expect(cases).toHaveLength(1); expect(cases[0]).toMatchObject({ title: 'Supabase persistence', status: 'failed' });
    expect(cases[0]!.failureMessages.join('\n')).toContain(text);
  }
  expectNoRemotePersistenceClaim(): void { expect(this.driver.verification!.report.success).toBe(false); expect(this.method('StoreGame.saveGame').body).toContain('localStorage.setItem'); }
  moveSourceDeclaration(_subject: string, module: string, decision: { retain: string }): Promise<void> { return this.driver.moveSource(module, decision.retain); }
  expectSourceOrigin(subject: string, file: string): void { expect(this.driver.observed.declared.find(item => item.name === subject)?.origin.module).toMatch(new RegExp('/' + file.replaceAll('.', '\\.') + '$')); }
  implementSave(text: string): Promise<void> { return this.driver.editMethod('StoreGame.save', () => '{\n    ' + text + '\n  }'); }
  addPrivateHelper(name: string): Promise<void> { return this.driver.addPrivateHelper(name); }
  file(path: string, text: string): Promise<void> { return this.driver.file('project/' + path, text); }
  renameRoot(_from: string, name: string): Promise<void> { return this.driver.renameGeneratedRoot(name); }
  buildThroughInstalledCli(): Promise<void> { return this.driver.buildGenerated(); }
  expectFileAbsent(path: string): void { expect(this.driver.observed.files[path]).toBeUndefined(); }
  expectPrivateHelper(file: string, name: string): void { expect(this.driver.observed.classes.filter(item => item.file === file).flatMap(item => item.methods)).toContainEqual(expect.objectContaining({ name, private: true })); }
  expectNativeImport(file: string, expected: { imported: string; local: string; from: string }): void { expect(this.driver.observed.imports).toContainEqual({ file, ...expected }); }
  async addCapability(owner: string, name: string, inputs: string[], result: string): Promise<void> {
    expect({ owner, name, inputs, result }).toEqual({ owner: 'StoreGame', name: 'archive', inputs: [], result: 'Nothing' });
    this.driver.archive = true; await this.driver.author();
  }
  expectThrowingStub(subject: string, message: string): void { this.expectWritten(); expect(this.method(subject).body).toContain('throw new Error(' + JSON.stringify(message) + ')'); }
  async retireSourceCapability(subject: string): Promise<void> {
    this.driver.decisions.push({ retire: this.identity(subject) });
    if (subject === 'StoreGame.archive') this.driver.archive = false; else this.driver.includeSave = false; await this.driver.author();
  }
  expectNativeMethodAbsent(subject: string): void { this.expectWritten(); const [owner, name] = subject.split('.'); expect(this.driver.observed.classes.filter(item => item.name === owner).flatMap(item => item.methods).some(method => method.name === name)).toBe(false); }
  expectOriginalSavingBodyKept(): void { expect(this.method('StoreGame.save').body).toBe(this.originalSave); }
  async rememberAllProjectAndBaselineBytes(): Promise<void> { this.rememberedProject = await this.driver.projectBytes(); }
  async expectProjectAndBaselineBytesKept(): Promise<void> { expect(await this.driver.projectBytes()).toEqual(this.rememberedProject); }
  expectProblem(code: string): void { expect(this.driver.observed.written?.problems).toContainEqual(expect.objectContaining({ code })); expect(this.driver.observed.written?.artifacts).toBeUndefined(); expect(this.driver.observed.written?.receipt).toBeUndefined(); }
  expectConfirmedIdentity(subject: string, id: string): void { expect(this.identity(subject)).toBe(id); }
  addHandwrittenSaveComment(text: string): Promise<void> { return this.driver.editMethod('StoreGame.save', body => body.replace('{', '{\n    // ' + text)); }
  reopenRecipeInNewProcess(): Promise<void> { return this.driver.recipe('inspect'); }
  expectUnchanged(): void { this.expectWritten(); expect(this.driver.observed.written?.receipt).toMatchObject({ status: 'unchanged', outcomes: [] }); }
}
