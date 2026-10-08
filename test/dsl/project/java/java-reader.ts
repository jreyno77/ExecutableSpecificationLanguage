import { promises as fs } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { expect, onTestFinished } from 'vitest';
import type { ProjectRead, ProjectSearch } from '../../../../src/index.js';
import { JavaReaderDriver } from '../../../driver/project/java/java-reader.js';

export class JavaReaderExamples {
  private constructor(private readonly driver: JavaReaderDriver) {}
  private static async prepare(source: string, dependency?: { catalogJar?: string; catalogSource?: string }): Promise<JavaReaderExamples> {
    const driver = new JavaReaderDriver(); onTestFinished(() => driver.dispose());
    await driver.prepare(source, dependency); return new JavaReaderExamples(driver);
  }
  static direct(source: string, dependency?: { catalogJar?: string; catalogSource?: string }): Promise<JavaReaderExamples> { return this.prepare(source, dependency); }
  static output(source: string): Promise<JavaReaderExamples> { return this.prepare(source); }
  associateType(id: string, file: string, type: string): void { this.driver.mapType(id, file, type); }
  associateMethod(id: string, file: string, type: string, method: string, parameters: string[]): void { this.driver.mapMethod(id, file, type, method, parameters); }
  async openReader(): Promise<void> { this.driver.openReader(); }
  async openAnotherReader(): Promise<void> { this.driver.openReader(); }
  async openOutput(): Promise<void> { this.driver.openOutput(); }
  recordOwnedType(id: string, file: string, type: string): Promise<void> { return this.driver.recordOwnedType(id, file, type); }
  replaceOwnershipText(text: string): Promise<void> { return this.driver.replaceOwnershipText(text); }
  read(id: string): Promise<void> { return this.driver.read(id); }
  search(id: string): Promise<void> { return this.driver.search(id); }
  beginRead(id: string): Promise<void> { return this.driver.beginRead(id); }
  beginSearch(id: string): Promise<void> { return this.driver.beginSearch(id); }
  holdNextAnswerAfterItsActualFirstNativeValidation(): void { this.driver.holdNextAnswer(1); }
  holdNextAnswerAfterItsActualFinalNativeValidation(): void { this.driver.holdNextAnswer(2); }
  expectEarlierAnswerHeld(): Promise<void> { return this.driver.earlierAnswerHeld(); }
  releaseEarlierAnswer(): void { this.driver.releaseEarlierAnswer(); }
  replaceSuppliedSourceRetainingVersion(text: string): void { this.driver.replaceSuppliedSource(text); }
  replaceSuppliedConfigurationRetainingVersion(changes: Record<string, unknown>): void { this.driver.replaceSuppliedConfiguration(changes); }
  restoreSuppliedConfiguration(): void { this.driver.restoreSuppliedConfiguration(); }
  supplyReadOnlyFileWithIncorrectBodyHash(): void { this.driver.supplyIncorrectReadOnlyHash(); }
  restoreSuppliedReadOnlyFiles(): void { this.driver.restoreSuppliedReadOnlyFiles(); }
  changeActualCatalogJar(): Promise<void> { return this.driver.changeCatalogJarBytes(); }
  changeActualExternalSourceAfterNextNativeValidation(text: string): void { this.driver.changeExternalAfterNextValidation(text); }
  interruptNextActualNativePreparation(): void { this.driver.interruptNextPreparation(); }
  mutateEarlierAnswerBytesAndCoverage(): void {
    this.driver.mutateEarlierAnswer();
    expect(this.driver.earlierRead!.artifacts[0]!.file.bytes.every(byte => byte === 0)).toBe(true);
    expect(this.driver.earlierRead!.coverage.complete).toBe(false);
  }

