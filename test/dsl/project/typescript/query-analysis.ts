import { expect } from 'vitest';
import { QueryAnalysisDriver } from '../../../driver/project/typescript/query-analysis.js';

/** Questions and observations about the actual captured/connected native project. */
export class QueryAnalysis {
  private static readonly active: QueryAnalysis[] = [];
  readonly driver: QueryAnalysisDriver;
  constructor(files: Record<string, string | Uint8Array>, configFile?: string) {
    this.driver = new QueryAnalysisDriver(files, configFile); QueryAnalysis.active.push(this);
  }
  static async connected(source: string): Promise<QueryAnalysis> {
    const questions = new QueryAnalysis({}); await questions.driver.connected(source); return questions;
  }
  static async clean(): Promise<void> { for (const questions of this.active.splice(0)) await questions.driver.dispose(); }
  selectClass(id: string, file: string, name: string): void { this.driver.associate(id, file, [{ kind: 'class', name }]); }
  selectMethod(id: string, file: string, owner: string, name: string): void {
    this.driver.associate(id, file, [{ kind: 'class', name: owner }, { kind: 'method', name, static: false }]);
  }
  relocateSavedDeclaration(path: string): Promise<void> { return this.driver.relocateOwnership(path); }
  observePreparation(): void { this.driver.observe(); }
  read(id: string): Promise<void> { return this.driver.read(id); }
  search(id: string): Promise<void> { return this.driver.search(id); }
  expectPreparations(count: number): void { expect(this.driver.prepared).toBe(count); }
  expectReadFile(path: string, text: string): void {
    const artifact = this.driver.readResult.artifacts.find(item => item.file.path === path);
    expect(artifact, path).toBeDefined(); expect(Buffer.from(artifact!.file.bytes).toString()).toBe(text);
  }
  expectCompleteRead(): void { expect(this.driver.readResult.problems).toEqual([]); expect(this.driver.readResult.coverage.complete).toBe(true); }
  expectCompleteSearch(): void {
    const result = this.driver.searchResult;
    expect(result.problems).toEqual([]); expect(result.incoming.coverage.complete).toBe(true); expect(result.outgoing.coverage.complete).toBe(true);
  }
  expectIncomingCall(path: string, token: string): void {
    const body = this.driver.snapshot.files.find(file => file.path === path);
    expect(body, path).toBeDefined(); const text = Buffer.from(body!.bytes).toString();
    expect(this.driver.searchResult.incoming.uses.some(use => {
      const site = use.at.value as { file: string; start: number; end: number; role: string };
      return site.file === path && site.role === 'call' && text.slice(site.start, site.end) === token;
    })).toBe(true);
  }
  expectDefinition(file: string): void {
    expect(this.driver.searchResult.definitions.some(at => (at.value as { file: string }).file === file)).toBe(true);
  }
  expectProblem(code: string, path: string): void {
    expect(this.driver.readResult.problems.some(problem => problem.code === code && problem.at.kind === 'dependency' && problem.at.path.includes(path))).toBe(true);
  }
  expectNoReadArtifact(path: string): void { expect(this.driver.readResult.artifacts.some(item => item.file.path === path)).toBe(false); }
  async expectOutputUnchanged(): Promise<void> {
    const output = this.driver.output; expect(output).toBeDefined();
    await output!.capture(); expect(output!.files).toEqual(this.driver.outputBefore);
  }
}
