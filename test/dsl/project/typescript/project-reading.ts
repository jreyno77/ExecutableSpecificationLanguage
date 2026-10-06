import fs from 'node:fs';
import { join, relative, isAbsolute, sep } from 'node:path';
import { expect, onTestFinished } from 'vitest';
import type { ArtifactLocator, ObservedRelationship, ProjectSnapshot, RelationshipObservation } from '../../../../src/index.js';
import { ProjectReadingDriver, type Selector, type Occurrence, type Site } from '../../../driver/project/typescript/project-reading.js';

export class ProjectReading {
  private constructor(private readonly driver: ProjectReadingDriver) { onTestFinished(() => driver.dispose()); }
  static async create(options: { configFile?: string; excludeNames?: readonly string[] } = {}): Promise<ProjectReading> {
    const driver = new ProjectReadingDriver(options); await driver.initialize(options.excludeNames); return new ProjectReading(driver);
  }
  async files(input: Record<string, string>): Promise<void> { for (const [path, text] of Object.entries(input)) await this.driver.file(path, text); }
  fileBytes(path: string, bytes: number[]): Promise<void> { return this.driver.file(path, Uint8Array.from(bytes)); }
  edit(path: string, text: string): Promise<void> { return this.driver.file(path, text); }
  outsideCaptureFile(path: string, text: string): Promise<void> { return this.driver.file(path, text); }
  associateSymbol(id: string, file: string, declaration: Selector[]): void { this.driver.associate(id, file, declaration); }
  associateFile(id: string, file: string): void { this.driver.associate(id, file); }
  associateSymbolFromSpecification(name: string, file: string, declaration: Selector[]): void { this.associateSymbol(this.driver.id(name), file, declaration); }
  specification(text: string): void { this.driver.specification(text); }
  read(id: string): Promise<void> { return this.driver.read(id); }
  search(id: string): Promise<void> { return this.driver.search(id); }
  searchSpecified(name: string): Promise<void> { return this.search(this.driver.id(name)); }
  capture(): Promise<ProjectSnapshot> { return this.driver.capture(); }
  captureNativeDependencies(): void { this.driver.nativeDependencies(); }
  searchSnapshot(id: string, snapshot: ProjectSnapshot): void { this.driver.searchSnapshot(id, snapshot); }
  captureWithReadFailure(path: string): Promise<ProjectSnapshot> { return this.driver.readFailure(path); }
  searchWithProjectFilesystemReadsForbidden(id: string): Promise<void> { return this.driver.guardedSearch(id); }
  rememberRead(name: string): void { this.driver.reads.set(name, this.driver.readResult); }
  rememberSearch(name: string): void { this.driver.searches.set(name, this.driver.searchResult); }
  replaceCapturedBytesKeepingVersion(snapshot: ProjectSnapshot, path: string, text: string): void {
    const file = snapshot.files.find(file => file.path === path)!; Object.assign(file, { bytes: new TextEncoder().encode(text) });
  }
  mutateReturnedBytes(path: string): void { const artifact = this.driver.readResult.artifacts.find(artifact => artifact.file.path === path); expect(artifact, 'Read must return the requested file before caller mutation.').toBeDefined(); artifact!.file.bytes.fill(0); }
  expectReadFiles(paths: string[]): void { expect([...new Set(this.driver.readResult.artifacts.map(item => item.file.path))].sort()).toEqual([...paths].sort()); }
  expectExactFile(path: string, text: string): void { expect(new TextDecoder().decode(this.driver.readResult.artifacts.find(item => item.file.path === path)?.file.bytes)).toBe(text); }
  expectExactBytes(path: string, bytes: number[]): void { expect(Array.from(this.driver.readResult.artifacts.find(item => item.file.path === path)?.file.bytes ?? [])).toEqual(bytes); }
  expectRememberedFile(name: string, path: string, text: string): void { expect(new TextDecoder().decode(this.driver.reads.get(name)?.artifacts.find(item => item.file.path === path)?.file.bytes)).toBe(text); }
  expectFileVersionChanged(path: string, name: string): void { expect(this.driver.readResult.artifacts.find(item => item.file.path === path)?.file.version).not.toBe(this.driver.reads.get(name)?.artifacts.find(item => item.file.path === path)?.file.version); }
  expectReadComplete(): void { expect(this.driver.readResult.coverage.complete).toBe(true); expect(this.driver.readResult.problems).toEqual([]); }
  expectReadIncomplete(): void { expect(this.driver.readResult.coverage.complete).toBe(false); expect(this.driver.readResult.coverage.limitations.length).toBeGreaterThan(0); }
  expectDefinitions(expected: { file: string; declaration: string; line?: number }[]): void {
    expect(this.driver.searchResult.definitions.map(at => {
      const site = at.value as unknown as Site, text = this.driver.text(site.file);
      return { file: site.file, declaration: text.slice(site.start, site.end) };
    })).toEqual(expected.map(({ file, declaration }) => ({ file, declaration })));
    expected.forEach((item, index) => { if (item.line !== undefined) {
      const site = this.driver.searchResult.definitions[index]!.value as unknown as Site;
      expect(this.driver.text(site.file).slice(0, site.start).split('\n').length).toBe(item.line);
    } });
  }
  expectDefinitionLines(file: string, lines: number[]): void { expect(this.driver.searchResult.definitions.map(at => {
    const site = at.value as unknown as Site; expect(site.file).toBe(file); return this.driver.text(file).slice(0, site.start).split('\n').length;
  })).toEqual(lines); }
  expectNoDefinition(text: string): void { expect(this.driver.searchResult.definitions.some(at => { const site = at.value as unknown as Site; return this.driver.text(site.file).slice(site.start, site.end).includes(text); })).toBe(false); }
  expectNoDefinitionFrom(file: string): void { expect(this.driver.searchResult.definitions.some(at => (at.value as unknown as Site).file === file)).toBe(false); }
  private uses(direction: 'incoming' | 'outgoing', occurrence: Occurrence): readonly ObservedRelationship[] {
    const range = this.driver.range(occurrence);
    return this.driver.searchResult[direction].uses.filter(use => {
      const site = use.at.value as unknown as Site;
      return site.file === occurrence.file && site.start === range.start && site.end === range.end && (!occurrence.role || site.role === occurrence.role);
    });
  }
  expectIncomingAt(occurrence: Occurrence): void { expect(this.uses('incoming', occurrence), JSON.stringify(occurrence)).not.toEqual([]); }
  expectNoIncomingAt(occurrence: Occurrence): void { expect(this.uses('incoming', occurrence)).toEqual([]); }
  expectIncomingFrom(id: string, occurrence: Occurrence): void { expect(this.uses('incoming', occurrence).map(use => use.target)).toContainEqual({ kind: 'specified', id }); }
  expectOutgoingTo(id: string, occurrence: Occurrence): void { expect(this.uses('outgoing', occurrence).map(use => use.target)).toContainEqual({ kind: 'specified', id }); }
  expectProjectOnlyIncoming(occurrence: Occurrence): void { expect(this.uses('incoming', occurrence).map(use => use.target.kind)).toContain('project'); }
  expectProjectOnlyOutgoing(occurrence: Occurrence): void { expect(this.uses('outgoing', occurrence).map(use => use.target.kind)).toContain('project'); }
  expectNativeTarget(expected: { file: string; declaration: string }, occurrence: Occurrence): void {
    expect(this.driver.snapshot.readOnlyFiles?.some(file => file.path === expected.file)).toBe(true);
    expect(this.uses('outgoing', occurrence).some(use => {
      if (use.target.kind !== 'project') return false;
      const target = JSON.parse(use.target.id) as { file: string; start: number; end: number };
      return target.file === expected.file && this.driver.text(target.file).slice(target.start, target.end) === expected.declaration;
    })).toBe(true);
  }
  expectIncomingUses(expected: never[]): void { expect(this.driver.searchResult.incoming.uses).toEqual(expected); }
  expectOutgoingUses(expected: never[]): void { expect(this.driver.searchResult.outgoing.uses).toEqual(expected); }
  expectNoOutgoingTo(id: string): void { expect(this.driver.searchResult.outgoing.uses.filter(use => use.target.id === id)).toEqual([]); }
  expectNoOutgoingLocal(name: string): void { expect(this.driver.searchResult.outgoing.uses.filter(use => {
    const site = use.at.value as unknown as Site; return this.driver.text(site.file).slice(site.start, site.end) === name;
  })).toEqual([]); }
  expectNoGuessedSpecifiedTarget(): void { expect(this.driver.searchResult.outgoing.uses.filter(use => use.target.kind === 'specified')).toEqual([]); }
  expectNoProjectOnlyTargetForImportedAlias(name: string): void { expect(this.driver.searchResult.outgoing.uses.filter(use => {
    const site = use.at.value as unknown as Site; return use.target.kind === 'project' && this.driver.text(site.file).slice(site.start, site.end) === name;
  })).toEqual([]); }
  private unresolved(direction: 'incoming' | 'outgoing', file: string, text: string): void {
    const range = this.driver.range({ file, text });
    expect(this.driver.searchResult[direction].unresolved).toContainEqual(expect.objectContaining({ at: expect.objectContaining({ format: 'typescript-site-1', value: expect.objectContaining({ file, ...range, role: 'unresolved' }) }) }));
  }
  expectIncomingUnresolvedAt(file: string, text: string): void { this.unresolved('incoming', file, text); }
  expectOutgoingUnresolvedAt(file: string, text: string): void { this.unresolved('outgoing', file, text); }
  expectNoSingleCallTargetAt(file: string, text: string): void { const range = this.driver.range({ file, text }); expect(this.driver.searchResult.outgoing.uses.filter(use => {
    const site = use.at.value as unknown as Site; return site.file === file && site.role === 'call' && site.start >= range.start && site.end <= range.end;
  })).toEqual([]); }
  private complete(observation: RelationshipObservation): void { expect(observation.coverage.complete, JSON.stringify(this.driver.searchResult.problems)).toBe(true); expect(observation.coverage.limitations).toEqual([]); expect(observation.unresolved).toEqual([]); expect(observation.coverage.scope.some(at => at.format === 'typescript-scope-1')).toBe(true); }
  expectSearchCompleteWithinDeclaredScope(): void { this.complete(this.driver.searchResult.incoming); this.complete(this.driver.searchResult.outgoing); }
  expectOutgoingCompleteWithinDeclaredScope(): void { this.complete(this.driver.searchResult.outgoing); }
  expectIncomingIncomplete(): void { expect(this.driver.searchResult.incoming.coverage.complete).toBe(false); }
  expectOutgoingIncomplete(): void { expect(this.driver.searchResult.outgoing.coverage.complete).toBe(false); }
  expectSearchIncomplete(): void { this.expectIncomingIncomplete(); this.expectOutgoingIncomplete(); }
  private problems() { return this.driver.searchResult?.problems ?? this.driver.readResult.problems; }
  expectProblem(code: string): void { expect(this.problems().map(problem => problem.code)).toContain(code); }
  expectNoProblem(code: string): void { expect(this.problems().map(problem => problem.code)).not.toContain(code); }
  expectProblemAtFile(code: string, file: string): void { expect(this.problems()).toContainEqual(expect.objectContaining({ code, at: expect.objectContaining({ kind: 'dependency', path: expect.arrayContaining([file]) }) })); }
  expectNoMappingProblem(): void { expect(this.driver.searchResult.problems.filter(problem => !problem.code.startsWith('typescript-'))).toEqual([]); }
  expectNativeProblemAt(code: number, file: string, text: string): void {
    const range = this.driver.range({ file, text });
    expect(this.driver.searchResult.problems).toContainEqual(expect.objectContaining({ code: 'typescript-' + code,
      at: { kind: 'dependency', path: ['typescript', file, range.start, range.end - range.start] } }));
  }
  expectNoNativeProblems(): void { expect(this.driver.searchResult.problems.filter(problem => /^typescript-\d+$/.test(problem.code))).toEqual([]); }
  expectNoNativeDiagnosticFrom(file: string): void { expect(this.driver.searchResult.problems.filter(problem => problem.at.kind === 'dependency' && problem.at.path.includes(file))).toEqual([]); }
  private scope() { const at = this.driver.searchResult.incoming.coverage.scope.find(at => at.format === 'typescript-scope-1'); expect(at, 'Search must disclose its actual TypeScript scope.').toBeDefined(); return at!.value as unknown as { files: string[]; excluded: string[]; configFile: string | null }; }
  expectScopeFiles(files: string[]): void { expect(this.scope().files).toEqual(files); }
  expectConfiguredExclusion(file: string): void { expect(this.scope().excluded).toContain(file); }
  expectNoDefaultProfileSubstitution(): void { expect(this.scope().configFile).not.toBeNull(); }
  expectNoAmbientProjectFileReads(): void { for (const path of this.driver.diskReads) { const part = relative(this.driver.libraryRoot, path); expect(isAbsolute(part) || part.startsWith('..') || part.includes(sep)).toBe(false); } }
  expectLibraryResourcesConfinedToPinnedTypeScript(): void { expect(this.driver.diskReads.length, 'A fresh configured reader must expose its actual library-resource reads.').toBeGreaterThan(0); this.expectNoAmbientProjectFileReads(); for (const path of this.driver.diskReads) expect(path).toMatch(/lib(?:\.[\w.-]+)?\.d\.ts$/); }
  expectNoLibraryFileAsProjectArtifact(): void { expect(this.scope().files.some(path => path.includes('typescript/lib'))).toBe(false); }
  expectOriginalSnapshotProblem(code: string, path: string): void { expect(this.driver.searchResult.problems).toContainEqual(this.driver.originalProblem); expect(this.driver.originalProblem.code).toBe(code); expect(this.driver.originalProblem.at.kind === 'dependency' && this.driver.originalProblem.at.path.includes(path)).toBe(true); }
  expectIncomingUtf16Slice(file: string, text: string, part: { within: string; role: string }): void { this.expectIncomingAt({ file, text, ...part }); }
  expectSitesUseCapturedFileVersion(file: string): void { const expected = this.driver.snapshot.files.find(item => item.path === file)!.version; const sites = this.driver.searchResult.incoming.uses.map(use => use.at.value as unknown as Site).filter(site => site.file === file); expect(sites.length).toBeGreaterThan(0); expect(sites.every(site => site.version === expected)).toBe(true); }
  expectRememberedIncomingAt(name: string, file: string, text: string): void { const source = new TextDecoder().decode(this.driver.originals.get(file)), start = source.indexOf(text); expect(this.driver.searches.get(name)?.incoming.uses.some(use => { const site = use.at.value as unknown as Site; return site.file === file && site.start >= start && site.end <= start + text.length; })).toBe(true); }
  expectNoRuntimeExecutionClaim(): void { expect(this.driver.searchResult.incoming.uses.map(use => (use.at.value as unknown as Site).role)).toEqual(expect.arrayContaining(['type', 'construct', 'call'])); expect(JSON.stringify(this.driver.searchResult)).not.toContain('executed'); }
  expectProjectUnchanged(): void { for (const [path, bytes] of this.driver.originals) expect(Array.from(fs.readFileSync(join(this.driver.directory, path)))).toEqual(Array.from(bytes)); }
  expectAssociationsUnchanged(): void { expect(JSON.stringify(this.driver.associations)).toBe(this.driver.stateBefore); }
  expectProjectAndAssociationsUnchanged(): void { this.expectProjectUnchanged(); this.expectAssociationsUnchanged(); }
  expectNoNewSpecificationIdentities(): void { this.expectAssociationsUnchanged(); }
  expectProjectAndSpecificationUnchanged(): void { this.expectProjectUnchanged(); expect(JSON.stringify(this.driver.current.baseline)).toBe(this.driver.specificationBefore); }
  reconcileOutgoingWith(names: string[]): void { this.driver.reconcile(names); }
  expectMatched(names: string[]): void { expect(this.driver.compared.matched.map(item => item.id)).toEqual(names.map(name => this.driver.id(name))); }
  expectUnobserved(names: string[]): void { expect(this.driver.compared.unobserved).toEqual(names.map(name => this.driver.id(name))); }
  expectObservedOnlyAt(file: string, text: string): void { const range = this.driver.range({ file, text }); expect(this.driver.compared.observedOnly.some(use => { const site = use.at.value as unknown as Site; return site.file === file && site.start >= range.start && site.end <= range.end; })).toBe(true); }
}
