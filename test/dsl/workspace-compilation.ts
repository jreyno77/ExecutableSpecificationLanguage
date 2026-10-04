import { expect } from 'vitest';
import ts from 'typescript';
import { FileProjectWriter, QueryInspection, type Diagnostic, type Item, type Model, type ResolutionDependencies, type TypeId } from '../../src/index.js';
import { modelState } from '../driver/source-composition.js';
import { WorkspaceDriver, WorkspaceProjectDriver } from '../driver/workspace-compilation.js';

export class WorkspaceExamples {
  readonly driver = new WorkspaceDriver();
  private problem!: Diagnostic;
  private readonly supplied = new Map<Model, ReturnType<typeof modelState>>();
  entry(module: string, text: string, options?: { sourceId: string }): void { this.driver.add(module, text, true, options?.sourceId); }
  module(module: string, text: string): void { this.driver.add(module, text, false); }
  supplyOnlySelectedRoots(): void { this.driver.onlyRoots(); }
  mapsModule(owner: string, authored: string, target: string): void { this.driver.maps(owner, authored, target); }
  dependencyFor(owner: string, locator: string, text: string, options: { sourceId: string }): void { this.driver.dependency(owner, locator, text, options.sourceId); }
  packagesFor(owner: string, packages: ResolutionDependencies['packages']): void { this.driver.packageFacts(owner, packages); }
  compile(): void { this.driver.compileWorkspace(); }
  compileWithExistingSingleEntryCall(): void { this.driver.compileWorkspace(true); }
  selectEntries(entries: string[]): void { this.driver.selected = [...entries]; }
  reload(): void { this.driver.reload(); }
  identify(): void { this.driver.identify(); }
  identifyFrom(previous: string): void { this.driver.identify(previous); }
  rememberIdentity(name: string): void { this.driver.baselines.set(name, this.driver.current.value!); }
  retirePriorSubject(before: string, module: string, name: string): void {
    this.driver.decisions.push({ retire: this.driver.subject(module, name, this.driver.baselines.get(before)) });
  }
  expectCompiled(): void { expect(this.driver.compilation).toMatchObject({ syntax: [], problems: [], deferred: [] }); expect(this.driver.compilation.value).toBeDefined(); }
  expectNoSpecification(): void { expect(this.driver.compilation.value).toBeUndefined(); }
  expectRepresentative(module: string): void { expect(this.driver.resolution.entry).toBe(module); expect(this.driver.compilation.value?.entry).toBe(module); }
  expectBuiltinCount(name: string, count: number): void { expect([...this.driver.inspection.query('builtin-type')].filter(item => item.name === name)).toHaveLength(count); }
  expectCallableResult(module: string, name: string, expected: string): void {
    const result = this.driver.types.callable(this.driver.declaration(module, name).id).result;
    expect(result.status).toBe('known');
    if (result.status !== 'known' || result.value.kind !== 'value') throw new Error('Expected value result');
    expect(this.typeName(result.value.type)).toBe(expected);
  }
  private typeName(type: TypeId): string {
    const description = this.driver.types.describe(type);
    if (!('declaration' in description)) throw new Error('Expected declared type');
    const node = this.driver.inspection.read(description.declaration);
    if (!('name' in node)) throw new Error('Expected named type'); return node.name;
  }
  expectDeclarationCount(module: string, name: string, count: number): void {
    expect([...this.driver.inspection.roots()].filter(item => item.origin.kind !== 'builtin' && item.origin.module === module && 'name' in item && item.name === name)).toHaveLength(count);
  }
  expectOriginalDeclarationIdentity(module: string, name: string): void {
    const original = this.driver.declaration(module, name), actual = this.driver.readOriginal(module, name);
    expect(actual.id).toBe(original.id); expect(actual.origin).toEqual(original.origin);
  }
  expectSameParameterType(left: string, a: string, p: string, right: string, b: string, q: string): void {
    const first = this.driver.parameterType(left, a, p), second = this.driver.parameterType(right, b, q);
    expect(first.status).toBe('known'); expect(second.status).toBe('known');
    if (first.status === 'known' && second.status === 'known') expect(first.value).toBe(second.value);
  }
  expectParameterType(module: string, callable: string, parameter: string, target: string, name: string): void {
    const fact = this.driver.parameterType(module, callable, parameter); expect(fact.status).toBe('known');
    if (fact.status === 'known') expect(fact.value).toBe(this.driver.declaredType(target, name));
  }
  expectDifferentDeclarations(left: string, a: string, right: string, b: string): void { expect(this.driver.readOriginal(left, a).id).not.toBe(this.driver.readOriginal(right, b).id); }
  expectFieldTypes(module: string, name: string, expected: string[]): void {
    const fields = this.driver.types.fields(this.driver.declaredType(module, name));
    if (fields.status !== 'known' || fields.value.kind !== 'available') throw new Error('Unavailable fields');
    expect(fields.value.fields.map(field => {
      if (field.type.status !== 'known') throw new Error('Unavailable field type');
      return this.driver.inspection.read(field.declaration, 'field').name + ': ' + this.typeName(field.type.value);
    })).toEqual(expected);
  }
  expectCapabilities(module: string, name: string, expected: string[]): void {
    const item = this.driver.inspection.read(this.driver.declaration(module, name).id);
    if (!('members' in item)) throw new Error('Expected owner');
    expect(item.members.filter(member => member.kind === 'capability').map(member => member.name)).toEqual(expected);
  }
  expectMemberOrigin(owner: string, name: string, module: string, text: string, line: number): void {
    expect(this.matches(this.driver.inspection.read(this.driver.declaration(owner, name).id).origin, module, text, line)).toBe(true);
  }
  private matches(at: Diagnostic['at'], module: string, text: string, line: number): boolean {
    const expected = this.driver.located(module, text, line);
    return at.kind === 'source' && at.module === module && at.range.start.line === line && at.range.start.column === expected.column;
  }
  expectProblem(code: string, module: string, text: string, at: { line: number }): void {
    const found = this.driver.compilation.problems.find(problem => problem.code === code && this.matches(problem.at, module, text, at.line));
    expect(found, JSON.stringify(this.driver.compilation.problems)).toBeDefined(); this.problem = found!;
  }
  expectRelatedSource(module: string, text: string, at: { line: number }): void { expect(this.problem.related.some(origin => this.matches(origin, module, text, at.line))).toBe(true); }
  expectDependencyProblem(code: string, path: readonly (string | number)[]): void {
    const found = this.driver.compilation.problems.find(problem => problem.code === code && problem.at.kind === 'dependency' && JSON.stringify(problem.at.path) === JSON.stringify(path));
    expect(found, JSON.stringify(this.driver.compilation.problems)).toBeDefined(); this.problem = found!;
  }
  expectRelatedDependency(path: readonly (string | number)[]): void { expect(this.problem.related).toContainEqual({ kind: 'dependency', path }); }
  expectNoProblem(code: string): void { expect(this.driver.compilation.problems.some(problem => problem.code === code)).toBe(false); }
  expectProblemCount(code: string, count: number): void { expect(this.driver.compilation.problems.filter(problem => problem.code === code)).toHaveLength(count); }
  expectNotAnalyzed(module: string, name: string): void { expect(() => this.driver.readOriginal(module, name)).toThrowError(expect.objectContaining({ code: 'not-analyzed' })); }
  expectIdentityProblem(code: string): void { expect(this.driver.current.value).toBeUndefined(); expect(this.driver.current.problems.map(problem => problem.code)).toContain(code); }
  expectIdentityUnchanged(before: string): void { expect(this.driver.current.value?.baseline).toEqual(this.driver.baselines.get(before)!.baseline); }
  expectDiff(expected: { changes: unknown[]; contextChanged: boolean }): void { expect(this.driver.diff).toMatchObject(expected); }
  expectContextChanged(): void { expect(this.driver.diff.contextChanged).toBe(true); }
  expectPersistentIdentity(module: string, name: string, before: string): void { expect(this.driver.subject(module, name)).toBe(this.driver.subject(module, name, this.driver.baselines.get(before))); }
  expectRetiredIdentifiers(ids: string[]): void { expect(this.driver.current.value?.baseline.retired).toEqual(ids); }
  expectRetiredSubjects(before: string, names: string[]): void {
    const baseline = this.driver.baselines.get(before)!.baseline;
    expect(this.driver.current.value!.baseline.retired.map(id => {
      const record = baseline.elements.find(record => record.id === id)!; return record.address.module + ':' + record.address.name;
    }).sort()).toEqual([...names].sort());
  }
  expectRemovedSubjects(names: string[]): void {
    expect(this.driver.diff.changes.filter(change => change.kinds.includes('remove')).map(change => change.before!.address.module + ':' + change.before!.address.name).sort()).toEqual([...names].sort());
  }
  expectNewCapturedHandles(before: string): void {
    const old = this.driver.baselines.get(before)!;
    for (const record of old.baseline.elements) expect(this.driver.current.value!.node(record.id)).not.toBe(old.node(record.id));
  }
  rememberSuppliedModels(): void { for (const model of this.driver.modules.values()) this.supplied.set(model, modelState(model)); }
  expectSuppliedModelsUnchanged(): void {
    for (const [model, before] of this.supplied) {
      const actual = modelState(model); expect(actual.facts).toBe(before.facts);
      actual.ids.forEach((id, index) => expect(id).toBe(before.ids[index]));
    }
  }
  rememberResult(name: string): void { this.driver.remember(name); }
  expectRememberedDeclarations(before: string, names: string[]): void { expect(rootNames(new QueryInspection(this.driver.remembered.get(before)!.resolution.model).roots())).toEqual([...names].sort()); }
  expectCurrentDeclarations(names: string[]): void { expect(rootNames(this.driver.inspection.roots())).toEqual([...names].sort()); }
}
function rootNames(items: Iterable<Item>): string[] { return [...items].flatMap(item => item.origin.kind === 'source' && 'name' in item ? [item.origin.module + ':' + item.name] : []).sort(); }

