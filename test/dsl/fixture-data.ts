import { expect } from 'vitest';
import { QueryError, type Diagnostic } from '../../src/index.js';
import { FixtureDataDriver } from '../driver/fixture-data.js';

export class FixtureData {
  private readonly driver = new FixtureDataDriver();
  source(text: string): void { this.driver.source(text); }
  check(name: string): void { this.driver.check(name); }
  checkInitializerAsExpression(name: string): void { this.driver.checkInitializerAsExpression(name); }
  expectType(name: string): void {
    const result = this.driver.findings();
    expect(result.value).toBeDefined();
    expect(result.value).toBe(this.driver.declaredType());
    if (name.startsWith('List<')) {
      const description = this.driver.typeDescription(result.value!);
      const list = this.driver.typeDescription(this.driver.namedType('List'));
      expect(description.kind).toBe('builtin');
      if (description.kind !== 'builtin' || list.kind !== 'builtin') throw new Error('Expected a List type');
      expect(description.declaration).toBe(list.declaration);
      expect(description.arguments).toHaveLength(1);
      expect(description.arguments[0]).toBe(this.driver.namedType(name.slice(5, -1)));
    } else expect(result.value).toBe(this.driver.namedType(name));
    expect(result.problems).toEqual([]);
    expect(result.deferred).toEqual([]);
  }
  expectNoType(): void { expect(this.driver.findings().value).toBeUndefined(); }
  expectNoProblems(): void { expect(this.driver.findings().problems).toEqual([]); }
  expectValidExpression(): void { expect(this.driver.expressionFindings()).toEqual({ problems: [], deferred: [] }); }
  expectIncompatibleValue(text: string, expected: string): void {
    this.problem('incompatible-type', text);
    expect(this.driver.declaredDestination(text)).toBe(this.driver.namedType(expected));
  }
  expectOriginalProblemFrom(name: string, text: string): void {
    const cause = this.driver.previous(name).problems.find(problem => this.driver.textAt(problem.at) === text);
    expect(cause).toBeDefined();
    const preserved = this.driver.findings().problems.find(problem => problem.code === cause!.code && problem.message === cause!.message
      && this.driver.textAt(problem.at) === text);
    expect(preserved).toBeDefined();
    expect(preserved!.at).toEqual(cause!.at);
    expect(preserved!.related).toEqual(expect.arrayContaining([...cause!.related]));
    expect(preserved!.related.map(origin => this.driver.span(origin))).toContainEqual(this.driver.expectedSpan(name));
  }
  expectCycle(names: string[]): void { expect(this.problem('fixture-cycle').message).toContain(names.join(' → ')); }
  expectCycleReferences(references: { line: number; text: string }[]): void {
    const problem = this.problem('fixture-cycle');
    const spans = [problem.at, ...problem.related].map(origin => this.driver.span(origin));
    for (const { text, line } of references) expect(spans).toContainEqual(this.driver.expectedSpan(text, { line }));
  }
  expectUnresolvedName(name: string, context: { line: number }): void { this.problem('unresolved-reference', name, context); }
  expectRuntimeCallRejected(text: string): void { this.problem('runtime-call', text); }
  expectMissingField(name: string, context: { fixture: string }): void {
    const problems = this.driver.findings().problems.filter(problem => ['invalid-record', 'missing-fixture-data'].includes(problem.code)
      && problem.message.includes(name) && this.driver.textAt(problem.at) === this.driver.fixtureInitializer(context.fixture));
    expect(problems, `Expected missing field ${name}`).not.toEqual([]);
    for (const problem of problems) expect(this.driver.span(problem.at)).toEqual(this.driver.expectedSpan(this.driver.fixtureInitializer(context.fixture), context));
  }
  expectUnknownField(name: string, context: { line: number }): void { this.problem('invalid-record', name, context); }
  expectAmbiguousRecord(context: { fixture: string }): void { this.problem('ambiguous-record', this.driver.fixtureInitializer(context.fixture), context); }
  expectInvalidOperand(text: string, operator: string): void {
    const problem = this.problem('invalid-operator', operator);
    expect(problem.related.map(origin => this.driver.span(origin))).toContainEqual(this.driver.expectedSpan(text));
  }
  expectDeferredReference(text: string, reason: string): void {
    const expected = this.driver.expectedSpan(text);
    const requirements = this.driver.findings().deferred.filter(requirement => requirement.reason === reason);
    expect(requirements.map(requirement => this.driver.span(requirement.origin))).toContainEqual(expected);
  }
  rememberReport(name: string): void { this.driver.remember(name); }
  expectSameReportAs(name: string): void {
    const before = this.driver.memory(name).snapshot, after = this.driver.findings();
    expect(after.value).toBe(before.value);
    expect(after).toEqual(before);
  }
  expectRememberedReportUnchanged(name: string): void {
    const { report, snapshot } = this.driver.memory(name);
    expect(report.value).toBe(snapshot.value);
    expect(report).toEqual(snapshot);
  }
  expectInspectionUnchanged(): void {
    const { before, after } = this.driver.inspectionSnapshots();
    expect(after).toBe(before);
  }
  attemptToCheckTypeDeclaration(name: string): void { this.driver.attemptType(name); }
  attemptToCheckForeignFixture(other: FixtureData, name: string): void { this.driver.attemptForeign(other.driver, name); }
  expectQueryError(code: string): void {
    expect(this.driver.queryError()).toBeInstanceOf(QueryError);
    expect(this.driver.queryError()).toMatchObject({ code });
  }

  private problem(code: string, text?: string, context?: { line?: number; fixture?: string }): Diagnostic {
    const problem = this.driver.findings().problems.find(problem => problem.code === code && (text === undefined || this.driver.textAt(problem.at) === text));
    expect(problem, `Expected ${code}${text ? ` at ${text}` : ''}`).toBeDefined();
    if (text !== undefined) expect(this.driver.span(problem!.at)).toEqual(this.driver.expectedSpan(text, context));
    return problem!;
  }
}
