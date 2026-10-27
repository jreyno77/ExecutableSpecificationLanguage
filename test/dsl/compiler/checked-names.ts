import { expect } from 'vitest';
import { createNodeId, type Check, type CheckedSourceName, type NodeId, type Specification } from '../../../src/index.js';
import { CheckedNameDriver, type NameLocation, type NameOwnerAnchor } from '../../driver/compiler/checked-names.js';

/** Domain observations of the compiler's real source-name query. */
export class CheckedNames {
  private readonly driver = new CheckedNameDriver();
  private collected?: Check<readonly CheckedSourceName[]>;
  private remembered?: { specification: Specification; declaration: NodeId; answer: Check<readonly CheckedSourceName[]> };

  source(locator: string, text: string): void { this.driver.source(locator, text); }
  module(locator: string, text: string): void { this.driver.module(locator, text); }
  compile(withoutPrivateEvidence = false): void {
    const result = this.driver.compile(withoutPrivateEvidence);
    expect(result.syntax).toEqual([]);
    expect(result.problems).toEqual([]);
    expect(result.deferred).toEqual([]);
    expect(result.value, 'The supplied source must compile before source-name queries.').toBeDefined();
    const specification = this.driver.specification();
    expect(specification, 'A successfully checked Specification must expose compiler-owned source names.')
      .toHaveProperty('names');
    const names = this.driver.names(specification);
    expect(names).toHaveProperty('at', expect.any(Function));
    expect(names).toHaveProperty('inSource', expect.any(Function));
    expect(names).toHaveProperty('occurrencesOf', expect.any(Function));
  }
  compileUsingSameCompiler(): void { this.compile(); }
  compileUsingPublicModelWithoutPrivateEvidence(): void { this.compile(true); }

  collectNamesInSource(sourceId: string): void {
    this.collected = this.driver.names().inSource(sourceId);
    this.complete(this.collected);
  }
  expectCollectedNameAt(sourceId: string, line: number, column: number, endColumn: number, spelling: string, owner: NameOwnerAnchor): void {
    const names = this.collectedNames(), offset = this.driver.offset(sourceId, line, column);
    const selected = names.filter(name => name.range.sourceId === sourceId && name.range.start.offset <= offset && offset < name.range.end.offset);
    expect(selected).toHaveLength(1);
    this.expectName(selected[0]!, { sourceId, line, column, endColumn, spelling }, this.driver.owner(owner));
  }
  expectNoCollectedEditableNameAt(sourceId: string, line: number, column: number): void {
    const offset = this.driver.offset(sourceId, line, column);
    expect(this.collectedNames().filter(name => name.range.sourceId === sourceId
      && name.range.start.offset <= offset && offset < name.range.end.offset)).toEqual([]);
  }
  expectNameAt(sourceId: string, line: number, column: number, endColumn: number, spelling: string, owner: NameOwnerAnchor): void {
    const answer = this.driver.names().at(sourceId, this.driver.offset(sourceId, line, column));
    this.expectName(this.complete(answer), { sourceId, line, column, endColumn, spelling }, this.driver.owner(owner));
  }
  expectNoEditableNameAt(sourceId: string, line: number, column: number): void {
    const answer = this.driver.names().at(sourceId, this.driver.offset(sourceId, line, column));
    expect(answer.problems).toEqual([]);
    expect(answer.deferred).toEqual([]);
    expect(answer.value).toBeUndefined();
  }
  expectOccurrencesOwnedAt(sourceId: string, line: number, column: number, expected: readonly NameLocation[]): void {
    const declaration = this.driver.introduction(sourceId, line, column);
    this.expectOccurrences(this.driver.names().occurrencesOf(declaration), declaration, expected, this.driver.specification());
  }

  rememberOccurrencesOwnedAt(sourceId: string, line: number, column: number): void {
    const specification = this.driver.specification(), declaration = this.driver.introduction(sourceId, line, column, specification);
    const answer = this.driver.names(specification).occurrencesOf(declaration);
    this.complete(answer);
    this.remembered = { specification, declaration, answer };
  }
  expectRememberedOccurrences(expected: readonly NameLocation[]): void {
    if (!this.remembered) throw new Error('No actual earlier source-name answer was remembered.');
    const { specification, declaration, answer } = this.remembered;
    this.expectOccurrences(answer, declaration, expected, specification);
    this.expectOccurrences(this.driver.names(specification).occurrencesOf(declaration), declaration, expected, specification);
  }
  rememberAnalysisWork(): void { this.driver.rememberAnalysisWork(); }
  expectNoAdditionalAnalysis(): void {
    const work = this.driver.analysisWork();
    expect(work.after).toEqual(work.before);
  }

