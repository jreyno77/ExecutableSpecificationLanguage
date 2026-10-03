import { expect, onTestFinished } from 'vitest';
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
  registerCountOutput(): Promise<void> { return this.driver.registerCountOutput(); }
  createCountReport(text: string, directory: string): Promise<void> { return this.driver.createCountReport(text, directory); }
  readCountReport(subject: string): Promise<void> { return this.driver.readCountReport(subject); }
  writeCountConsumer(title: string): Promise<void> { return this.driver.writeCountConsumer(title); }
  searchCountReport(): Promise<void> { return this.driver.searchCountReport(); }
  runPublicApiCheck(): Promise<void> { return this.check('concept StoreGame { capability saveGame(snapshot: Text) returns Nothing }'); }

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
