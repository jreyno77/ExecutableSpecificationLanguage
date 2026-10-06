import { expect, onTestFinished } from 'vitest';
import { PythonQueryDriver } from '../../../driver/project/python/python-query.js';

export class PythonQueries {
  private constructor(private readonly driver: PythonQueryDriver) {}
  static async connect(): Promise<PythonQueries> {
    const driver = new PythonQueryDriver(); onTestFinished(() => driver.dispose());
    await driver.initialize(); await driver.installFixture(); return new PythonQueries(driver);
  }
  file(path: string, text: string) { return this.driver.file(path, text); }
  source(text: string) { this.driver.source(text); }
  mapClass(id: string, file: string, name: string) { this.driver.map(id, file, [{ kind: 'class', name }]); }
  mapMethod(id: string, file: string, owner: string, name: string) { this.driver.map(id, file, [{ kind: 'class', name: owner }, { kind: 'method', name }]); }
  mapDeclaredClass(name: string, file: string) { this.mapClass(this.driver.id(name), file, name); }
  read(id: string) { return this.driver.read(id); }
  search(id: string) { return this.driver.search(id); }
  searchDeclared(name: string) { return this.driver.search(this.driver.id(name)); }
  replaceInFile(file: string, before: string, after: string) { return this.driver.replace(file, before, after); }
  rememberRead() { this.driver.earlierRead = this.driver.readResult; }
  expectReadFiles(files: Record<string, string>, earlier = false) {
    const result = earlier ? this.driver.earlierRead! : this.driver.readResult;
    expect(result.problems).toEqual([]); expect(result.coverage.complete).toBe(true);
    expect(Object.fromEntries(result.artifacts.map(item => [item.file.path, Buffer.from(item.file.bytes).toString('utf8')]))).toEqual(files);
  }
  typedConsumers(count: number) { return this.driver.typedConsumers(count); }
  expectIncomingCallers(numbered: number, additional: string[]) {
    const uses = this.driver.searchResult.incoming.uses, expected = [...Array.from({ length: numbered }, (_, index) => 'src/caller' + index + '.py'), ...additional];
    expect(uses).toHaveLength(numbered + additional.length);
    expect(uses.map(use => this.driver.site(use.at).file).sort()).toEqual(expected.sort());
    for (const use of uses) {
      expect(this.driver.site(use.at)).toMatchObject({ token: 'save', statement: 'game.save("Dune")' });
      expect(use.target.kind).toBe('project');
    }
    this.expectComplete();
  }
  expectDefinition(file: string, owner: string, method: string) {
    expect(this.driver.searchResult.definitions.map(item => item.value)).toEqual([{ file, declaration: [{ kind: 'class', name: owner }, { kind: 'method', name: method }] }]);
  }
  expectOnlyIncomingStatement(statement: string) {
    expect(this.driver.searchResult.incoming.uses.map(use => this.driver.site(use.at).statement)).toEqual([statement]); this.expectComplete();
  }
  expectLookupLimited(file: string, token: string) {
    const result = this.driver.searchResult;
    expect(result.incoming.coverage.complete).toBe(false); expect(result.outgoing.coverage.complete).toBe(false);
    const source = Buffer.from(this.driver.snapshot.files.find(item => item.path === file)!.bytes).toString('utf8');
    expect(result.problems.some(problem => problem.code === 'dynamic-python-lookup' && problem.at.kind === 'dependency'
      && problem.at.path.includes(file) && typeof problem.at.path.at(-1) === 'number'
      && source.slice(problem.at.path.at(-1) as number).startsWith(token)), JSON.stringify(result.problems)).toBe(true);
  }
  expectAmbiguousMember(file: string, token: string, candidates: number) {
    const result = this.driver.searchResult;
    expect(result.incoming.coverage.complete).toBe(false);
    expect(result.incoming.unresolved.map(item => ({ ...this.driver.site(item.at), reason: item.reason })))
      .toContainEqual(expect.objectContaining({ file, token, reason: 'The native member has ' + candidates + ' possible declarations.' }));
  }
  expectComplete() {
    const result = this.driver.searchResult; expect(result.problems, JSON.stringify(result.problems)).toEqual([]);
    for (const direction of [result.incoming, result.outgoing]) { expect(direction.unresolved).toEqual([]); expect(direction.coverage.complete).toBe(true); }
  }
  compareDependencies(expected: string[]) { this.driver.compare(expected); }
  expectDependencyComparison(expected: { matched: string[]; missing: string[]; unexpected: string[] }) {
    const result = this.driver.comparison!;
    expect(result.matched.map(item => item.id)).toEqual(expected.matched.map(name => this.driver.id(name)));
    expect(result.unobserved).toEqual(expected.missing.map(name => this.driver.id(name)));
    expect(result.observedOnly.map(use => this.driver.site(use.at).token)).toEqual(expected.unexpected);
    expect(result.observedOnly.every(use => use.target.kind === 'project')).toBe(true); this.expectComplete();
  }
  async adoptStore(file: string) {
    this.driver.associateStoreFile(file); await this.driver.generate({ adoptExisting: true });
    expect(this.driver.written.problems, JSON.stringify(this.driver.written.problems)).toEqual([]);
    expect(this.driver.written.receipt?.status).toBe('applied');
  }
  expectUseTextAt(token: string, expected: { file: string; line: number; utf16Column: number }) {
    expect(this.driver.searchResult.incoming.uses.map(use => this.driver.site(use.at))).toEqual([expect.objectContaining({ ...expected, token })]); this.expectComplete();
  }
  async tryRenameSave() {
    this.driver.renameCapability('save', 'saveGame', 'class StoreGame { public saveGame\ncapability saveGame(snapshot: Text) returns Nothing }');
    await this.driver.update();
  }
  async renameSave() {
    await this.tryRenameSave(); expect(this.driver.written.problems, JSON.stringify(this.driver.written.problems)).toEqual([]);
    expect(this.driver.written.receipt?.status).toBe('applied');
  }
  expectRenameRefused(code: string) {
    expect(this.driver.written.problems.map(problem => problem.code), JSON.stringify(this.driver.written)).toContain(code);
    expect(this.driver.written.receipt).toBeUndefined(); expect(this.driver.written.artifacts).toBeUndefined();
  }
  async expectCapturedFilesUnchanged() { expect((await this.driver.context.readSnapshot()).files).toEqual(this.driver.snapshot.files); }
  async expectFile(file: string, text: string) { expect(await this.driver.text(file)).toBe(text); }
}
