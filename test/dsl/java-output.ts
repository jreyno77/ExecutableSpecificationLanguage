import { expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JavaOutputDriver } from '../driver/java-output.js';
import type { ProjectRead } from '../../src/index.js';

export class JavaExamples {
  private rememberedSearch: unknown;
  private retainedRead: ProjectRead | undefined;
  private static readonly instances: JavaExamples[] = [];
  private constructor(readonly driver: JavaOutputDriver) {}
  static async connect(): Promise<JavaExamples> {
    const example = new JavaExamples(new JavaOutputDriver()); this.instances.push(example); await example.driver.initialize(); return example;
  }
  static async dispose(): Promise<void> { for (const example of this.instances.splice(0)) await example.driver.dispose(); }
  async configureMissingJdk(): Promise<void> { await this.driver.configure(join(this.driver.directory, 'missing-jdk')); }
  async configureUnsupportedRelease(release: number): Promise<void> { await this.driver.configure(join(this.driver.directory, 'missing-jdk'), { release }); }
  file(path: string, text: string): Promise<void> { return this.driver.file(path, text); }
  capture(): Promise<void> { return this.driver.capture(); }
  rememberCapture(): void { this.driver.rememberCapture(); }
  replaceCatalogJar(source: string): Promise<void> { return this.driver.nativeCatalog(source); }
  searchUsingRememberedCapture(id: string): Promise<void> { return this.driver.searchRemembered(id); }
  readUsingRememberedCapture(id: string): Promise<void> { return this.driver.readRemembered(id); }
  readCurrentCapture(id: string): Promise<void> { return this.driver.readCaptured(id); }
  replaceCapturedSource(path: string, text: string): void { this.driver.replaceCapturedSource(path, text); }
  retainRead(): void { this.retainedRead = this.driver.readResult; }
  expectRetainedRead(path: string, text: string): void {
    const artifact = this.retainedRead?.artifacts.find(item => item.file.path === path);
    expect(artifact).toBeDefined(); expect(Buffer.from(artifact!.file.bytes).toString('utf8')).toBe(text);
    expect(this.retainedRead?.coverage.complete).toBe(true); expect(this.retainedRead?.problems).toEqual([]);
  }
  searchWhileCatalogChanges(id: string): Promise<void> { return this.driver.searchWhileCatalogChanges(id); }
  async expectFinishedNativeQueryAndCleanup(): Promise<void> {
    expect(this.driver.queryProcess).toMatchObject({ started: true, answered: true, changed: true, closed: true, mutationError: '' });
    const answer = JSON.parse(this.driver.queryProcess.output);
    expect(answer.declarations).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'store.Read' })]));
    expect(answer.uses).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'catalog.Book', member: { kind: 'field', name: 'title' } })]));
    await expect(fs.lstat(this.driver.queryProcess.scratch)).rejects.toMatchObject({ code: 'ENOENT' });
  }
  changeCatalogBeforeApplyingPlan(): void { this.driver.nativeWriteChange = 'before'; }
  changeCatalogAfterFirstWrite(): void { this.driver.nativeWriteChange = 'after-first'; }
  async expectNativeWriteStopped(applied: string[]): Promise<void> {
    expect(this.driver.nativeWriteChanged).toBe(true);
    expect(this.driver.written.receipt?.status).toBe('stopped');
    expect(this.driver.written.problems.some(problem => problem.code === 'stale-project')).toBe(true);
    const outcomes = this.driver.written.receipt!.outcomes;
    expect(outcomes.filter(item => item.state === 'applied').map(item => item.change.kind === 'move' ? item.change.to : item.change.path)).toEqual(applied);
    expect(outcomes.slice(applied.length).every(item => item.state === 'not-applied')).toBe(true);
    expect(this.driver.written.artifacts).toBeUndefined();
    expect(await this.driver.writtenFiles()).toEqual(applied);
  }
  installInspectionCanaries(): Promise<void> { return this.driver.inspectionCanaries(); }
  async expectNoExecutionCanaryEffects(): Promise<void> {
    expect(this.driver.executionCanaries).toHaveLength(3);
    for (const path of this.driver.executionCanaries) await expect(fs.lstat(path)).rejects.toMatchObject({ code: 'ENOENT' });
  }
  async installExternalSource(path: string, source: string): Promise<void> { await this.driver.nativeSource(path, source); await this.driver.nativeProject(); }
  expectExternalSourceTarget(type: string, field: string): void { this.expectExternalMember(type, { kind: 'field', name: field }, this.driver.externalSource); }
  async expectReadonlyIncoming(type: string, call: string, token: string): Promise<void> {
    const use = this.driver.searchResult.incoming.uses.find(use => use.at.format === 'java-external-symbol-1'
      && (use.at.value as { uri: string }).uri === pathToFileURL(this.driver.externalSource).href);
    expect(use, JSON.stringify(this.driver.searchResult)).toBeDefined();
    const at = use!.at.value as { type: string; start: number; length: number; owner: object };
    expect(at.type).toBe(type); expect(at.length).toBe(token.length);
    const text = await this.driver.externalSourceText();
    expect(at.start).toBe(text.indexOf(call) + call.indexOf(token)); expect(text.slice(at.start, at.start + at.length)).toBe(token);
    expect(use!.target).toEqual(at.owner);
  }
  useConflictingUpstreamEvidence(): Promise<void> { return this.driver.upstreamEvidence(true); }
  expectNativeEvidenceConflict(): void {
    expect(this.driver.snapshot.complete).toBe(false);
    expect(this.driver.snapshot.problems.some(problem => problem.code === 'native-input-changed' && problem.at.kind === 'dependency'
      && problem.at.path.some(part => typeof part === 'string' && part.endsWith('/release')))).toBe(true);
  }
  useUpstreamEvidence(): Promise<void> { return this.driver.upstreamEvidence(); }
  installNativeProfile(): Promise<void> { return this.driver.nativeProject(); }
  async installCatalogJar(source: string): Promise<void> { await this.driver.nativeCatalog(source); await this.driver.nativeProject(); }
  mapType(id: string, file: string, type: string): void { this.driver.mapType(id, file, type); }
  mapMethod(id: string, file: string, type: string, method: string, parameters: string[]): void { this.driver.mapMethod(id, file, type, method, parameters); }
  mapParameter(id: string, file: string, type: string, method: string, parameters: string[], parameter: number): void { this.driver.mapParameter(id, file, type, method, parameters, parameter); }
  mapConstructor(id: string, file: string, type: string, parameters: string[]): void { this.driver.mapConstructor(id, file, type, parameters); }
  read(id: string): Promise<void> { return this.driver.read(id); }
  search(id: string): Promise<void> { return this.driver.search(id); }
  rememberSearch(): void { this.rememberedSearch = structuredClone(this.driver.searchResult); }
  expectSameSearch(): void { expect(this.driver.searchResult).toEqual(this.rememberedSearch); }
  expectReadText(path: string, text: string): void {
    const file = this.driver.readResult.artifacts.find(artifact => artifact.file.path === path)?.file;
    expect(file, path).toBeDefined(); expect(Buffer.from(file!.bytes).toString('utf8')).toBe(text);
    expect(this.driver.readResult.problems).toEqual([]); expect(this.driver.readResult.coverage.complete).toBe(true);
  }
  expectIncomingToken(path: string, call: string, token: string, owner: 'project' | 'specified'): void {
    const source = Buffer.from(this.driver.snapshot.files.find(file => file.path === path)!.bytes).toString('utf8');
    const start = source.indexOf(call) + call.indexOf(token);
    const site = this.driver.searchResult.incoming.uses.find(use => {
      const at = use.at.value as { file: string; start: number; length: number; owner: { kind: string } };
      return at.file === path && at.start === start && at.length === token.length && at.owner.kind === owner;
    });
    expect(site, JSON.stringify(this.driver.searchResult)).toBeDefined();
  }
  expectReadWholeFile(path: string): void {
    const captured = this.driver.snapshot.files.find(file => file.path === path)!;
    const artifacts = this.driver.readResult.artifacts.filter(item => item.file.path === path);
    expect(artifacts.length).toBeGreaterThan(0);
    for (const artifact of artifacts) expect(artifact.file).toEqual(captured);
    expect(this.driver.readResult.problems).toEqual([]); expect(this.driver.readResult.coverage.complete).toBe(true);
  }
  expectIncomingFrom(path: string, count: number): void {
    expect(this.driver.searchResult.incoming.uses.filter(use => (use.at.value as { file: string }).file === path)).toHaveLength(count);
  }
  expectIncomingCount(count: number): void { expect(this.driver.searchResult.incoming.uses).toHaveLength(count); }
  expectIncomingOwner(id: string): void {
    expect(this.driver.searchResult.incoming.uses.map(use => use.target)).toEqual([{ kind: 'specified', id }]);
  }
  expectUpstreamEvidenceRetained(): void {
    expect(this.driver.searchResult.incoming.coverage.scope.some(at => at.format === 'native-input-1'
      && (at.value as { uri: string }).uri.endsWith('/Unselected.java'))).toBe(true);
  }
  expectSourceScope(files: string[]): void {
    expect(this.driver.searchResult.incoming.coverage.scope.filter(at => at.format === 'java-file-1').map(at => (at.value as { file: string }).file)).toEqual(files);
  }
  expectExternalTarget(type: string, field: string): void {
    this.expectExternalMember(type, { kind: 'field', name: field });
  }
  expectExternalConstructor(type: string, parameters: string[]): void { this.expectExternalMember(type, { kind: 'constructor', parameters }); }
  private expectExternalMember(type: string, member: object, path = this.driver.catalogJar): void {
    const expected = { outputId: 'java', format: 'java-external-symbol-1', value: { uri: pathToFileURL(path).href, type, member } };
    const found = this.driver.searchResult.outgoing.uses.some(use => {
      if (use.target.kind !== 'project') return false;
      try { expect(JSON.parse(use.target.id)).toEqual(expected); return true; } catch { return false; }
    });
    expect(found, JSON.stringify(this.driver.searchResult)).toBe(true);
  }
  expectNativeCatalogEvidence(editableSources: string[]): void {
    const uri = pathToFileURL(this.driver.catalogJar).href;
    expect(this.driver.snapshot.nativeInputs).toEqual(expect.arrayContaining([expect.objectContaining({ uri, version: expect.stringMatching(/^[a-f0-9]{64}$/) })]));
    expect(this.driver.searchResult.outgoing.coverage.scope.some(at => at.format === 'native-input-1' && (at.value as { uri: string }).uri === uri)).toBe(true);
    expect(this.driver.snapshot.files.some(file => pathToFileURL(join(this.driver.snapshot.root.path, file.path)).href === uri)).toBe(false);
    expect(this.driver.snapshot.files.filter(file => file.path.endsWith('.java')).map(file => file.path)).toEqual(editableSources);
  }
  expectNativeInputChanged(): void {
    const uri = pathToFileURL(this.driver.catalogJar).href;
    expect(this.driver.searchResult.problems.some(problem => problem.code === 'native-input-changed' && problem.at.kind === 'dependency'
      && problem.at.path.includes(uri)), JSON.stringify(this.driver.searchResult.problems)).toBe(true);
    expect(this.driver.searchResult.definitions).toEqual([]);
    expect(this.driver.searchResult.incoming.uses).toEqual([]); expect(this.driver.searchResult.outgoing.uses).toEqual([]);
  }
  expectReadIncomplete(): void { expect(this.driver.readResult.coverage.complete).toBe(false); expect(this.driver.readResult.problems.map(problem => problem.code)).toContain('native-input-changed'); }
  expectCoverageComplete(): void { expect(this.driver.searchResult.problems, JSON.stringify(this.driver.searchResult.problems)).toEqual([]); expect(this.driver.searchResult.incoming.coverage.complete).toBe(true); }
  expectQueryIncomplete(): void { expect(this.driver.searchResult.incoming.coverage.complete).toBe(false); expect(this.driver.searchResult.outgoing.coverage.complete).toBe(false); }
  expectUnresolvedAt(text: string): void {
    expect(this.driver.searchResult.incoming.unresolved.some(item => {
      const at = item.at.value as { file: string; start: number; length: number };
      const source = this.driver.snapshot.files.find(file => file.path === at.file);
      return source && Buffer.from(source.bytes).toString('utf8').slice(at.start, at.start + at.length).includes(text) && !!item.reason;
    }), JSON.stringify(this.driver.searchResult)).toBe(true);
  }
  expectNativeLimitationAt(code: string, file: string, expression: string, token: string): void {
    const source = Buffer.from(this.driver.snapshot.files.find(item => item.path === file)!.bytes).toString('utf8');
    const start = source.indexOf(expression) + expression.indexOf(token);
    expect(this.driver.searchResult.problems.some(problem => problem.code === code && problem.at.kind === 'dependency'
      && problem.at.path[1] === file && problem.at.path[2] === start && problem.at.path[3] === token.length), JSON.stringify(this.driver.searchResult.problems)).toBe(true);
  }
  expectReflectionLimitationAt(text: string): void {
    expect(this.driver.searchResult.problems.some(problem => {
      if (problem.code !== 'dynamic-native-reference' || problem.at.kind !== 'dependency') return false;
      const [, file, start, length] = problem.at.path, source = this.driver.snapshot.files.find(item => item.path === file);
      return source && Buffer.from(source.bytes).toString('utf8').slice(start as number, (start as number) + (length as number)) === text;
    }), JSON.stringify(this.driver.searchResult.problems)).toBe(true);
  }
  library(locator: string, text: string): void { this.driver.library(locator, text); }
  workspaceModules(names: string[]): void { this.driver.workspaceModules = names; }
  expectLocatedGenerationProblem(code: string): void {
    expect(this.driver.written.problems.some(problem => problem.code === code && problem.at.kind === 'source'), JSON.stringify(this.driver.written.problems)).toBe(true);
    expect(this.driver.written.receipt).toBeUndefined(); expect(this.driver.written.artifacts).toBeUndefined();
  }
  source(text: string): void { this.driver.source(text); }
  createContracts(options: Record<string, unknown>): Promise<void> { return this.driver.create(options); }
  javac(text: string): Promise<void> { return this.driver.javac(text); }
  runJava(text: string): Promise<void> { return this.driver.runJava(text); }
  expectRecordComponentFacets(name: string, type: string, parameters: string[], index: number): void {
    const id = this.driver.current.baseline.elements.find(item => item.address.name === name)!.id;
    const facets = this.driver.written.artifacts!.filter(item => item.specId === id).map(item => item.locator.value);
    const file = 'src/main/java/' + type.replaceAll('.', '/') + '.java';
    expect(facets).toEqual([
      { file, type, member: { kind: 'field', name } },
      { file, type, member: { kind: 'method', name, parameters: [], static: false } },
      { file, type, member: { kind: 'constructor', parameters }, parameter: index },
    ]);
  }
  expectContractsWritten(): void { expect(this.driver.written.problems, JSON.stringify(this.driver.written.problems)).toEqual([]); expect(this.driver.written.receipt?.status).toBe('applied'); }
  expectNativeCompilationPassed(): void { expect(this.driver.native.stderr).toBe(''); expect(this.driver.native.code).toBe(0); }
  expectNativeCompilationProblemAt(text: string): void { expect(this.driver.native.code).not.toBe(0); expect(this.driver.native.stderr).toContain('incompatible types'); expect(this.driver.native.stderr).toContain(text); }
  expectThrown(type: string, message: string): void { expect(this.driver.native.code).not.toBe(0); expect(this.driver.native.stderr).toContain(type + ': ' + message); }
  expectStdout(value: string): void { expect(this.driver.native.code, this.driver.native.stderr).toBe(0); expect(this.driver.native.stdout).toBe(value); }
  expectExitCode(code: number): void { expect(this.driver.native.code, this.driver.native.stderr).toBe(code); }
  expectInvalidData(field: string): void { expect(this.driver.native.code).not.toBe(0); expect(this.driver.native.stderr).toContain('IllegalArgumentException'); expect(this.driver.native.stderr).toContain(field); }
  expectContractProblemAt(code: string, text: string): void {
    const start = this.driver.sourceText.indexOf(text);
    expect(this.driver.written.problems.some(problem => problem.code === code && problem.at.kind === 'source'
      && problem.at.range.start.offset === start), JSON.stringify(this.driver.written.problems)).toBe(true);
  }
  async expectNoWrites(): Promise<void> { expect(await this.driver.writtenFiles()).toEqual([]); expect(this.driver.written.receipt).toBeUndefined(); }
  expectNoNativeType(type: string): void { expect(this.driver.snapshot.files.some(file => file.path.endsWith('/' + type.replaceAll('.', '/') + '.java'))).toBe(false); }
  async expectMethod(type: string, name: string, parameters: string[], result: string): Promise<void> {
    await this.driver.runJava('System.out.print(' + type + '.class.getDeclaredMethod(' + JSON.stringify(name)
      + parameters.map(parameter => ', ' + parameter + '.class').join('') + ').getReturnType().getName());');
    this.expectStdout(result);
  }
  private generated(): string { return this.driver.snapshot.files.filter(file => file.path.endsWith('.java')).map(file => Buffer.from(file.bytes).toString('utf8')).join('\n'); }
  expectUnverifiedDefault(parameter: string, value: string): void { expect(this.generated()).toContain('@default ' + parameter + ' = ' + value); expect(this.generated()).toContain('Unverified implementation obligation'); }
  expectUnverifiedResult(name: string): void { expect(this.generated()).toContain('Result unspecified for ' + name); }
  expectFailureObligation(name: string, type: string): void { expect(this.generated()).toContain(name + ' may fail with ' + type); expect(this.generated()).toContain('implementation obligation'); }
  expectAliasDocumentation(name: string, type: string): void {
    const artifact = this.driver.readResult.artifacts.find(item => item.at.format === 'java-alias-1');
    expect(artifact, JSON.stringify(this.driver.readResult)).toBeDefined();
    const span = artifact!.at.value as { start: number; length: number };
    expect(Buffer.from(artifact!.file.bytes).toString('utf8').slice(span.start, span.start + span.length)).toContain(name + ' = ' + type);
    expect(this.driver.readResult.problems).toEqual([]);
  }
  expectAliasSpellingLimitation(): void {
    expect(this.driver.searchResult.incoming.coverage.complete).toBe(false);
    expect(this.driver.searchResult.problems.some(item => item.code === 'erased-alias-provenance')).toBe(true);
    expect(this.driver.searchResult.incoming.uses).toEqual([]);
  }
  expectProblemAt(code: string, field: string): void {
    expect(this.driver.snapshot.problems).toEqual(expect.arrayContaining([expect.objectContaining({ code, at: expect.objectContaining({
      kind: 'dependency', path: expect.arrayContaining([field]),
    }) })]));
  }
  expectCoverageIncomplete(): void { expect(this.driver.snapshot.complete).toBe(false); }
  expectCapturedSource(path: string, text: string): void {
    expect(Buffer.from(this.driver.snapshot.files.find(file => file.path === path)!.bytes).toString('utf8')).toBe(text);
  }
}
