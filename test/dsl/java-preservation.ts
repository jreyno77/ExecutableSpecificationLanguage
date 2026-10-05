import { expect } from 'vitest';
import { pathToFileURL } from 'node:url';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { JavaPreservationDriver } from '../driver/java-preservation.js';

export class JavaPreservation {
  private static readonly active: JavaPreservation[] = [];
  private before: string | undefined;
  private filesBefore: { path: string; bytes: Uint8Array }[] = [];
  private constructor(readonly driver: JavaPreservationDriver) {}
  static async connect(): Promise<JavaPreservation> {
    const example = new JavaPreservation(new JavaPreservationDriver()); this.active.push(example);
    await example.driver.initialize(); await example.driver.nativeProject(); return example;
  }
  static async dispose(): Promise<void> { for (const example of this.active.splice(0)) await example.driver.dispose(); }
  configureOutput(options:Record<string,unknown>):void { this.driver.contractOptions={package:'store',...options}; }
  source(text: string): void { this.driver.source(text); }
  expectAuthoredObligation(code: string, subject: string, text: string): void {
    expect(this.driver.written.obligations?.some(item => item.code === code && item.message.includes(subject) && item.message.includes(text)
      && item.at.kind === 'source' && item.at.range.sourceId === 'main.expec'), JSON.stringify(this.driver.written.obligations)).toBe(true);
  }
  file(path: string, text: string): Promise<void> { return this.driver.file(path, text); }
  capture(): Promise<void> { return this.driver.capture(); }
  selectCatalogJarAt(path: string, source: string): Promise<void> { return this.driver.catalogAt(path, source); }
  changeSelectedJar(): void { appendFileSync(this.driver.catalogJar, '\nchanged-selected-library\n'); }
  useIsolatedToolchain(): Promise<void> { return this.driver.isolateToolchain(); }
  changeSelectedJdkImage(): void {
    const image = join(this.driver.copiedJdk, 'lib', 'modules');
    expect(this.driver.plan.value?.basedOn.nativeInputs?.some(input => input.uri === pathToFileURL(image).href)).toBe(true);
    appendFileSync(image, '\nchanged-selected-image\n');
  }
  async planRename(from: string, to: string): Promise<void> { this.driver.revise('class ' + to + ' {}', [from, to]); await this.driver.planUpdate(); }
  applyPlan(): Promise<void> { return this.driver.applyPlan(); }
  applyUsingPlainProjectContext(): Promise<void> { return this.driver.applyPlan(true); }
  expectPlanAvailable(): void { expect(this.driver.plan.problems).toEqual([]); expect(this.driver.plan.value).toBeDefined(); }
  expectAppliedPlan(status: 'applied' | 'stopped', paths?: string[]): void {
    expect(this.driver.appliedPlan.status).toBe(status);
    if (status === 'stopped') expect(this.driver.appliedPlan.problems.map(problem => problem.code)).toContain('stale-project');
    if (paths) expect(this.driver.appliedPlan.outcomes.filter(item => item.state === 'applied')
      .map(item => item.change.kind === 'move' ? item.change.to : item.change.path)).toEqual(paths);
  }
  expectExcludedEntries(paths: string[]): void { expect(this.driver.snapshot.excluded).toEqual(expect.arrayContaining(paths)); }
  expectNoCapturedFilesBelow(paths: string[]): void {
    expect(this.driver.snapshot.files.filter(file => paths.some(path => file.path === path || file.path.startsWith(path + '/')))).toEqual([]);
  }
  expectCapturedFiles(paths: string[]): void { expect(this.driver.snapshot.files.map(file => file.path)).toEqual(expect.arrayContaining(paths)); }
  expectSelectedJarEvidence(): void {
    expect(this.driver.snapshot.nativeInputs).toEqual(expect.arrayContaining([expect.objectContaining({ uri: pathToFileURL(this.driver.catalogJar).href,
      version: expect.stringMatching(/^[a-f0-9]{64}$/) })]));
  }
  expectIncompleteSource(path: string): void {
    expect(this.driver.snapshot.complete).toBe(false);
    expect(this.driver.snapshot.problems.some(problem => problem.code === 'excluded-source' && problem.at.kind === 'dependency'
      && problem.at.path.includes(path)), JSON.stringify(this.driver.snapshot.problems)).toBe(true);
  }
  async expectRefusedPlanWithoutWrites(): Promise<void> {
    expect(this.driver.plan.value).toBeUndefined(); expect(this.driver.plan.problems.length).toBeGreaterThan(0);
    await this.driver.capture(); expect(this.driver.snapshot.files.map(({ path, bytes }) => ({ path, bytes: Uint8Array.from(bytes) }))).toEqual(this.filesBefore);
  }
  mapOwner(file: string, type: string): void { this.driver.mapOwner(file, type); }
  mapStore(file: string, type: string, method: string, parameters: string[]): void { this.driver.mapStore(file, type, method, parameters); }
  async nativeCaller(source: string): Promise<void> { await this.driver.nativeSource('catalog/Caller.java', source); await this.driver.nativeProject(); }
  async expectReadonlyConflict(token: string): Promise<void> {
    const source = await this.driver.externalSourceText();
    expect(this.driver.written.problems.some(problem => problem.code === 'read-only-native-use' && problem.at.kind === 'dependency'
      && problem.at.path[1] === pathToFileURL(this.driver.externalSource).href && typeof problem.at.path[2] === 'number'
      && typeof problem.at.path[3] === 'number' && source.slice(problem.at.path[2],problem.at.path[2]+problem.at.path[3]) === token), JSON.stringify(this.driver.written.problems)).toBe(true);
  }
  async adopt(options: Record<string, unknown> = {}): Promise<void> { await this.driver.create({ package: 'store', adoptExisting: true, ...options }); this.driver.confirm(); }
  async generate(options: Record<string, unknown> = {}): Promise<void> { await this.driver.create({ package: 'store', ...options }); this.driver.confirm(); }
  async planRepeat(): Promise<void> { this.driver.revise(this.driver.sourceText); await this.driver.planUpdate(); }
  expectNoPlanChanges(): void { expect(this.driver.plan.problems, JSON.stringify(this.driver.plan.problems)).toEqual([]); expect(this.driver.plan.value?.changes).toEqual([]); }
  async annotateGeneratedClass(file: string, comment: string, promise: string): Promise<void> {
    const source = this.text(file), documentation = '/**\n * Unverified implementation obligation.\n * ' + promise + '\n */\n';
    expect(source).toContain(documentation);
    await this.file(file, source.replace('public class Store {', 'public class Store {\n// ' + comment).replace(documentation, documentation + documentation));
  }
  expectImplementationProblem(file: string, expression: string, message: string): void {
    const source=this.text(file),start=source.indexOf(expression); expect(start).toBeGreaterThanOrEqual(0);
    expect(this.driver.written.obligations?.some(problem=>problem.code.startsWith('java-')&&problem.message.includes(message)&&problem.at.kind==='dependency'
      &&problem.at.path[1]===file&&typeof problem.at.path[2]==='number'&&typeof problem.at.path[3]==='number'
      &&problem.at.path[2]>=start&&problem.at.path[2]<start+expression.length&&problem.at.path[3]>0),JSON.stringify(this.driver.written.obligations)).toBe(true);
  }
  expectProblemCode(code: string): void { expect(this.driver.written.problems.map(problem => problem.code)).toContain(code); }
  async remove(name: string): Promise<void> { await this.driver.remove(name); }
  expectFileAbsent(path: string): void { expect(this.driver.snapshot.files.some(file => file.path === path)).toBe(false); }
  mapStoreGame(file: string): void { this.driver.mapStoreGame(file); }
  async update(text: string, rename?: [string, string], retire: string[] = []): Promise<void> { this.driver.revise(text, rename, retire); await this.driver.update(); }
  async insert(text: string): Promise<void> { this.driver.revise(text); await this.driver.insert(); }
  async rememberFile(path: string): Promise<void> { await this.driver.capture(); this.before = this.text(path); }
  async rememberWrites(): Promise<void> { await this.driver.capture(); this.filesBefore = this.driver.snapshot.files.map(({ path, bytes }) => ({ path, bytes: Uint8Array.from(bytes) })); }
  async expectNoWrites(): Promise<void> {
    await this.driver.capture(); expect(this.driver.snapshot.files.map(({ path, bytes }) => ({ path, bytes: Uint8Array.from(bytes) }))).toEqual(this.filesBefore);
    expect(this.driver.written.receipt).toBeUndefined(); expect(this.driver.written.artifacts).toBeUndefined();
  }
  expectConflictAt(file: string, token: string): void {
    expect(this.driver.written.problems.some(problem => problem.at.kind === 'dependency' && problem.at.path[1] === file
      && typeof problem.at.path[2] === 'number' && typeof problem.at.path[3] === 'number'
      && this.text(file).slice(problem.at.path[2], problem.at.path[2] + problem.at.path[3]).includes(token)), JSON.stringify(this.driver.written.problems)).toBe(true);
  }
  expectGeneratedBaselineExcludes(handwritten: string): void {
    const state = JSON.parse(this.text('.expec/outputs/java.json')) as { files: { generated: string }[] };
    expect(state.files.map(file => file.generated).join('\n')).not.toContain(handwritten);
    expect(state.files.map(file => file.generated).join('\n')).toContain('Not implemented: title');
  }
  expectFileUnchanged(path: string): void { expect(this.text(path)).toBe(this.before); }
  expectFileText(path: string, text: string): void { expect(this.text(path)).toBe(text); }
  search(name: string): Promise<void> { return this.driver.searchOwned(name); }
  expectUnmodeledUse(path: string, expression: string, token: string): void {
    const result = this.driver.searchResult, text = this.text(path), start = text.indexOf(expression) + expression.indexOf(token);
    expect(text.indexOf(expression)).toBeGreaterThanOrEqual(0);
    expect(result.problems, JSON.stringify(result.problems)).toEqual([]); expect(result.incoming.coverage.complete).toBe(true);
    expect(result.incoming.uses.some(use => {
      const at = use.at.value as { file: string; start: number; length: number };
      return use.target.kind === 'project' && at.file === path && at.start === start && text.slice(at.start, at.start + at.length) === token;
    }), JSON.stringify(result)).toBe(true);
  }
  expectRetainedPrefix(path: string): void { expect(this.text(path).startsWith(this.before!.slice(0, -1))).toBe(true); }
  expectText(path: string, text: string): void { expect(this.text(path)).toContain(text); }
  private text(path: string): string {
    const file = this.driver.snapshot.files.find(item => item.path === path); expect(file, path).toBeDefined(); return Buffer.from(file!.bytes).toString('utf8');
  }
  expectDeletionWritten(retained: string[] = []): void {
    expect(this.driver.written.problems).toEqual([]); expect(this.driver.written.receipt?.status).toBe('applied');
    const ids = retained.map(name => this.driver.current.baseline.elements.find(item => item.address.name === name)!.id);
    expect([...new Set(this.driver.written.artifacts?.map(item => item.specId))].sort()).toEqual(ids.sort());
  }
  expectWritten(): void {
    expect(this.driver.written.problems, JSON.stringify(this.driver.written.problems)).toEqual([]);
    expect(this.driver.written.receipt?.status).toBe('applied'); expect(this.driver.written.artifacts?.length).toBeGreaterThan(0);
  }
  async runJava(body: string, packageName?: string): Promise<void> { await this.driver.runJava(body, packageName); }
  expectStdout(text: string): void { expect(this.driver.native, JSON.stringify(this.driver.native)).toMatchObject({ code: 0, stdout: text }); }
  expectNativeProblem(message: string): void { expect(this.driver.native.code).not.toBe(0); expect(this.driver.native.stderr).toContain(message); }
  expectStub(name: string): void { expect(this.driver.native.code).not.toBe(0); expect(this.driver.native.stderr.split(/\r?\n/)).toContain('Exception in thread "main" java.lang.UnsupportedOperationException: Not implemented: ' + name); }
}
