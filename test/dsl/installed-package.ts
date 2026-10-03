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
    expect(diagram.canaries.failures).toEqual([true, true, true]);
    expect(diagram.canaries.denied).toHaveLength(3);
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