  expectSameNameAt(sourceId: string, line: number, column: number, targetLine: number, targetColumn: number): void {
    const names = this.driver.names();
    expect(this.complete(names.at(sourceId, this.driver.offset(sourceId, line, column))))
      .toEqual(this.complete(names.at(sourceId, this.driver.offset(sourceId, targetLine, targetColumn))));
  }
  expectNameProblemAt(sourceId: string, line: number, column: number, code: string): void {
    const offset = this.driver.offset(sourceId, line, column), answer = this.driver.names().at(sourceId, offset);
    this.problem(answer, code);
    expect(answer.problems.some(problem => problem.at.kind === 'source'
      && problem.at.range.sourceId === sourceId && problem.at.range.start.offset === offset)).toBe(true);
  }
  expectSourceNamesProblem(sourceId: string, code: string): void { this.problem(this.driver.names().inSource(sourceId), code); }
  expectOccurrencesProblemOwnedAt(sourceId: string, line: number, column: number, code: string): void {
    this.problem(this.driver.names().occurrencesOf(this.driver.introduction(sourceId, line, column)), code);
  }
  expectSourceNamesRequirement(sourceId: string, reason: string): void { this.requirement(this.driver.names().inSource(sourceId), reason); }
  expectOccurrencesRequirementOwnedAt(sourceId: string, line: number, column: number, reason: string): void {
    this.requirement(this.driver.names().occurrencesOf(this.driver.introduction(sourceId, line, column)), reason);
  }
  expectUnknownNameSource(sourceId: string): void {
    expect(() => this.driver.names().at(sourceId, 0)).toThrow(RangeError);
    expect(() => this.driver.names().inSource(sourceId)).toThrow(RangeError);
  }
  expectInvalidNameOffsets(sourceId: string, offsets: readonly number[]): void {
    for (const offset of [...offsets, Number.MAX_SAFE_INTEGER + 1]) expect(() => this.driver.names().at(sourceId, offset)).toThrow(RangeError);
  }
  expectForeignNameOwnerRejected(): void { this.queryError(() => this.driver.names().occurrencesOf(createNodeId()), 'foreign-node'); }
  expectNonIntroductionNameOwnerRejected(): void {
    const inspection = this.driver.specification().inspection;
    const name = [...inspection.query('name')].find(item => inspection.parent(item.id)?.kind === 'record-type-declaration');
    if (!name) throw new Error('The example must supply a declaration name token.');
    this.queryError(() => this.driver.names().occurrencesOf(name.id), 'unexpected-kind');
  }
  tryToMutateReturnedNames(): void {
    if (!this.remembered) throw new Error('Remember the original result before trying caller mutations.');
    const later = this.complete(this.driver.names().occurrencesOf(this.remembered.declaration)) as CheckedSourceName[];
    if (!later[0]) throw new Error('The example needs a returned source name.');
    const range = later[0].range as { start: { offset: number; column: number }; end: { offset: number } };
    for (const mutate of [() => { range.start.offset = 900; }, () => { range.start.column = 900; },
      () => { range.end.offset = 901; }, () => { later.length = 0; }]) {
      try { mutate(); } catch (error) { expect(error).toBeInstanceOf(TypeError); }
    }
  }
  private problem(answer: Check<unknown>, code: string): void {
    expect(answer.value).toBeUndefined();
    expect(answer.problems.map(problem => problem.code)).toContain(code);
  }
  private requirement(answer: Check<unknown>, reason: string): void {
    expect(answer.value).toBeUndefined();
    expect(answer.problems).toEqual([]);
    expect(answer.deferred.map(requirement => requirement.reason)).toContain(reason);
  }
  private queryError(query: () => unknown, code: string): void {
    try { query(); } catch (error) { expect(error).toMatchObject({ code }); return; }
    throw new Error('Expected the name query to reject this owner: ' + code);
  }

  private collectedNames(): readonly CheckedSourceName[] {
    if (!this.collected) throw new Error('No actual source-name collection was recorded.');
    return this.complete(this.collected);
  }
  private complete<T>(answer: Check<T>): T {
    expect(answer.problems).toEqual([]);
    expect(answer.deferred).toEqual([]);
    expect(answer.value, 'The checked name query must return a complete answer.').toBeDefined();
    return answer.value!;
  }
  private expectName(actual: CheckedSourceName, expected: NameLocation, declaration: NodeId, specification = this.driver.specification()): void {
    expect(actual.range).toEqual(this.driver.range(expected, specification));
    expect(actual.spelling).toBe(expected.spelling);
    expect(actual.declaration).toBe(declaration);
  }
  private expectOccurrences(answer: Check<readonly CheckedSourceName[]>, declaration: NodeId, expected: readonly NameLocation[], specification: Specification): void {
    const actual = this.complete(answer);
    expect(actual).toHaveLength(expected.length);
    expected.forEach((location, index) => this.expectName(actual[index]!, location, declaration, specification));
  }
}
