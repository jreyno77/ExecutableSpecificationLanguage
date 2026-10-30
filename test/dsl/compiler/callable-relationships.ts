import { expect } from 'vitest';
import { createNodeId, QueryError, type ExternalDefinition, type NodeId } from '../../../src/index.js';
import { CompilationDriver } from '../../driver/compiler/compiler-composition.js';

/** Authored relationships observed through the real compiler and source-name API. */
export class CallableRelationships {
  readonly driver = new CompilationDriver();
  source(text: string): void { this.driver.source(text); }
  module(locator: string, text: string): void { this.driver.module(locator, text); }
  external(locator: string, definitions: readonly ExternalDefinition[]): void { this.driver.externalModule(locator, definitions); }
  compile(): void { this.driver.compile(); }
  expectAccepted(): void {
    expect(this.driver.findings().syntax).toEqual([]);
    expect(this.driver.findings().problems).toEqual([]);
    expect(this.driver.findings().deferred).toEqual([]);
    expect(this.driver.findings().value).toBeDefined();
  }
  expectCalls(caller: string, targets: readonly string[]): void {
    const specification = this.driver.specification();
    const actual = specification.calls(this.driver.named(caller).id);
    expect(actual).toEqual(targets.map(target => this.driver.named(target).id));
    expect(actual.map(id => this.driver.name(specification.inspection.read(id)))).toEqual(targets);
  }
  expectCallOccurrences(target: string, count: number): void {
    const targetId = this.driver.named(target).id;
    const references = this.driver.query('calls').flatMap(clause => clause.references);
    expect(references.filter(reference => reference.resolution.status === 'bound' && reference.resolution.target === targetId)).toHaveLength(count);
    for (const reference of references) expect(this.driver.textAt(reference.origin)).not.toBe('');
  }
  expectComponentDependency(owner: string, target: string, present = true): void {
    const matching = this.driver.relationships().filter(relationship => relationship.role === 'dependency' && relationship.owner === owner && relationship.target === this.driver.named(target).id);
    expect(matching).toHaveLength(present ? 1 : 0);
  }
  expectPromise(caller: string, text: string): void {
    expect(this.driver.contract(caller).filter(clause => clause.kind === 'promises').map(clause => clause.text)).toContain(text);
  }
  expectProblem(code: string, reference: string): void {
    expect(this.driver.findings().value).toBeUndefined();
    expect(this.driver.findings().problems.filter(problem => problem.code === code).map(problem => this.driver.textAt(problem.at))).toContain(reference);
  }
  expectDeferredReference(reference: string): void {
    expect(this.driver.findings().value).toBeUndefined();
    expect(this.driver.findings().deferred.filter(requirement => requirement.reason === 'composition').map(requirement => this.driver.textAt(requirement.origin))).toContain(reference);
  }
  expectSyntaxProblemAt(token: string, within: string): void {
    expect(this.driver.findings().syntax.map(problem => this.driver.span(problem.primaryRange))).toContainEqual(this.driver.expectedSpan(token, { within }));
    expect(this.driver.findings().value).toBeUndefined();
  }
  expectQueryError(name: string, code: string): void { this.queryError(() => this.driver.specification().calls(this.driver.named(name).id), code); }
  expectForeignQueryError(): void { this.queryError(() => this.driver.specification().calls(createNodeId()), 'foreign-node'); }
  expectImmutableAnswers(caller: string, targets: readonly string[]): void {
    const before = this.driver.snapshot(), specification = this.driver.specification();
    const answer = specification.calls(this.driver.named(caller).id);
    expect(() => (answer as NodeId[]).push(createNodeId())).toThrow(TypeError);
    this.expectCalls(caller, targets);
    expect(this.driver.snapshot()).toBe(before);
  }
  expectReferenceTarget(reference: string, target: string): void {
    const found = this.driver.query('calls').flatMap(clause => clause.references).filter(node => this.driver.textAt(node.origin) === reference);
    expect(found).toHaveLength(1);
    expect(found[0]!.resolution).toEqual({ status: 'bound', target: this.driver.named(target).id });
  }
  expectAliasOccurrences(alias: string, expected: readonly { text: string; within: string }[]): void {
    const introduction = this.driver.query('import-item').find(item => item.alias?.decoded === alias)?.alias;
    expect(introduction).toBeDefined();
    const answer = this.driver.specification().names.occurrencesOf(introduction!.id);
    expect(answer.problems).toEqual([]); expect(answer.deferred).toEqual([]);
    expect(answer.value?.map(name => this.driver.span(name.range))).toEqual(expected.map(entry => this.driver.expectedSpan(entry.text, { within: entry.within })));
    expect(answer.value?.map(name => name.declaration)).toEqual(expected.map(() => introduction!.id));
  }
  expectDeclarationOccurrences(target: string, expected: readonly { text: string; within: string; sourceId?: string }[]): void {
    const answer = this.driver.specification().names.occurrencesOf(this.driver.named(target).id);
    expect(answer.problems).toEqual([]); expect(answer.deferred).toEqual([]);
    expect(answer.value?.map(name => this.driver.span(name.range))).toEqual(expected.map(entry => this.driver.expectedSpan(entry.text, { within: entry.within, ...(entry.sourceId ? { sourceId: entry.sourceId } : {}) })));
  }
  private queryError(query: () => unknown, code: string): void {
    expect(query).toThrow(QueryError);
    try { query(); } catch (error) { expect(error).toMatchObject({ code }); }
  }
}
