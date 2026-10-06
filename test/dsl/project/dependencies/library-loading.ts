import { access } from 'node:fs/promises';
import { expect, onTestFinished } from 'vitest';
import { type Diagnostic, type ExternalDefinition, type Origin } from '../../../../src/index.js';
import { LibraryLoadingDriver } from '../../../driver/project/dependencies/library-loading.js';
import { NativePackageDriver } from '../../../driver/project/dependencies/native-packages.js';

export class DependencyExamples {
  private problem!: Diagnostic;
  private constructor(private readonly driver: LibraryLoadingDriver) {}
  static async create(): Promise<DependencyExamples> {
    const driver = new LibraryLoadingDriver();
    await driver.initialize(); onTestFinished(() => driver.dispose());
    return new DependencyExamples(driver);
  }
  static async withBookLibrary(version: string): Promise<DependencyExamples> {
    const project = await this.create();
    await project.library('books', version, { 'index.expec': 'type Book { title: Text }' });
    project.requireLibrary('books', '^1', './libraries/books');
    return project;
  }
  static async withPrivateBookLibrary(): Promise<DependencyExamples> {
    const project = await this.create();
    await project.library('books', '1.0.0', { 'index.expec': 'use Title from "./types.expec"\ntype Book { title: Title }', 'types.expec': 'type Title = Text' });
    project.requireLibrary('books', '^1', './libraries/books');
    await project.source('main.expec', 'use Book from "books"\nfunction save(book: Book) returns Nothing');
    return project;
  }
  static async withInstalledStorage(version: string): Promise<DependencyExamples> {
    const project = await this.create(), native = new NativePackageDriver();
    await native.initialize(); onTestFinished(() => native.dispose()); await native.seed('example-storage', version, '^2');
    native.spawned.mockClear(); project.driver.native = native; return project;
  }
  requirePackage(alias: string, name: string, version: string, phases: ('build' | 'runtime' | 'test')[]) { this.driver.packageRequirements.push({ alias, name, version, phases }); }
  expectUnavailablePackageAlias(alias: string) { this.expectProblem('unavailable-package'); expect(this.problem.message).toContain(alias); }
  library(name: string, version: string, sources: Record<string, string>) { return this.driver.library(name, version, sources); }
  externalLibrary(name: string, version: string, definitions: unknown) { return this.driver.external(name, version, definitions); }
  requireLibrary(module: string, version: string, source?: string) { this.driver.requireLibrary(module, version, source); }
  source(name: string, text: string) { return this.driver.file(name, text); }
  file(name: string, text: string) { return this.driver.file(name, text); }
  supplyExternalLibrary(name: string, version: string, definitions: readonly ExternalDefinition[]) { this.driver.supply(name, version, definitions); }
  loadLibraries() { return this.driver.loadLibraries(); }
  selectDependencies() { this.driver.selectDependencies(); }
  loadAndCompile() { return this.driver.loadAndCompile(); }
  loadWorkspaceWithCapturedLibraries() { return this.driver.loadWorkspace(); }
  replaceSelectedEntryWithSeparateModel(module: string, text: string) { this.driver.replaceSelected(module, text); }
  async libraryMetadata(name: string, metadata: object) {
    await this.driver.file(`libraries/${name}/package.json`, JSON.stringify({ name, version: '1.0.0', expec: metadata }));
  }
  expectSuccessfulLibraryLoad() {
    expect(this.driver.libraries.problems).toEqual([]); expect(this.driver.libraries.syntax).toEqual([]);
    expect(this.driver.libraries.value).toBeDefined();
  }
  expectChecked() { expect(this.driver.last).toMatchObject({ problems: [], deferred: [] }); expect(this.driver.last.value).toBeDefined(); }
  expectNoSpecification() { expect(this.driver.last.value).toBeUndefined(); }
  expectNoSuccessfulLibraryLoad() { expect(this.driver.libraries.value).toBeUndefined(); }
  expectNoSuccessfulSourceLoad() { expect(this.driver.current.load.value).toBeUndefined(); }
  expectNoSelectedDependencies() { expect(this.driver.selected.value).toBeUndefined(); }
  expectProblem(code: string) {
    const finding = this.driver.findings().find(item => item.code === code);
    expect(finding, JSON.stringify(this.driver.findings())).toBeDefined(); this.problem = finding!;
  }
  expectProblemAt(code: string, text: string, file: string) {
    const sourceId = this.driver.fileUrl(file), source = this.driver.texts.get(sourceId)!;
    const finding = this.driver.findings().find(item => item.code === code && item.at.kind === 'source'
      && item.at.range.sourceId === sourceId && [...source].slice(item.at.range.start.offset, item.at.range.end.offset).join('')
        .replace(/^"|"$/g, '') === text);
    expect(finding, JSON.stringify(this.driver.findings())).toBeDefined(); this.problem = finding!;
  }
  expectExternalProblem(code: string, origin: { module: string; path: readonly (string | number)[] }) {
    this.expectProblem(code); expect(this.problem.at).toEqual({ kind: 'external', ...origin });
  }
  expectRelatedFile(file: string) {
    expect(this.problem.related.some(at => at.kind === 'dependency' && at.path.includes(this.driver.fileUrl(file)))).toBe(true);
  }
  expectUnavailableModule(module: string) { this.expectProblem('unavailable-module'); expect(this.problem.message).toContain(module); }
  expectLoadedLibraryVersion(module: string, version: string) {
    expect(this.driver.libraries.value?.inventory.find(item => item.model.locator === module)?.version).toBe(version);
  }
  expectSelectedLibrary(module: string, version: string) { this.expectLoadedLibraryVersion(module, version); expect(this.driver.selected.value?.modules.some(item => item.locator === module)).toBe(true); }
  expectAcquiredInventory(names: string[]) { expect(this.driver.libraries.value?.inventory.map(item => item.model.locator)).toEqual(names); }
  expectWorkspaceModules(names: string[]) {
    expect(this.driver.current.load.captures.filter(capture => capture.model).map(capture => capture.model!.locator)).toEqual(names.map(name => this.driver.fileUrl(name)));
  }
  expectNoWorkspaceCapture(file: string) { expect(this.driver.current.load.captures.map(capture => capture.source.sourceId)).not.toContain(this.driver.fileUrl(file)); }
  expectFileNotRead(file: string) { expect(this.driver.opened.mock.calls.map(call => String(call[0]))).not.toContain(this.driver.path(file)); }
  expectNoReadUnder(directory: string) { expect(this.driver.opened.mock.calls.some(call => String(call[0]).startsWith(this.driver.path(directory)))).toBe(false); }
  expectNoNativeInstall() { expect(this.driver.spawned.mock.calls.some(call => (call[1] as string[] | undefined)?.includes('install'))).toBe(false); }
  expectNoAcquisitionSourceRead(module: string) { expect(this.driver.libraries.captures.some(capture => capture.source.sourceId.includes('/' + module + '/'))).toBe(false); }
  expectFieldType(path: string, expected: string) {
    this.expectChecked();
    const { types } = this.driver.compiled(), field = this.driver.declaration(path);
    if (field.kind !== 'field') throw Error('Expected field');
    const fact = types.typeOf(field.declaredType.id);
    expect(fact.status).toBe('known'); if (fact.status === 'known') expect(this.driver.typeName(fact.value, types)).toBe(expected);
  }
  expectFieldTypeDeclaration(path: string, module: string, name: string) {
    const field = this.driver.declaration(path), { types } = this.driver.compiled();
    if (field.kind !== 'field') throw Error('Expected field');
    const fact = types.typeOf(field.declaredType.id);
    expect(fact).toEqual({ status: 'known', value: types.declaredType(this.driver.declaration(name, module).id) });
  }
  expectParameterTypeDeclaration(path: string, module: string, name: string) {
    const parameter = this.driver.declaration(path), { types } = this.driver.compiled();
    if (parameter.kind !== 'parameter') throw Error('Expected parameter');
    expect(types.typeOf(parameter.declaredType.id)).toEqual({ status: 'known', value: types.declaredType(this.driver.declaration(name, module).id) });
  }
  expectOriginFile(name: string, file: string) {
    expect(this.driver.declaration(name).origin).toMatchObject({ kind: 'source', range: { sourceId: this.driver.fileUrl(file) } });
  }
  expectDistinctOrigins(first: string, second: string) { expect(this.driver.declaration(first).origin).not.toEqual(this.driver.declaration(second).origin); }
  expectExternalType(name: string, origin: Omit<Extract<Origin, { kind: 'external' }>, 'kind'>) { expect(this.driver.declaration(name).origin).toEqual({ kind: 'external', ...origin }); }
  expectFieldOrigin(name: string, origin: Omit<Extract<Origin, { kind: 'external' }>, 'kind'>) { this.expectExternalType(name, origin); }
  expectOpaqueDeclarations(names: string[]) { expect([...this.driver.compiled().types.inspection.query('opaque-type-declaration')].map(item => item.name)).toEqual(names); }
  private capture(file: string) {
    const capture = this.driver.libraries.captures.find(item => item.source.sourceId === this.driver.fileUrl(file));
    expect(capture).toBeDefined(); return capture!;
  }
  expectCapturedText(file: string, text: string) { expect(this.capture(file).source.text).toBe(text); }
  expectCaptureWithoutSourceModel(file: string) { expect(this.capture(file).model).toBeUndefined(); }
  expectCapturedJson(file: string, value: unknown) { expect(JSON.parse(this.capture(file).source.text)).toEqual(value); }
  expectCapturedJsonProperty(file: string, path: string[], value: unknown) {
    expect(path.reduce((data, key) => data[key], JSON.parse(this.capture(file).source.text))).toEqual(value);
  }
  async expectNoExecutedPackageCode() { await expect(access(this.driver.path('libraries/web/executed.txt'))).rejects.toMatchObject({ code: 'ENOENT' }); }
  rememberLibraryLoad(name: string) { this.driver.loads.set(name, this.driver.libraries); }
  expectLibraryFields(name: string, fields: string[]) { expect(this.driver.fields(name)).toEqual(fields); }
  expectRememberedLibraryFields(label: string, name: string, fields: string[]) { expect(this.driver.fields(name, this.driver.loads.get(label))).toEqual(fields); }
  expectSourceVersionChanged(file: string) {
    const previous = [...this.driver.loads.values()][0]?.captures.find(item => item.source.sourceId === this.driver.fileUrl(file));
    expect(previous).toBeDefined(); expect(this.capture(file).version).not.toBe(previous!.version);
  }
}
