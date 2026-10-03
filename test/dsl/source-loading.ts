import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { expect, onTestFinished } from 'vitest';
import {
  type Diagnostic, type ExternalDefinition, type Origin, type TypeCatalog, type TypeFact, type TypeId,
} from '../../src/index.js';
import { SourceLoadingDriver, type LoadedWorkspace } from '../driver/source-loading.js';

type Position = { line: number; column?: number };

export class SourceWorkspace {
  private problem!: Diagnostic;
  private constructor(private readonly driver: SourceLoadingDriver) {}
  static async create(options: { directoryName?: string } = {}): Promise<SourceWorkspace> {
    const driver = new SourceLoadingDriver(options.directoryName);
    onTestFinished(() => driver.dispose());
    return new SourceWorkspace(driver);
  }
  files(files: Record<string, string>): Promise<void> { return this.driver.files(files); }
  siblingFiles(files: Record<string, string>): Promise<void> { return this.driver.files(files, true); }
  file(name: string, text: string): Promise<void> { return this.driver.file(name, text); }
  fileBytes(name: string, bytes: readonly number[]): Promise<void> { return this.driver.file(name, new Uint8Array(bytes)); }
  removeFile(name: string): Promise<void> { return this.driver.removeFile(name); }
  directoryLink(name: string, target: string): Promise<void> { return this.driver.directoryLink(name, target); }
  hardLink(name: string, target: string): Promise<void> { return this.driver.hardLink(name, target); }
  fileUrl(name: string): string { return this.driver.fileUrl(name); }
  configure(settings: object): void { this.configureAt('expec.json', settings); }
  configureAt(name: string, settings: object): void { this.driver.configure(name, settings); }
  sourceLibrary(module: string, version: string, text: string, sourceId: string): void { this.driver.sourceLibrary(module, version, text, sourceId); }
  externalLibrary(module: string, version: string, definitions: readonly ExternalDefinition[]): void { this.driver.externalLibrary(module, version, definitions); }
  load(): Promise<void> { return this.driver.load(false); }
  compile(): Promise<void> { return this.driver.load(true); }
  rememberLoad(name: string): void { this.driver.remembered.set(name, this.driver.current); }
  expectWorkingDirectoryOutsideManifest(): void { expect(resolve(process.cwd())).not.toBe(dirname(this.driver.manifest)); }
  expectLoadSucceeded(): void {
    const result = this.driver.current.load;
    expect(result.problems).toEqual([]); expect(result.syntax).toEqual([]); expect(result.deferred).toEqual([]);
    expect(result.value).toBeDefined();
  }
  expectNoLoadValue(): void { expect(this.driver.current.load.value).toBeUndefined(); }
  expectNoLoadProblems(): void { expect(this.driver.current.load.problems).toEqual([]); }
  expectNoSyntaxProblems(): void { expect(this.driver.current.load.syntax).toEqual([]); }
  expectCompiled(): void {
    this.expectLoadSucceeded();
    expect(this.driver.current.compilations.size).toBe(this.driver.configuration.build.entries.length);
    for (const { compilation } of this.driver.current.compilations.values()) {
      expect(compilation.problems).toEqual([]); expect(compilation.syntax).toEqual([]); expect(compilation.deferred).toEqual([]);
      expect(compilation.value).toBeDefined();
    }
  }
  expectCompiledEntries(entries: readonly string[]): void {
    this.expectCompiled();
    expect([...this.driver.current.compilations.keys()]).toEqual(entries.map(entry => this.fileUrl(entry)));
  }
  expectEntryCompiled(entry: string): void {
    const compilation = this.driver.compiled(entry).compilation;
    expect(compilation).toMatchObject({ problems: [], syntax: [], deferred: [] });
    expect(compilation.value).toBeDefined();
  }
  expectNoSpecification(entry: string): void { expect(this.driver.compiled(entry).compilation.value).toBeUndefined(); }
  expectNoCompilationClaim(): void {
    expect(this.driver.current.compilations.size).toBe(0);
    expect(this.driver.current.load).not.toHaveProperty('compilation');
    expect(this.driver.current.load).not.toHaveProperty('specification');
  }
  expectCapturedFiles(files: readonly string[]): void {
    expect(this.driver.current.load.captures.map(capture => capture.source.sourceId)).toEqual(files.map(file => this.fileUrl(file)).sort());
  }
  expectAcceptedCaptures(files: readonly string[]): void {
    expect(this.driver.current.load.captures.filter(capture => capture.model).map(capture => capture.source.sourceId))
      .toEqual(files.map(file => this.fileUrl(file)).sort());
    for (const file of files) expect(this.driver.capture(file).model?.locator).toBe(this.fileUrl(file));
  }
  expectRejectedCapture(file: string, text: string): void {
    const capture = this.driver.capture(file);
    expect(capture.source.text).toBe(text); expect(capture.model).toBeUndefined();
  }
  expectCapturedText(file: string, text: string): void { expect(this.driver.capture(file).source.text).toBe(text); }
  expectDeclarations(entry: string, names: readonly string[]): void {
    expect([...this.driver.compiled(entry).types.inspection.roots()].flatMap(node =>
      node.origin.kind === 'source' && node.origin.module === this.fileUrl(entry) && 'name' in node ? [node.name] : [])).toEqual(names);
  }
  expectFieldType(module: string, field: string, expected: string): void {
    const { fact, types } = this.driver.fieldType(module, field);
    this.expectType(fact, types, expected);
  }
  private expectType(fact: TypeFact<TypeId>, types: TypeCatalog, expected: string): void {
    expect(fact.status, JSON.stringify(fact)).toBe('known');
    if (fact.status === 'known') expect(this.driver.typeName(fact.value, types)).toBe(expected);
  }
  expectDeclarationOrigin(name: string, file: string, position: Position): void {
    expect(this.driver.declaration(name, file).origin).toMatchObject({
      kind: 'source', module: this.fileUrl(file), range: { sourceId: this.fileUrl(file), start: position },
    });
  }
  expectCapabilities(owner: string, expected: readonly string[]): void {
    const inspection = this.driver.compiled().types.inspection, node = this.driver.declaration(owner);
    expect([...inspection.children(node.id)].flatMap(node => node.kind === 'capability' ? [node.name] : [])).toEqual(expected);
  }
  expectFixtureType(module: string, name: string, expected: string): void {
    const result = this.driver.fixtureType(module, name), { types } = this.driver.inspected(module);
    expect(result.problems).toEqual([]); expect(result.deferred).toEqual([]); expect(result.value).toBeDefined();
    if (result.value) expect(this.driver.typeName(result.value, types)).toBe(expected);
  }
  expectCallTarget(module: string, title: string, expected: string): void {
    const result = this.driver.callTarget(module, title), inspection = this.driver.inspected(module).types.inspection;
    expect(result.problems).toEqual([]); expect(result.deferred).toEqual([]); expect(result.value).toBeDefined();
    if (result.value) expect(this.driver.name(inspection.read(result.value), inspection)).toBe(expected);
  }
  expectProseOrigin(text: string, file: string, position: Position): void {
    const nodes = [...this.driver.inspected(file).types.inspection.query('prose-expectation')].filter(node => node.text.value === text);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.origin).toMatchObject({ kind: 'source', module: this.fileUrl(file), range: { sourceId: this.fileUrl(file), start: position } });
  }
  expectAuthoredLocator(module: string, locator: string): void { expect(this.driver.locators(module)).toContain(locator); }
  expectSameParameterType(callable: string, first: string, second: string): void {
    const facts = this.driver.parameterTypes(callable, [first, second]);
    expect(facts[0]?.status).toBe('known'); expect(facts[1]?.status).toBe('known');
    if (facts[0]?.status === 'known' && facts[1]?.status === 'known') expect(facts[0].value).toBe(facts[1].value);
  }
  expectSharedCapturedModel(file: string, entries: readonly string[]): void {
    const model = this.driver.capture(file).model;
    expect(model).toBeDefined();
    for (const entry of entries) {
      const input = this.driver.current.load.value?.entries.find(input => input.entry.locator === this.fileUrl(entry));
      expect(input?.dependencies.modules.filter(module => module.locator === this.fileUrl(file))).toHaveLength(1);
      expect(input?.dependencies.modules.find(module => module.locator === this.fileUrl(file))).toBe(model);
    }
  }
  expectExternalOrigin(name: string, origin: Origin): void { expect(this.driver.declaration(name).origin).toEqual(origin); }
  expectSuppliedNodeIdentityPreserved(module: string, name: string): void {
    expect(this.driver.declaration(name, module).id).toBe(this.driver.originalDeclaration(module, name).id);
  }
  expectSuppliedSourceOrigin(name: string, module: string, sourceId: string): void {
    expect(this.driver.declaration(name, module).origin).toMatchObject({ kind: 'source', module, range: { sourceId } });
  }
  expectSemanticProblem(file: string, code: string, text: string, position: Position): void {
    const findings = [...this.driver.current.compilations.values()].flatMap(result => result.compilation.problems);
    this.problem = this.findProblem(findings, code, file, text, position);
  }
  expectLoadProblem(code: string, file: string, text: string, position: Position): void {
    this.problem = this.findProblem(this.driver.current.load.problems, code, file, text, position);
  }
  private findProblem(findings: readonly Diagnostic[], code: string, file: string, text: string, position: Position): Diagnostic {
    const sourceId = this.fileUrl(file), authored = this.driver.texts.get(sourceId)!;
    const line = authored.split(/\r?\n/)[position.line - 1]!, column = position.column ?? [...line.slice(0, line.indexOf(text))].length + 1;
    expect(line).toContain(text);
    const result = findings.find(problem => problem.code === code && problem.at.kind === 'source'
      && problem.at.module === sourceId && problem.at.range.sourceId === sourceId
      && problem.at.range.start.line === position.line && problem.at.range.start.column === column
      && [...authored].slice(problem.at.range.start.offset, problem.at.range.end.offset).join('') === text);
    expect(result, JSON.stringify(findings)).toBeDefined();
    return result!;
  }
  expectLoadProblemAtSuppliedSource(code: string, module: string, text: string): void {
    const original = this.driver.modules.find(item => item.model.locator === module)!.model;
    const literal = original.nodes('string-literal').find(node => node.value === text)!;
    expect(literal).toBeDefined();
    expect(this.driver.current.load.problems).toContainEqual(expect.objectContaining({ code, at: literal.origin }));
  }
  expectManifestProblem(code: string, path: readonly (string | number)[]): void {
    const finding = this.driver.current.load.problems.find(problem => problem.code === code && problem.at.kind === 'dependency'
      && JSON.stringify(problem.at.path) === JSON.stringify(['manifest', this.driver.configuration.sourceId, ...path]));
    expect(finding, JSON.stringify(this.driver.current.load.problems)).toBeDefined();
    this.problem = finding!;
  }
  expectRelatedManifestLocation(path: readonly (string | number)[]): void {
    expect(this.problem.related).toContainEqual({ kind: 'dependency', path: ['manifest', this.driver.configuration.sourceId, ...path] });
  }
  expectRelatedSource(file: string, position: Position): void {
    expect(this.problem.related).toContainEqual(expect.objectContaining({
      kind: 'source', module: this.fileUrl(file), range: expect.objectContaining({ sourceId: this.fileUrl(file), start: expect.objectContaining(position) }),
    }));
  }
  expectRelatedAttemptedFile(file: string): void {
    expect(this.problem.related.some(at => at.kind === 'dependency'
      && at.path.some(part => part === this.fileUrl(file) || part === this.driver.path(file)))).toBe(true);
  }
  expectSyntaxProblem(file: string, category: string, position: Position): void {
    expect(this.driver.current.load.syntax).toContainEqual(expect.objectContaining({
      category, primaryRange: expect.objectContaining({ sourceId: this.fileUrl(file), start: expect.objectContaining(position) }),
    }));
  }
  expectSyntaxProblemAt(file: string, position: Position): void {
    expect(this.driver.current.load.syntax).toContainEqual(expect.objectContaining({
      primaryRange: expect.objectContaining({ sourceId: this.fileUrl(file), start: expect.objectContaining(position) }),
    }));
  }
  async expectSiblingAbsent(name: string): Promise<void> {
    await expect(stat(this.driver.path('../' + name))).rejects.toMatchObject({ code: 'ENOENT' });
  }
  expectNoSecondModelForPhysicalFile(file: string): void {
    expect(this.driver.capture(file).model).toBeDefined();
    expect(this.driver.current.load.captures.filter(capture => capture.model?.nodes('opaque-type-declaration')
      .some(node => capture.model!.node(node.name, 'name').decoded === 'Book'))).toHaveLength(1);
  }
  expectVersionMatchesAuthoredBytes(file: string, authored: string): void {
    expect(this.driver.capture(file).version).toBe('sha256:' + createHash('sha256').update(Buffer.from(authored, 'utf8')).digest('hex'));
  }
  expectChangedVersion(file: string, before: string): void {
    expect(this.driver.capture(file).version).not.toBe(this.driver.capture(file, this.driver.rememberedState(before)).version);
  }
  expectRememberedText(before: string, file: string, text: string): void {
    expect(this.driver.capture(file, this.driver.rememberedState(before)).source.text).toBe(text);
  }
  expectRememberedMapping(before: string, owner: string, authored: string, target: string): void {
    expect(this.driver.rememberedState(before).load.value?.locate(this.fileUrl(owner), authored)).toBe(this.fileUrl(target));
  }
  expectRememberedFieldType(before: string, module: string, field: string, expected: string): void {
    const { fact, types } = this.driver.fieldType(module, field, this.driver.rememberedState(before));
    this.expectType(fact, types, expected);
  }
  expectRememberedAcceptedCapture(before: string, file: string): void {
    expect(this.driver.capture(file, this.driver.rememberedState(before)).model).toBeDefined();
  }
  expectSameVersions(before: string): void {
    const versions = (state: LoadedWorkspace) => state.load.captures.map(capture => [capture.source.sourceId, capture.version]);
    expect(versions(this.driver.current)).toEqual(versions(this.driver.rememberedState(before)));
  }
  expectFreshModelIdentity(file: string, before: string): void {
    const current = this.driver.capture(file).model, previous = this.driver.capture(file, this.driver.rememberedState(before)).model;
    expect(current).toBeDefined(); expect(previous).toBeDefined(); expect(current).not.toBe(previous);
    expect(current!.roots()).toHaveLength(previous!.roots().length);
    expect(current!.roots().length).toBeGreaterThan(0);
    current!.roots().forEach((id, index) => expect(id).not.toBe(previous!.roots()[index]));
  }
  async expectFilesUnchanged(): Promise<void> {
    expect(await this.driver.currentFiles()).toEqual([...this.driver.authored.keys()].sort());
    for (const [path, bytes] of this.driver.authored) expect(await this.driver.fileContents(path)).toEqual(bytes);
  }
}
