import { expect } from 'vitest';
import { QueryError, type Diagnostic, type ExternalDefinition, type Item, type NodeId, type NodeKind,
  type QueryErrorCode, type Requirement } from '../../../src/index.js';
import { TypeCandidateDriver } from '../../driver/compiler/type-candidates.js';

type CandidateTarget = { name: string; kind: NodeKind; module?: string; nameAt?: readonly [number, number];
  externalPath?: readonly (string | number)[]; builtin?: boolean };

/** Consumer actions and independently authored observations for contextual type suggestions. */
export class ContextualTypeCandidates {
  private readonly driver = new TypeCandidateDriver();
  sourceIs(text: string): void { this.driver.sourceIs(text); }
  sourceModuleIs(locator: string, text: string): void { this.driver.sourceModuleIs(locator, text); }
  externalModuleIs(locator: string, definitions: readonly ExternalDefinition[]): void { this.driver.externalModuleIs(locator, definitions); }
  externalEntryIs(definitions: readonly ExternalDefinition[]): void { this.driver.externalEntryIs(definitions); }
  resolveDeclarations(): void { this.driver.resolveDeclarations(); }
  composeSources(): void { this.driver.composeSources(); }
  composeEntries(entries: readonly { locator: string; text: string }[]): void { this.driver.composeEntries(entries); }
  compileResolvedSource(): void { this.driver.compileResolvedSource(); }
  askAtType(path: readonly string[], occurrence?: number): void { this.driver.ask(path, occurrence); }
  askAtTypeIn(module: string, path: readonly string[], occurrence?: number): void { this.driver.ask(path, occurrence, module); }
  rememberReply(name: string): void { this.driver.rememberReply(name); }
  attemptCandidateMutation(name: string): void { this.driver.attemptCandidateMutation(name); }
  forbidFurtherInputModelReads(): void { this.driver.forbidFurtherInputModelReads(); }
  useSameModelReportWithPublicFindings(problems: readonly Diagnostic[], deferred: readonly Requirement[]): void {
    this.driver.useSameModelReport(problems, deferred);
  }
  expectNames(names: readonly string[]): void {
    expect(this.driver.result.value, 'A known scope must have an actual query value.').toBeDefined();
    expect(this.driver.result.value!.map(candidate => candidate.name)).toEqual(names);
  }
  expectNoValue(): void { expect(this.driver.result.value).toBeUndefined(); }
  expectCandidate(name: string, insertion: string, target: CandidateTarget): void {
    expect(this.driver.candidate(name).insertionText).toBe(insertion);
    expect(targetFacts(this.driver.target(name))).toMatchObject(target);
  }
  expectCandidateCount(name: string, count: number): void {
    expect(this.driver.result.value, 'Count candidates only in an actual value.').toBeDefined();
    expect(this.driver.result.value!.filter(candidate => candidate.name === name)).toHaveLength(count);
  }
  expectMissingCandidate(name: string): void {
    expect(this.driver.result.value, 'Invalid names must not erase the entire reply.').toBeDefined();
    expect(this.driver.result.value!.map(candidate => candidate.name)).not.toContain(name);
  }
  expectInsertion(name: string, insertion: string): void { expect(this.driver.candidate(name).insertionText).toBe(insertion); }
  expectSameTarget(left: string, right: string): void { expect(this.driver.candidate(left).target).toBe(this.driver.candidate(right).target); }
  expectSameTargetAsReply(name: string, reply: string): void {
    const previous = this.driver.remembered(reply).value?.find(candidate => candidate.name === name);
    expect(previous, 'The remembered actual candidate must exist.').toBeDefined();
    expect(this.driver.candidate(name).target).toBe(previous!.target);
  }
  expectInsertedNameResolves(name: string): void {
    const { actual, expected } = this.driver.insertedNameBinding(name);
    expect(targetFacts(actual)).toEqual(targetFacts(expected));
  }
  expectQueryFindings(problems: readonly string[], deferred: readonly string[]): void {
    expect(this.driver.result.problems.map(problem => problem.code).sort()).toEqual([...problems].sort());
    expect(this.driver.result.deferred.map(requirement => requirement.reason).sort()).toEqual([...deferred].sort());
  }
  expectQueryProblemAt(code: string, module: string, at: readonly [number, number]): void {
    const problem = this.driver.result.problems.find(problem => problem.code === code);
    expect(problem, 'The actual query must preserve its located cause.').toBeDefined();
    expect(problem!.at).toMatchObject({ kind: 'source', module, range: { start: { line: at[0], column: at[1] } } });
  }
  expectExternalQueryProblem(code: string, module: string, path: readonly (string | number)[]): void {
    expect(this.driver.result.problems).toContainEqual(expect.objectContaining({ code,
      at: expect.objectContaining({ kind: 'external', module, path }) }));
  }
  expectRelatedIntroductionModules(code: string, modules: readonly string[]): void {
    const problem = this.driver.result.problems.find(problem => problem.code === code);
    expect(problem, 'The ambiguous introduction must have a real query diagnostic.').toBeDefined();
    expect(problem!.related.map(origin => 'module' in origin ? origin.module : undefined)).toEqual(modules);
  }
  expectSameDeferredOccurrenceAsReference(): void {
    const reference = this.driver.referenceAsked;
    expect(reference.resolution.status).toBe('deferred');
    if (reference.resolution.status !== 'deferred') throw new Error('The actual reference is not deferred.');
    expect(this.driver.result.deferred).toEqual([reference.resolution.requirement]);
    expect((this.driver.result.deferred[0] as Requirement & { occurrence: NodeId }).occurrence).toBe(reference.id);
  }
  expectSameQueryFindingsAsReply(reply: string): void {
    const previous = this.driver.remembered(reply);
    expect(this.driver.result.problems).toEqual(previous.problems);
    expect(this.driver.result.deferred).toEqual(previous.deferred);
  }
  expectOriginalProblemCodes(codes: readonly string[]): void {
    expect(this.driver.resolution.problems.map(problem => problem.code).sort()).toEqual([...codes].sort());
  }
  expectCompilationValueAbsent(): void { expect(this.driver.compiled.value).toBeUndefined(); }
  expectNoInputModelReads(): void { expect(this.driver.furtherInputReads).toBe(0); }
  expectCapturedModelUnchanged(): void {
    const { before, after } = this.driver.capturedModelObservation();
    expect(before, 'Observe the original captured facts before the mutation attempt.').toBeDefined();
    expect(after).toEqual(before);
  }
  expectSameCapturedModel(): void { expect(this.driver.sameCapturedModel).toBe(true); }
  expectForeignReferenceQueryError(text: string, code: QueryErrorCode): void { this.expectQueryError(this.driver.foreignQuery(text), code); }
  expectUnreachedModuleReferenceQueryError(module: string, path: readonly string[], code: QueryErrorCode): void {
    this.expectQueryError(this.driver.unreachedQuery(module, path), code);
  }
  expectUnpreparedReferenceQueryError(text: string, path: readonly string[], code: QueryErrorCode): void {
    this.expectQueryError(this.driver.unpreparedQuery(text, path, false), code);
  }
  expectSubstitutedModelReferenceQueryError(text: string, path: readonly string[], code: QueryErrorCode): void {
    this.expectQueryError(this.driver.unpreparedQuery(text, path, true), code);
  }
  expectDeclarationQueryError(name: string, kind: NodeKind, code: QueryErrorCode): void {
    this.expectQueryError(this.driver.declarationQuery(name, kind), code);
  }
  expectNonissuedReferenceQueryError(code: QueryErrorCode): void { this.expectQueryError(this.driver.nonissuedQuery(), code); }
  expectReferenceQueryError(path: readonly string[], code: QueryErrorCode): void { this.expectQueryError(this.driver.referenceQuery(path), code); }
  private expectQueryError(query: { id: NodeId; run: () => unknown }, code: QueryErrorCode): void {
    let failure: unknown;
    try { query.run(); } catch (error) { failure = error; }
    expect(failure, 'The real public query must reject this operand.').toBeInstanceOf(QueryError);
    expect(failure).toMatchObject({ code });
    expect((failure as QueryError).nodeId).toBe(query.id);
  }
}

function targetFacts(item: Item): CandidateTarget {
  if (!('name' in item) || typeof item.name !== 'string' || !('nameOrigin' in item)) throw new Error('The candidate target must be a named declaration.');
  const origin = item.nameOrigin;
  return { name: item.name, kind: item.kind,
    ...(item.origin.kind !== 'builtin' ? { module: item.origin.module } : { builtin: true }),
    ...(origin.kind === 'source' ? { nameAt: [origin.range.start.line, origin.range.start.column] as const } : {}),
    ...(item.origin.kind === 'external' ? { externalPath: item.origin.path } : {}) };
}
