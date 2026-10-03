import { expect, onTestFinished } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { PackageDriver } from '../driver/installed-package.js';

/** Consumer intentions and observations, independent of packaging and process mechanics. */
export class PackageExamples {
  private readonly driver = new PackageDriver();
  constructor() { onTestFinished(() => this.driver.dispose()); }
  static prepare(): Promise<void> { return PackageDriver.prepare(); }
  static finish(): Promise<void> { return PackageDriver.finish(); }
  installCurrentPackage(): Promise<void> { return this.driver.install(); }
  applyWriteAfterNativeReplacement(input: { library: string; before: string; after: string; file: string; text: string }): Promise<void> {
    return this.driver.applyWriteAfterNativeReplacement(input);
  }
  expectExternalNativeChangeStopsWrite(file: string, before: string, after: string): void {
    this.expectConsumerRan();
    const native = this.driver.report.nativeInputs!;
    expect(native.complete).toBe(true); expect(native.problems).toEqual([]);
    expect(native.receipt.status).toBe('stopped');
    expect(native.receipt.problems).toContainEqual(expect.objectContaining({ code: 'stale-project' }));
    expect(native.receipt.outcomes).toMatchObject([{ change: { kind: 'write', path: file }, state: 'not-applied',
      before: [{ path: file, state: 'absent' }], after: [{ path: file, state: 'absent' }] }]);
    expect(native.targetExists).toBe(false);
    expect(native.before).toBe(before); expect(native.after).toBe(after);
    expect(native.evidence).toHaveLength(1);
    expect(native.evidence[0]).toEqual({ uri: native.actualUri, version: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(native.laterVersion).not.toBe(native.evidence[0]!.version);
    expect(native.editable).not.toContain(native.actualUri);
    expect(native.handwritten).toBe('Keep this handwritten note.');
  }
  compileWorkspace(files: Record<string, string>, entries: string[]) { return this.driver.compileWorkspace(files, entries); }
  expectWorkspaceFunctions(names: string[]) {
    this.expectConsumerRan(); expect(this.driver.report.workspace?.functions).toEqual(names);
  }
  expectSharedWorkspaceType(name: string, parameters: number) {
    const workspace = this.driver.report.workspace!;
    expect(workspace.books).toEqual([name]); expect(workspace.parameters).toBe(parameters);
    expect(workspace.bothParametersUseBook).toBe(true); expect(workspace.bookIdentityRecords).toBe(1);
  }
  provideLocalLibraryAndNativeRegistry() { return this.driver.provideDependencies(); }
  installConfiguredStorage() { return this.driver.acquireDependencies('install'); }
  loadAcquiredLibrary(source: string) { return this.driver.acquireDependencies('compile', source); }
  expectAcquiredFieldType(name: string, type: string) {
    this.expectConsumerRan(); expect(this.driver.report.acquisition?.problems).toEqual([]); expect(this.driver.report.acquisition?.syntax).toEqual([]);
    expect(this.driver.report.acquisition?.fields).toContainEqual({ name, type });
  }
  expectSelectedAndInstalledStorage(version: string) {
    this.expectConsumerRan(); const packages = this.driver.report.acquisition?.packages;
    expect(packages).toEqual({ value: [{ name: 'npm:example-storage', version }], packages: [{ name: 'npm:example-storage', requested: '^2', selected: version, installed: version }], problems: [], deferred: [] });
  }
  expectNoLibraryModuleInWorkspaceOwnership() {
    const report = this.driver.report.acquisition!;
    expect(report.libraryOrigins).toHaveLength(2); expect(report.workspace).toHaveLength(1);
    expect(report.workspace![0]).toMatch(/\/main\.expec$/);
    expect(report.libraryOrigins!.every(source => source.includes('/libraries/books/'))).toBe(true);
    expect(report.libraryOrigins!.some(source => report.workspace!.includes(source))).toBe(false);
  }
  installPackageWithoutFile(path: string): Promise<void> { return this.driver.install({ withoutFile: path }); }
  installPackageWithoutDependency(name: string): Promise<void> { return this.driver.install({ withoutDependency: name }); }
  check(text: string): Promise<void> { return this.driver.check(text); }
  checkTypeScriptConsumer(): Promise<void> { return this.driver.checkTypeScript(); }
  changeProjectFile(before: string, after: string): Promise<void> { return this.driver.writeProject(before, after); }
  diagramProject(source: string): Promise<void> { return this.driver.diagramProject(source); }
  registerCountOutput(): Promise<void> { return this.driver.registerCountOutput(); }
  createCountReport(text: string, directory: string): Promise<void> { return this.driver.createCountReport(text, directory); }
  readCountReport(subject: string): Promise<void> { return this.driver.readCountReport(subject); }
  writeCountConsumer(title: string): Promise<void> { return this.driver.writeCountConsumer(title); }
  searchCountReport(): Promise<void> { return this.driver.searchCountReport(); }
  runPublicApiCheck(): Promise<void> { return this.check('concept StoreGame { capability saveGame(snapshot: Text) returns Nothing }'); }

  captureNativeDependencies(packages: Record<string, string>): Promise<void> { return this.driver.captureNativeDependencies(packages); }
  expectInstalledMethodConsumer(file: string, name: string): void {
    this.expectConsumerRan();
    const native = this.driver.report.nativeContext!, text = native.files[file]!, start = text.indexOf(name);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(native.complete).toBe(true); expect(native.problems).toEqual([]);
    expect(native.search.problems).toEqual([]);
    expect(native.search.incoming).toMatchObject({ unresolved: [], coverage: { complete: true, limitations: [] } });
    expect(native.search.outgoing).toMatchObject({ unresolved: [], coverage: { complete: true, limitations: [] } });
    expect(native.search.incoming.uses).toContainEqual({ target: { kind: 'project', id: expect.any(String) },
      at: { outputId: 'native', format: 'typescript-site-1', value: {
        file, version: native.versions[file], start, end: start + name.length, role: 'call',
      } },
    });
  }
  expectReadOnlyNativeEvidence(path: string): void {
    const native = this.driver.report.nativeContext!;
    expect(native.readonly).toContainEqual({ path, version: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(native.editable).not.toContain(path);
    expect(native.packages).toEqual({ vitest: '5.0.2', '@types/node': '24.13.6' });
    expect(native.capturedText).toBe(native.originalText);
    expect(native.diskText).toBe(native.originalText + '\n// Installed consumer changes consulted evidence.\n');
  }
  expectChangedNativeEvidenceStopsWrite(path: string): void {
    const native = this.driver.report.nativeContext!;
    expect(native.receipt.status).toBe('stopped');
    expect(native.receipt.problems).toContainEqual(expect.objectContaining({ code: 'stale-project' }));
    expect(native.receipt.outcomes.some(outcome => outcome.state === 'applied')).toBe(false);
    expect(native.notesExist, 'No prepared ' + path + ' write should have happened.').toBe(false);
  }
  initializeProject(root: string, target: string): Promise<void> { return this.driver.initializeProject(root, target); }
  expectInstalledInitialization(paths: string[]): void {
    this.expectConsumerRan();
    const observed = this.driver.report.initialization!;
    expect(observed.prepared.problems).toEqual([]);
    expect(observed.prepared.value?.changes.map(change => change.kind === 'move' ? change.to : change.path)).toEqual(paths);
    expect(observed.result).toMatchObject({ status: 'applied', problems: [], deferred: [], write: { status: 'applied', problems: [] } });
    expect(observed.connectedRoot?.path).toBe(observed.selectedRoot?.actual);
    expect(observed.result?.createdRoot).toBe(observed.selectedRoot?.requested);
    expect(observed.snapshot).toMatchObject({ complete: true, problems: [], excluded: [] });
    expect(observed.snapshot?.files.map(file => file.path).sort()).toEqual([...paths].sort());
    expect(observed.snapshot?.files).toContainEqual({ path: 'src/index.ts', text: 'export {};\n' });
    expect(observed.beforeBuildEntries?.sort()).toEqual(['.gitignore', 'package.json', 'src', 'tsconfig.json']);
    expect(JSON.parse(observed.manifest)).toEqual({ formatVersion: 1, version: '0.1.0', build: { entries: ['store.expec'] } });
  }
  expectInstalledToolchainAcquired(name: string, version: string): void {
    const observed = this.driver.report.initialization!;
    expect(observed.acquisition).toMatchObject({ problems: [], deferred: [],
      packages: [{ name: 'npm:' + name, requested: version, selected: version, installed: version }] });
    expect(observed.result?.value?.configuration.packages).toEqual([
      { alias: name, name: 'npm:' + name, version, phases: ['build'] },
    ]);
  }
  expectInstalledStarterBuild(version: string): void {
    const observed = this.driver.report.initialization!;
    expect(observed.typescript?.version).toBe(version);
    expect(this.driver.compilerInsideProject).toBe(true);
    expect(observed.build?.code, observed.build?.output).toBe(0);
    expect(observed.emitted).toEqual({ 'dist/index.js': 'export {};\n', 'dist/index.d.ts': 'export {};\n' });
  }

  generateTypeScript(source: string, validConsumer: string, invalidConsumer: string, revised: string): Promise<void> {
    return this.driver.generateTypeScript(source, validConsumer, invalidConsumer, revised);
  }
  expectInstalledTypeScriptScaffold(message: string): void {
    this.expectConsumerRan();
    const observed = this.driver.report.typescriptOutput!;
    expect(observed.written).toMatchObject({ problems: [], receipt: { status: 'applied', problems: [] } });
    expect(observed.validDiagnostics).toEqual([]);
    expect(observed.runtime).toEqual({ name: 'Error', message });
    expect(observed.notes).toBe('Keep the deployment note.');
    expect(observed.typescript.version).toBe('5.9.3');
    expect(this.driver.typescriptInsideConsumer).toBe(true);
  }
  expectInvalidNativeArgument(text: string): void {
    expect(this.driver.report.typescriptOutput?.invalidDiagnostics).toEqual([
      { code: 2345, file: 'invalid.mts', text, message: "Argument of type 'number' is not assignable to parameter of type 'string'." },
    ]);
  }
  expectHandwrittenNativeFileProtected(): void {
    const observed = this.driver.report.typescriptOutput!;
    expect(observed.update?.problems).toContainEqual(expect.objectContaining({ code: 'output-conflict' }));
    expect(observed.update?.receipt).toBeUndefined();
    expect(observed.after).toBe(observed.handwritten);
    expect(observed.after).toContain('// Keep the handwritten retry rationale.');
    expect(observed.baseline).toBe(observed.source);
    expect(observed.baseline).not.toContain('handwritten retry rationale');
    expect(observed.stateAfter).toBe(observed.stateBefore);
  }

  readTypeScriptProject(files: Record<string, string>): Promise<void> { return this.driver.readTypeScriptProject(files); }
  expectInstalledProjectFile(file: string, text: string): void {
    this.expectConsumerRan();
    const observed = this.driver.report.projectReading!;
    expect(observed.read.problems).toEqual([]);
    expect(observed.read.artifacts).toContainEqual(expect.objectContaining({ file, text }));
    expect(observed.files[file]).toBe(text);
    expect(observed.read.coverage).toMatchObject({ complete: true, limitations: [] });
  }
  expectInstalledProjectConsumer(file: string, text: string, within: string, role: string): void {
    const observed = this.driver.report.projectReading!, source = observed.files[file]!;
    const context = source.indexOf(within), start = source.indexOf(text, context);
    expect(context).toBeGreaterThanOrEqual(0);
    expect(start).toBeGreaterThanOrEqual(context);
    expect(observed.search.problems).toEqual([]);
    expect(observed.search.definitions).toContainEqual(expect.objectContaining({
      format: 'typescript-site-1', value: expect.objectContaining({ file: 'store.ts', role: 'definition' }),
    }));
    expect(observed.search.incoming.uses).toContainEqual({
      target: { kind: 'project', id: expect.any(String) },
      at: { outputId: 'typescript', format: 'typescript-site-1',
        value: { file, version: observed.versions[file], start, end: start + text.length, role } },
    });
    expect(observed.search.incoming).toMatchObject({ unresolved: [], coverage: { complete: true, limitations: [] } });
  }
  expectRuntimeTypeScriptInstalled(version: string): void {
    expect(this.driver.report.projectReading?.typescript.version).toBe(version);
    expect(this.driver.typescriptInsideConsumer).toBe(true);
  }

  documentProject(source: string, note: string): Promise<void> { return this.driver.documentProject(source, note); }
  expectInstalledDocumentation(path: string, parts: string[]): void {
    this.expectConsumerRan();
    const docs = this.driver.report.documentation!;
    expect(docs.written).toMatchObject({ problems: [], receipt: { status: 'applied', problems: [] } });
    expect(docs.read.problems).toEqual([]);
    expect(docs.read.coverage).toMatchObject({ complete: true, limitations: [] });
    const artifact = docs.read.artifacts.find(item => item.path === path);
    expect(artifact, 'The installed output must return the whole current document.').toBeDefined();
    expect(artifact!.text).toBe(artifact!.disk);
    for (const part of parts) expect(artifact!.text).toContain(part);
    expect(artifact!.text).not.toContain('Tests passed');
  }
  expectInstalledDocumentConsumer(file: string, definition: string): void {
    const search = this.driver.report.documentation!.search;
    expect(search.problems).toEqual([]);
    expect(search.definitions).toContainEqual(expect.objectContaining({ value: expect.objectContaining({ path: definition }) }));
    expect(search.incoming).toMatchObject({ unresolved: [], coverage: { complete: true, limitations: [] } });
    expect(search.incoming.uses).toContainEqual({
      target: { kind: 'project', id: file },
      at: { outputId: 'markdown', format: 'markdown-link', value: { path: file, offset: 0 } },
    });
  }

  expectInstalledPackageUsed(): void {
    expect(this.driver.location.insidePackage).toBe(true);
    expect(this.driver.location.real).toBe(this.driver.location.expected);
  }
  expectProblem(code: string, text: string): void {
    this.expectConsumerRan();
    expect(this.driver.report.problems).toContainEqual(expect.objectContaining({ code, text }));
  }
  expectNoAcceptedSpecification(): void { this.expectConsumerRan(); expect(this.driver.report.accepted).toBe(false); }
  expectDeclarationsAccepted(): void {
    expect(this.driver.declarations.code, this.driver.declarations.stdout + this.driver.declarations.stderr).toBe(0);
  }
  expectSpecificationAccepted(): void {
    this.expectConsumerRan();
    this.expectInstalledPackageUsed();
    expect(this.driver.report).toMatchObject({ accepted: true, syntax: [], problems: [], deferred: [] });
  }
  expectCapabilities(names: string[]): void { expect(this.driver.report.capabilities).toEqual(names); }
  expectSourceLoaded(names: string[]): void {
    expect(this.driver.report.loaded).toEqual({ accepted: true, captures: 1, capabilities: names, problems: [], syntax: [] });
  }
  expectProjectFileChanged(before: string, after: string): void {
    this.expectConsumerRan();
    expect(this.driver.report.writing).toEqual({ status: 'applied', problems: [], outcomes: ['applied'],
      before: [before], file: after, handwritten: 'handwritten', markerPresent: false });
  }
  expectDomainFailures(operation: string, result: string, expected: { family: string; codes: string[]; payload: string[] }[]): void {
    expect(this.driver.report.domainFailures).toEqual([{ operation, result, code: expected, documented: expected,
      sameDeclaration: true, fieldsAgree: true, earlierUnchanged: true }]);
  }
  expectCheckedCalls(names: string[]): void { expect(this.driver.report.operations).toEqual(names); }
  expectTestBody(name: string, calls: string[], statements: string[]): void {
    expect(this.driver.report.bodies).toEqual([{ name, generation: calls, documentation: calls, statements, earlierUnchanged: true }]);
  }
  expectCapturedSteps(expected: { available: { name: string; type: string }[]; capture?: { name: string; type: string } }[]): void {
    expect(this.driver.report.steps).toEqual(expected);
  }
  expectDeclarationCounts(expected: { concepts: number; recordTypes: number; capabilities: number }): void {
    expect(this.driver.countReports.create?.counts).toMatchObject(expected);
  }
  expectCountReportWritten(status: string): void {
    const created = this.driver.countReports.create!;
    expect(created.write).toMatchObject({ problems: [], receipt: { status, problems: [], outcomes: [
      { state: 'applied', change: { kind: 'write', path: 'reports/counts.json' } },
    ] } });
    expect(created.handwritten).toBe('Keep my notes.');
    expect(created.write?.artifacts?.map(item => item.specId)).toEqual(created.counts?.subjects.map(item => item.id));
  }
  expectWholeCountReport(path: string, text: string): void {
    const read = this.driver.countReports.read?.read;
    expect(read?.problems).toEqual([]);
    expect(read?.artifacts).toHaveLength(1);
    expect(read?.artifacts[0]?.path).toBe(path);
    expect(read?.artifacts[0]?.text).toBe(read?.artifacts[0]?.disk);
    expect(read?.artifacts[0]?.text).toContain(text);
  }
  expectCountDefinition(path: string): void {
    expect(this.driver.countReports.search?.search?.definitions).toContainEqual(expect.objectContaining({ value: expect.objectContaining({ path }) }));
  }
  expectCountConsumer(path: string, title: string): void {
    expect(this.driver.countReports.search?.search?.incoming.uses).toContainEqual({ target: { kind: 'project', id: title },
      at: { outputId: 'declaration-count', format: 'declaration-count-1', value: { path } } });
  }
  expectCompleteCountCoverage(scope: string): void {
    const search = this.driver.countReports.search?.search;
    expect(search?.problems).toEqual([]);
    for (const direction of ['incoming', 'outgoing'] as const) {
      expect(search?.[direction].coverage).toEqual({ complete: true, limitations: [],
        scope: [{ outputId: 'declaration-count', format: 'declaration-count-1', value: scope }] });
      expect(search?.[direction].unresolved).toEqual([]);
    }
  }
  expectInstalledDiagramFiles(paths: string[]): void {
    this.expectConsumerRan();
    const diagram = this.driver.report.diagram!;
    expect(diagram.written).toMatchObject({ problems: [], receipt: { status: 'applied', problems: [] } });
    expect(diagram.read.problems).toEqual([]);
    expect([...new Set(diagram.read.artifacts.map(file => file.path))].sort()).toEqual([...paths].sort());
    for (const file of diagram.read.artifacts) expect(file.text).toBe(file.disk);
  }
  expectInstalledNativeSignature(owner: string, signature: string): void {
    const native = this.driver.report.diagram!.native.find(shape => shape.label === owner || shape.label.endsWith('\n' + owner));
    expect(native?.methods?.map(method => method.name + ' → ' + method.return)).toContain(signature);
  }
  expectInstalledSvgLabel(label: string): void {
    const svg = this.driver.report.diagram!.read.artifacts.find(file => file.path.endsWith('.svg'))!;
    const document = new DOMParser({ onError: (_level, message) => { throw Error(message); } }).parseFromString(svg.text, 'image/svg+xml');
    expect(document.documentElement?.localName).toBe('svg');
    expect(document.documentElement?.textContent).toContain(label);
  }
  expectInstalledDiagramCoverage(): void {
    const search = this.driver.report.diagram!.search;
    expect(search.problems).toEqual([]);
    expect(search.definitions.length).toBeGreaterThan(0);
    for (const direction of ['incoming', 'outgoing'] as const) {
      expect(search[direction].coverage).toMatchObject({ complete: true, limitations: [] });
      expect(search[direction].coverage.scope.length).toBeGreaterThan(0);
      expect(search[direction].unresolved).toEqual([]);
    }
  }
  expectOnlyInstalledDiagramResourcesUsed(): void {
    this.expectConsumerRan();
    const diagram = this.driver.report.diagram!;
    expect(diagram.canaries.failures).toEqual([true, true, true, true]);
    expect(diagram.canaries.denied).toHaveLength(4);
    expect(diagram.private).toBe('Keep private.');
    expect(diagram.guards.denied).toEqual([]);
    expect(diagram.guards.reads.length).toBeGreaterThan(0);
    for (const path of diagram.guards.reads) expect(this.driver.diagramResourceInsidePackage(path), path).toBe(true);
    expect(diagram.guards.workers.created).toBeGreaterThan(0);
    expect(diagram.guards.workers.exited).toBe(diagram.guards.workers.created);
  }
  expectConsumerFailedFor(missing: string): void {
    expect(this.driver.result.code).not.toBe(0);
    expect(this.driver.report.error?.code).toBe('ERR_MODULE_NOT_FOUND');
    if (missing.endsWith('.js')) expect(new URL(this.driver.report.error!.url!).pathname.split('/').at(-1)).toBe(missing);
    else expect(this.driver.report.error?.message).toContain(`Cannot find package '${missing}'`);
    this.expectInstalledPackageUsed();
  }
  private expectConsumerRan(): void {
    expect(this.driver.result.code, this.driver.result.stdout + this.driver.result.stderr).toBe(0);
    expect(this.driver.report.error).toBeUndefined();
  }
}
