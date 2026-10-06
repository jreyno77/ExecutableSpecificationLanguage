import { expect, onTestFinished } from 'vitest';
import { PythonCallableDriver } from '../../../driver/project/python/python-callables.js';
import { PythonQueryDriver } from '../../../driver/project/python/python-query.js';

export class PythonNativeLookup {
  private constructor(private readonly driver: PythonCallableDriver) {}
  static async fromFiles(files: Record<string, string>): Promise<PythonNativeLookup> {
    const driver = new PythonCallableDriver(files); onTestFinished(() => driver.dispose(), 30_000);
    await driver.initialize(); return new PythonNativeLookup(driver);
  }
  inspect() { return this.driver.inspect(); }
  expectLookupLimitation(file: string, token: string, at: { line?: number; lines?: number[] }) {
    const lines = at.lines ?? [at.line!], problems = this.driver.facts.problems;
    expect(problems.some(problem => problem.code === 'dynamic-python-lookup' && problem.file === file && problem.start !== undefined
      && lines.includes(this.driver.site(file, problem.start).line)
      && this.driver.files[file]!.slice(problem.start, problem.start + token.length) === token), JSON.stringify(problems)).toBe(true);
  }
  expectNoApplicationException(message: string) { expect(this.driver.stderr).not.toContain(message); }
  expectNoLookupProblems() { expect(this.driver.facts.problems).toEqual([]); }
  private declarations(file: string, path: string[], kind: string) {
    return this.driver.facts.declarations.filter(item => item.file === file
      && item.declaration.at(-1)?.kind === kind && JSON.stringify(item.declaration.map(part => part.name)) === JSON.stringify(path))
      .map(item => ({ line: this.driver.site(file, item.start).line, token: this.driver.site(file, item.start, item.end).token }));
  }
  expectMethodDeclarations(file: string, path: string[], expected: { line: number; token: string }[]) {
    expect(this.declarations(file, path, 'method')).toEqual(expected);
  }
  expectParameterDeclarations(file: string, path: string[], expected: { line: number; token: string }[]) {
    expect(this.declarations(file, path, 'parameter')).toEqual(expected);
  }
  expectUseTarget(file: string, token: string, at: { line: number }, targetFile: string, targetToken: string, targetAt: { line: number }) {
    const uses = this.driver.facts.uses.filter(use => use.file === file && use.name === token && this.driver.site(file, use.start).line === at.line);
    expect(uses).toHaveLength(1); expect(this.driver.site(file, uses[0]!.start, uses[0]!.end).token).toBe(token);
    expect(uses[0]!.targets.map(({ file, line, column }) => ({ file, line, column })))
      .toEqual([this.driver.target(targetFile, targetToken, targetAt.line)]);
  }
  expectUseTargets(file: string, token: string, sites: { line: number }[], targetFile: string, targetToken: string, targetAt: { line: number }) {
    for (const site of sites) this.expectUseTarget(file, token, site, targetFile, targetToken, targetAt);
    expect(this.driver.facts.uses.filter(use => use.file === file && use.name === token)).toHaveLength(sites.length);
  }
}

export class PythonCallableQueries {
  private constructor(private readonly driver: PythonQueryDriver) {}
  static async connect(): Promise<PythonCallableQueries> {
    const driver = new PythonQueryDriver(); onTestFinished(() => driver.dispose(), 30_000);
    await driver.initialize(); await driver.installFixture(); return new PythonCallableQueries(driver);
  }
  file(path: string, text: string) { return this.driver.file(path, text); }
  mapMethod(id: string, file: string, owner: string, name: string) { this.driver.map(id, file, [{ kind: 'class', name: owner }, { kind: 'method', name }]); }
  read(id: string) { return this.driver.read(id); }
  search(id: string) { return this.driver.search(id); }
  expectReadFiles(files: Record<string, string>) {
    const result = this.driver.readResult; expect(result.problems).toEqual([]); expect(result.coverage.complete).toBe(true);
    expect(Object.fromEntries(result.artifacts.map(item => [item.file.path, Buffer.from(item.file.bytes).toString('utf8')]))).toEqual(files);
  }
  expectDefinition(file: string, owner: string, name: string) {
    expect(this.driver.searchResult.definitions.map(item => item.value)).toEqual([{ file, declaration: [{ kind: 'class', name: owner }, { kind: 'method', name }] }]);
  }
  expectIncomingStatements(statements: string[]) {
    expect(this.driver.searchResult.incoming.uses.map(use => this.driver.site(use.at))).toEqual(statements.map(statement => expect.objectContaining({
      file: 'src/caller.py', token: 'save', statement,
    })));
  }
  expectComplete() {
    expect(this.driver.searchResult.problems).toEqual([]);
    for (const direction of [this.driver.searchResult.incoming, this.driver.searchResult.outgoing]) {
      expect(direction.coverage.complete).toBe(true); expect(direction.unresolved).toEqual([]);
    }
  }
  expectLookupLimited(file: string, token: string) {
    const result = this.driver.searchResult;
    expect(result.incoming.coverage.complete).toBe(false); expect(result.outgoing.coverage.complete).toBe(false);
    const source = Buffer.from(this.driver.snapshot.files.find(item => item.path === file)!.bytes).toString('utf8');
    expect(result.problems.some(problem => problem.code === 'dynamic-python-lookup' && problem.at.kind === 'dependency'
      && problem.at.path.includes(file) && typeof problem.at.path.at(-1) === 'number'
      && source.slice(problem.at.path.at(-1) as number).startsWith(token)), JSON.stringify(result.problems)).toBe(true);
  }
}