export class WorkspaceProject {
  private static readonly instances: WorkspaceProject[] = [];
  readonly driver = new WorkspaceProjectDriver();
  static async connect(options: { entries: string[] }): Promise<WorkspaceProject> {
    const project = new WorkspaceProject(); this.instances.push(project); project.driver.entries = options.entries;
    await project.driver.initialize(); return project;
  }
  static async dispose(): Promise<void> { for (const project of this.instances.splice(0)) await project.driver.dispose(); }
  writeSource(path: string, text: string): Promise<void> { return this.driver.sourceFile(path, text); }
  async configureEntries(entries: string[]): Promise<void> { this.driver.entries = [...entries]; }
  module(path: string): string { return this.driver.module(path); }
  loadAndCompile(): Promise<void> { return this.driver.load(); }
  loadAndCompileFrom(before: string): Promise<void> { return this.driver.load(before); }
  async createTypeScript(options: Record<string, unknown>): Promise<void> {
    await this.driver.create(options);
    if (this.driver.written?.artifacts) this.driver.current = this.driver.identity.withArtifacts(this.driver.current, this.driver.written.artifacts).value!;
  }
  provideSourceLibrary(module: string, text: string): void { this.driver.libraries.push(this.driver.model(module, text)); }
  async writeNativeFile(path: string, text: string): Promise<void> { await this.driver.file(path, text); this.driver.nativeBefore.set(path, text); }
  expectGeneratedFiles(paths: string[]): void { expect([...this.driver.files.keys()].filter(path => path.startsWith('src/') && path.endsWith('.ts')).sort()).toEqual([...paths].sort()); }
  expectArtifactCount(module: string, name: string, count: number): void {
    const record = this.driver.current.baseline.elements.find(record => record.address.module === this.module(module) && record.address.name === name)!;
    expect(this.driver.current.baseline.artifacts.filter(artifact => artifact.specId === record.id)).toHaveLength(count);
  }
  async checkNativeConsumer(source: string): Promise<void> { await this.driver.check(source); }
  async checkNativeTypes(): Promise<void> { await this.driver.check(); }
  expectNativeCheckPassed(): void { expect(this.driver.nativeDiagnostics).toEqual([]); }
  expectOutputProblem(code: string): void { expect(this.driver.problems.map(problem => problem.code)).toContain(code); }
  async expectProjectUnchanged(): Promise<void> { await this.driver.capture(); expect(this.driver.files).toEqual(this.driver.remembered); }
  async expectFileAbsent(path: string): Promise<void> { await this.driver.capture(); expect(this.driver.files.has(path)).toBe(false); }
  async expectNativeFileUnchanged(path: string): Promise<void> { await this.driver.capture(); expect(this.driver.files.get(path)).toBe(this.driver.nativeBefore.get(path)); }
  expectNativeFields(path: string, name: string, expected: string[]): void {
    const node = this.driver.native(name) as ts.TypeAliasDeclaration;
    expect(node?.getSourceFile().fileName).toBe(path);
    if (!node || !ts.isTypeLiteralNode(node.type)) throw new Error('Expected native record');
    expect(node.type.members.map(member => member.getText().replace(/;$/, ''))).toEqual(expected);
  }
  async rememberProject(name: string): Promise<void> { await this.driver.capture(); this.driver.snapshots.set(name, new Map(this.driver.files)); }
  rememberIdentity(name: string): void { this.driver.baselines.set(name, this.driver.current); }
  planTypeScriptUpdate(options: Record<string, unknown>): Promise<void> { return this.driver.planUpdate(options); }
  expectPlannedChanges(changes: unknown[]): void { expect(this.driver.plan.problems).toEqual([]); expect(this.driver.plan.value?.changes).toEqual(changes); }
  expectSameArtifactAssociations(before: string): void { expect(this.driver.plan.value?.artifacts).toEqual(this.driver.baselines.get(before)!.baseline.artifacts); }
  async applyPlannedOutput(): Promise<void> {
    if (!this.driver.plan.value) throw new Error(JSON.stringify(this.driver.plan));
    const receipt = await new FileProjectWriter(this.driver.context).apply(this.driver.plan.value);
    this.driver.written = { receipt, problems: receipt.problems };
  }
  expectWriteStatus(status: string): void { expect(this.driver.written?.receipt?.status).toBe(status); }
  async expectProjectEquals(name: string): Promise<void> { await this.driver.capture(); expect(this.driver.files).toEqual(this.driver.snapshots.get(name)); }
}