  private reading(earlier = false): ProjectRead {
    const result = earlier ? this.driver.earlierRead : this.driver.readResult; expect(result).toBeDefined(); return result!;
  }
  private relationships(earlier = false): ProjectSearch {
    const result = earlier ? this.driver.earlierSearch : this.driver.searchResult; expect(result).toBeDefined(); return result!;
  }
  private expectContains(result: ProjectRead, text: string): void {
    expect(result.artifacts.map(artifact => Buffer.from(artifact.file.bytes).toString('utf8'))).toEqual(expect.arrayContaining([expect.stringContaining(text)]));
  }
  expectReadContains(text: string): void { this.expectContains(this.reading(), text); }
  expectEarlierReadContains(text: string): void { this.expectContains(this.reading(true), text); }
  private expectCompleteRead(result: ProjectRead): void { expect(result.coverage.complete).toBe(true); expect(result.problems).toEqual([]); }
  expectReadComplete(): void { this.expectCompleteRead(this.reading()); }
  expectEarlierReadComplete(): void { this.expectCompleteRead(this.reading(true)); }
  expectReadIncomplete(): void { expect(this.reading().coverage.complete).toBe(false); }
  expectEarlierReadIncomplete(): void { expect(this.reading(true).coverage.complete).toBe(false); }
  private expectCompleteSearch(result: ProjectSearch): void {
    expect(result.incoming.coverage.complete).toBe(true); expect(result.outgoing.coverage.complete).toBe(true);
    expect(result.incoming.unresolved).toEqual([]); expect(result.outgoing.unresolved).toEqual([]); expect(result.problems).toEqual([]);
  }
  expectSearchComplete(): void { this.expectCompleteSearch(this.relationships()); }
  expectEarlierSearchComplete(): void { this.expectCompleteSearch(this.relationships(true)); }
  expectSearchIncomplete(): void {
    expect(this.relationships().incoming.coverage.complete).toBe(false); expect(this.relationships().outgoing.coverage.complete).toBe(false);
  }
  expectIncomingToken(call: string, token: string): void {
    const source = this.driver.sourceText, start = source.indexOf(call) + call.indexOf(token);
    expect(source.indexOf(call)).toBeGreaterThanOrEqual(0); expect(call.indexOf(token)).toBeGreaterThanOrEqual(0);
    expect(this.relationships().incoming.uses.map(use => use.at)).toEqual(expect.arrayContaining([expect.objectContaining({
      format: 'java-site-1', value: expect.objectContaining({ file: 'src/main/java/store/Book.java', start, length: token.length }) })]));
  }
  expectIncomingCount(count: number): void { expect(this.relationships().incoming.uses).toHaveLength(count); }
  expectDefinitionType(type: string): void {
    expect(this.relationships().definitions).toHaveLength(1);
    expect(this.relationships().definitions[0]).toMatchObject({ format: 'java-symbol-1', value: { type } });
  }
  expectDefinitions(definitions: []): void { expect(this.relationships().definitions).toEqual(definitions); }
  private expectField(result: ProjectSearch, type: string, field: string, external = false): void {
    const targets = result.outgoing.uses.flatMap(use => use.target.kind === 'project' ? [JSON.parse(use.target.id)] : []);
    expect(targets).toEqual(expect.arrayContaining([expect.objectContaining({ format: external ? 'java-external-symbol-1' : 'java-symbol-1',
      value: expect.objectContaining({ type, member: { kind: 'field', name: field } }) })]));
  }
  expectFieldDependency(type: string, field: string): void { this.expectField(this.relationships(), type, field); }
  expectEarlierFieldDependency(type: string, field: string): void { this.expectField(this.relationships(true), type, field); }
  expectExternalField(type: string, field: string): void { this.expectField(this.relationships(), type, field, true); }
  expectProblem(code: string): void { expect(this.driver.last).toBeDefined(); expect(this.driver.last!.problems.map(problem => problem.code)).toContain(code); }
  expectEarlierProblem(code: string): void { expect(this.reading(true).problems.map(problem => problem.code)).toContain(code); }
  expectProblems(problems: []): void { expect(this.driver.last).toBeDefined(); expect(this.driver.last!.problems).toEqual(problems); }
  expectProblemAtNativeFile(code: string, file: 'catalog.jar' | 'catalog/Book.java'): void {
    const path = file === 'catalog.jar' ? this.driver.catalogJar : this.driver.externalSource;
    const uri = pathToFileURL(path).href;
    expect(this.relationships().problems).toEqual(expect.arrayContaining([expect.objectContaining({ code,
      at: { kind: 'dependency', path: ['java', 'expec.java.json', uri] } })]));
  }
  expectNoResolvedRelationships(): void {
    expect(this.relationships().incoming.uses).toEqual([]); expect(this.relationships().outgoing.uses).toEqual([]);
  }
  expectNativePreparations(count: number): void { expect(this.driver.preparations).toBe(count); }
  expectAnalysisNativeValidations(count: number): void { expect(this.driver.validations).toBe(count); }
  async expectReadThrowsTypeError(id: string): Promise<void> { await expect(this.driver.read(id)).rejects.toBeInstanceOf(TypeError); }
  async expectNativeProcessesAndScratchDisposed(): Promise<void> {
    expect(this.driver.processes).toHaveLength(this.driver.preparations);
    for (const process of this.driver.processes) {
      expect(process.closed).toBe(true); await expect(fs.lstat(process.scratch)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  }
}
