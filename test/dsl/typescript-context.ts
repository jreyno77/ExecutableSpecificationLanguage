import fs from 'node:fs';
import { expect } from 'vitest';
import type { Diagnostic, ArtifactLocator, ProjectSnapshot } from '../../src/index.js';
import { NativeContextDriver } from '../driver/typescript-context.js';

export class NativeContextExamples {
  private static readonly active: NativeContextExamples[] = [];
  private readonly driver = new NativeContextDriver();
  static async connect(): Promise<NativeContextExamples> {
    const example = new NativeContextExamples(); this.active.push(example); await example.driver.connect(); return example;
  }
  static async clean(): Promise<void> { for (const example of this.active.splice(0)) await example.driver.dispose(); }
  static async catalogProjectWithoutImports(): Promise<NativeContextExamples> {
    const project = await this.connect();
    await project.package('catalog', { types: 'index.d.ts' }, { 'index.d.ts': 'export interface Book { title: string }' });
    return project;
  }
  static async catalogProjectWithImport(): Promise<NativeContextExamples> {
    const project = await this.catalogProjectWithoutImports();
    await project.file('src/use.ts', 'import type { Book } from "catalog"; export type Title = Book["title"];'); return project;
  }
  file(path: string, text: string): Promise<void> { return this.driver.file(path, text); }
  package(name: string, metadata: object, entries: Record<string, string>): Promise<void> { return this.driver.package(name, metadata, entries); }
  installNativePackages(packages: Record<string, string>): Promise<void> { return this.driver.install(packages); }
  selectMethod(id: string, file: string, owner: string, name: string): void { this.driver.select(id, file, [{ kind: 'class', name: owner }, { kind: 'method', name, static: false }]); }
  selectClass(id: string, file: string, name: string): void { this.driver.select(id, file, [{ kind: 'class', name }]); }
  capture(options?: { configFile?: string; imports?: readonly string[] }): Promise<void> { return this.driver.capture(options); }
  search(id: string): void { this.driver.search(id); }
  inspectNativeProgram(): void { this.driver.inspect(); }
  rememberCapture(): void { this.driver.remembered = structuredClone(this.driver.snapshot); }
  unrelatedBinLink(name: string): Promise<void> { return this.driver.unrelatedLink(name); }
  replacePackageWithExternalDirectoryLink(name: string): Promise<void> { return this.driver.externalLink(name); }
  async packageInParent(name: string, metadata: object, entries: Record<string, string>): Promise<void> {
    await this.driver.file('../node_modules/' + name + '/package.json', JSON.stringify({ name, version: '1.0.0', ...metadata }));
    for (const [path, text] of Object.entries(entries)) await this.driver.file('../node_modules/' + name + '/' + path, text);
  }
  denyProcessesNetworkAndParentReads(): void { this.driver.denyReads('parent'); }
  denyRuntimeAssetReadsAndExecution(): void { this.driver.denyReads('runtime'); }
  withUnreadableFile(path: string, action: () => Promise<void>): Promise<void> { return this.driver.unreadable(path, action); }
  prepareChanges(changes: ({ write: string; text: string } | { remove: string })[]): void { this.driver.prepare(changes); }
  applyWithCapturedContext(): Promise<void> { return this.driver.apply(true); }
  applyWithUndecoratedContext(): Promise<void> { return this.driver.apply(false); }
  afterActualWrite(after: string, change: { write: string; text: string }): void { this.driver.afterWrite(after, change); }
  async changePackageTypesEntrypoint(name: string, path: string, text: string): Promise<void> {
    await this.package(name, { types: path }, { [path]: text });
  }
  async attemptPackageWrite(path: string, text: string): Promise<void> { this.prepareChanges([{ write: path, text }]); await this.applyWithCapturedContext(); }
  expectCaptureComplete(): void { expect(this.driver.snapshot.problems).toEqual([]); expect(this.driver.snapshot.complete).toBe(true); }
  expectCaptureIncomplete(): void { expect(this.driver.snapshot.complete).toBe(false); expect(this.driver.snapshot.problems.length).toBeGreaterThan(0); }
  expectReadOnlyPath(path: string): void { expect(this.readOnly().map(file => file.path)).toContain(path); }
  expectNoReadOnlyPath(path: string): void { expect(this.readOnly().map(file => file.path)).not.toContain(path); }
  expectReadOnlyPackage(name: string): void { expect(this.readOnly().some(file => file.path.startsWith('node_modules/' + name + '/') && /\.d\.[cm]?ts$/.test(file.path))).toBe(true); }
  expectReadOnlyPaths(paths: string[]): void { expect(this.readOnly().map(file => file.path).sort()).toEqual([...paths].sort()); }
  expectNoDependencyFilesInEditableCapture(): void { expect(this.driver.snapshot.files.some(file => file.path.split('/').includes('node_modules'))).toBe(false); }
  expectEachCapturedPathOnce(): void {
    const files = [...this.driver.snapshot.files, ...this.readOnly()];
    expect(new Set(files.map(file => file.path)).size).toBe(files.length);
    for (const file of files) expect(file.version).toBe(this.driver.hash(file.bytes));
  }
  expectCapturedPath(path: string): void { expect(this.driver.snapshot.files.map(file => file.path)).toContain(path); }
  expectCapturedText(path: string, text: string): void { expect(this.text(path)).toBe(text); }
  expectRememberedText(path: string, text: string): void { expect(this.text(path, this.driver.remembered)).toBe(text); }
  expectChangedReadOnlyVersion(path: string): void { expect(this.readOnly().find(file => file.path === path)?.version).not.toBe(this.readOnly(this.driver.remembered).find(file => file.path === path)?.version); }
  expectNoInventedDeclaration(name: string): void { expect(this.readOnly().some(file => Buffer.from(file.bytes).toString().includes(name))).toBe(false); }
  expectMissingNativeInput(name: string, file: string): void { this.problem('native-input-unavailable', file, name); }
  expectNativeReadFailureAt(path: string): void { this.problem('native-read-failed', path); }
  expectUnsupportedNativeLink(path: string): void { this.problem('unsupported-native-input', path); }
  expectNoMissingNativeInputs(): void { expect(this.driver.snapshot.problems.filter(problem => problem.code === 'native-input-unavailable')).toEqual([]); }
  expectNoForbiddenEffects(): void { expect(this.driver.forbidden).toEqual([]); }
  expectExternalTargetUnchanged(): void { expect(fs.readFileSync(this.driver.path('../external-package/index.d.ts'), 'utf8')).toBe(this.driver.externalBefore); }
  expectNativeCoverageComplete(): void { expect(this.nativeProblems()).toEqual([]); expect(this.coverages().every(coverage => coverage.complete)).toBe(true); }
  expectNativeCoverageIncomplete(): void { expect(this.coverages().some(coverage => !coverage.complete)).toBe(true); }
  expectNativeProblemAt(code: string, path: string, token: string): void {
    const found = this.nativeProblems().find(problem => problem.code === code && problem.at.kind === 'dependency' && problem.at.path[1] === path);
    expect(found, `Expected ${code} at ${path}: ${JSON.stringify(this.nativeProblems())}`).toBeDefined();
    if (found?.at.kind !== 'dependency') throw Error('Expected located native finding.');
    const start = found.at.path[2], length = found.at.path[3];
    expect(typeof start).toBe('number'); expect(typeof length).toBe('number');
    expect(this.text(path).slice(Number(start), Number(start) + Number(length))).toBe(token);
  }
  expectNativeRoots(paths: string[]): void {
    const scope = this.scope().find(at => at.format === 'typescript-scope-1');
    expect((scope?.value as { files: string[] }).files).toEqual(paths);
  }
  expectReadOnlyScopeVersion(path: string): void {
    const version = this.readOnly().find(file => file.path === path)?.version;
    expect(version).toBeTruthy();
    expect(this.scope().some(at => { const value = at.value as { file?: string; version?: string }; return value.file === path && value.version === version; })).toBe(true);
  }
  expectIncomingToken(file: string, token: string): void { expect(this.driver.found.incoming.uses.some(use => this.siteToken(use.at, file, token))).toBe(true); }
  expectNoIncomingFile(file: string): void { expect(this.driver.found.incoming.uses.some(use => (use.at.value as { file: string }).file === file)).toBe(false); }
  expectOutgoingReadOnlyTarget(expected: { token: string; packageDirectory: string }): void {
    expect(this.driver.found.outgoing.uses.some(use => {
      const at = use.at.value as { file: string };
      if (!this.siteToken(use.at, at.file, expected.token) || use.target.kind !== 'project') return false;
      const target = JSON.parse(use.target.id) as { file: string; start: number; end: number };
      return target.file.startsWith(expected.packageDirectory + '/') && this.readOnly().some(file => file.path === target.file)
        && this.text(target.file).slice(target.start, target.end) === 'globalExpect: ExpectStatic';
    }), JSON.stringify(this.driver.found.outgoing.uses)).toBe(true);
  }
  expectWriteStatus(status: string): void { expect(this.driver.receipt.status, JSON.stringify(this.driver.receipt.problems)).toBe(status); }
  expectStopped(code: string): void { this.expectWriteStatus('stopped'); expect(this.driver.receipt.problems.map(problem => problem.code)).toContain(code); }
  expectAppliedPaths(paths: string[]): void { expect(this.driver.receipt.outcomes.filter(outcome => outcome.state === 'applied').map(outcome => outcome.change.kind === 'move' ? outcome.change.from : outcome.change.path)).toEqual(paths); }
  expectNotAppliedPaths(paths: string[]): void { expect(this.driver.receipt.outcomes.filter(outcome => outcome.state === 'not-applied').map(outcome => outcome.change.kind === 'move' ? outcome.change.from : outcome.change.path)).toEqual(paths); }
  expectNoPath(path: string): void { expect(fs.existsSync(this.driver.path(path))).toBe(false); }
  expectActualText(path: string, text: string): void { expect(fs.readFileSync(this.driver.path(path), 'utf8')).toBe(text); }
  expectDependencyBytesUnchanged(): void { expect(this.driver.dependencyBefore.size).toBeGreaterThan(0); for (const [path, text] of this.driver.dependencyBefore) expect(fs.readFileSync(this.driver.path(path)).toString('hex')).toBe(text); }
  expectWriteRejectedBeforeMutation(): void { this.expectWriteStatus('stopped'); expect(this.driver.receipt.outcomes.every(outcome => outcome.state === 'not-applied')).toBe(true); expect(this.driver.receipt.problems.length).toBeGreaterThan(0); }
  expectNoSuccessfulDeliveryClaim(): void { this.expectWriteStatus('stopped'); expect(this.driver.receipt.problems.length).toBeGreaterThan(0); }
  private readOnly(snapshot = this.driver.snapshot) { return snapshot.readOnlyFiles ?? []; }
  private text(path: string, snapshot = this.driver.snapshot): string {
    const file = [...snapshot.files, ...this.readOnly(snapshot)].find(file => file.path === path);
    if (!file) throw Error('Expected captured file ' + path); return Buffer.from(file.bytes).toString();
  }
  private nativeProblems(): readonly Diagnostic[] { return this.driver.found?.problems ?? this.driver.read.problems; }
  private coverages() { return this.driver.found ? [this.driver.found.incoming.coverage, this.driver.found.outgoing.coverage] : [this.driver.read.coverage]; }
  private scope(): readonly ArtifactLocator[] { return this.coverages().flatMap(coverage => coverage.scope); }
  private siteToken(at: ArtifactLocator, file: string, token: string): boolean {
    const value = at.value as { file: string; start: number; end: number };
    return value.file === file && this.text(file).slice(value.start, value.end) === token;
  }
  private problem(code: string, path: string, message?: string): void {
    expect(this.driver.snapshot.problems.some(problem => problem.code === code && problem.at.kind === 'dependency'
      && problem.at.path.some(part => part === path || part === path.split('/').at(-1)) && (!message || problem.message.includes(message))), JSON.stringify(this.driver.snapshot.problems)).toBe(true);
  }
}
