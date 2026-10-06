import { expect } from 'vitest';
import { PythonContractEdgesDriver } from '../../../driver/project/python/python-contract-edges.js';

export class PythonContractEdges {
  private static readonly examples: PythonContractEdges[] = [];
  private constructor(readonly driver: PythonContractEdgesDriver) {}
  static async create(): Promise<PythonContractEdges> {
    const p = new PythonContractEdges(new PythonContractEdgesDriver()); this.examples.push(p);
    await p.driver.initialize(); await p.driver.installFixture(); return p;
  }
  static async dispose(): Promise<void> { for (const p of this.examples.splice(0)) await p.driver.dispose(); }
  source(text: string): void { this.driver.source(text); }
  change(text: string): void { this.driver.change(text); }
  buildContracts(): Promise<void> { return this.driver.buildContracts(); }
  updateContracts(): Promise<void> { return this.driver.update(); }
  name(authored: string, native: string): void { this.driver.name(authored, native); }
  mapURLToParseResult(): void { this.driver.importURL(); }
  rememberProject(): Promise<void> { return this.driver.rememberProject(); }
  file(path: string, text: string): Promise<void> { return this.driver.file(path, text); }
  changeNativeParameter(before: string, after: string): Promise<void> { return this.driver.replaceNativeText('src/store/contracts.py', before, after); }
  async checkConsumer(text: string): Promise<void> { await this.driver.checkCapturedConsumer(text); expect(this.driver.native.code, this.driver.native.text).toBe(0); }
  search(name: string): Promise<void> { return this.driver.searchDeclaration(name); }
  run(text: string): Promise<void> { return this.driver.run(text); }
  expectApplied(): void {
    expect(this.driver.written.problems, JSON.stringify(this.driver.written.problems)).toEqual([]);
    expect(this.driver.written.receipt?.status).toBe('applied');
  }
  expectMissingMappings(names: string[]): void {
    for (const name of names) expect(this.driver.written.problems.some(problem =>
      ['invalid-native-name', 'missing-native-mapping'].includes(problem.code) && problem.message.includes(name)), JSON.stringify(this.driver.written.problems)).toBe(true);
    expect(this.driver.written.receipt).toBeUndefined(); expect(this.driver.written.artifacts).toBeUndefined();
  }
  async expectProjectUnchanged(): Promise<void> {
    await this.driver.capture(); expect(this.driver.snapshot.complete, JSON.stringify(this.driver.snapshot.problems)).toBe(true);
    const files = (snapshot: typeof this.driver.snapshot) => snapshot.files.map(file => ({ path: file.path, bytes: Buffer.from(file.bytes) })).sort((a, b) => a.path.localeCompare(b.path));
    expect(files(this.driver.snapshot)).toEqual(files(this.driver.before));
  }
  expectIdentityUnchanged(): void {
    expect(JSON.stringify(this.driver.current.baseline.elements)).toBe(this.driver.beforeIdentity);
    expect(JSON.stringify(this.driver.current.baseline.artifacts)).toBe(this.driver.beforeAssociations);
  }
  expectNoAppliedPaths(): void {
    expect(this.driver.written.problems, JSON.stringify(this.driver.written.problems)).toEqual([]);
    expect(this.driver.written.receipt?.status).toBe('unchanged');
    expect(this.driver.written.receipt?.outcomes.filter(item => item.state === 'applied')).toEqual([]);
  }
  expectSignatureConflict(path: string): void {
    expect(this.driver.written.problems.some(problem => problem.code === 'output-conflict' && problem.at.kind === 'dependency'
      && problem.at.path.includes(path) && problem.message.includes('signature')), JSON.stringify(this.driver.written.problems)).toBe(true);
    expect(this.driver.written.receipt).toBeUndefined(); expect(this.driver.written.artifacts).toBeUndefined();
    expect(JSON.stringify(this.driver.current.baseline.artifacts)).toBe(this.driver.beforeAssociations);
  }
  expectOutput(text: string): void { expect(this.driver.runtime.code, this.driver.runtime.text).toBe(0); expect(this.driver.runtime.text.trim().split(/\r?\n/)).toEqual(text.split('\n')); }
  expectNativeUse(path: string, expression: string, token: string): void {
    const result = this.driver.searchResult, file = this.driver.snapshot.files.find(file => file.path === path);
    expect(result.problems, JSON.stringify(result.problems)).toEqual([]);
    expect(result.incoming.coverage.complete, JSON.stringify(result)).toBe(true); expect(result.outgoing.coverage.complete).toBe(true);
    expect(file).toBeDefined(); const text = Buffer.from(file!.bytes).toString('utf8'), start = text.indexOf(expression);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(result.incoming.uses.some(use => {
      const at = use.at.value as { file: string; start: number; end: number };
      return at.file === path && at.start === start && at.end === start + token.length && text.slice(at.start, at.end) === token;
    }), JSON.stringify(result)).toBe(true);
  }
  async expectValidPython(path: string): Promise<void> {
    await this.driver.compileNativeFile(path); expect(this.driver.syntax.code, this.driver.syntax.text).toBe(0); expect(this.driver.syntax.text.trim()).toBe('valid Python');
  }
  expectAnalyzerLimitation(path: string, statement: string): void {
    const result = this.driver.searchResult, file = this.driver.snapshot.files.find(file => file.path === path);
    expect(file).toBeDefined(); const text = Buffer.from(file!.bytes).toString('utf8'), start = text.indexOf(statement);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(result.problems.some(problem => {
      if (problem.code !== 'unsupported-analyzer-syntax' || problem.at.kind !== 'dependency' || !problem.at.path.includes(path)) return false;
      const offset = problem.at.path.at(-1);
      return typeof offset === 'number' && offset >= start && offset < start + statement.length;
    }), JSON.stringify(result)).toBe(true);
    expect(result.problems.some(problem => problem.code === 'invalid-python-source')).toBe(false);
    expect(result.incoming.coverage.complete).toBe(false); expect(result.outgoing.coverage.complete).toBe(false);
  }
  async expectFileText(path: string, text: string): Promise<void> { expect(await this.driver.text(path)).toBe(text); }
}
