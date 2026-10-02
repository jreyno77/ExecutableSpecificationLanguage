import { expect } from 'vitest';
import { QueryError, type Diagnostic } from '../../src/index.js';
import { ScenarioCheckingDriver } from '../driver/scenario-checking.js';

export class ScenarioExamples {
  private readonly driver = new ScenarioCheckingDriver();
  source(text: string): void { this.driver.source(text); }
  attemptSource(text: string): void { this.driver.attemptSource(text); }
  expectSourceRejected(text: string): void {
    const reading = this.driver.sourceReading();
    expect(reading.status).toBe('rejected');
    if (reading.status !== 'rejected') throw new Error('Expected invalid source syntax');
    expect(reading.diagnostics.map(problem => ({ category: problem.category, start: problem.primaryRange.start.offset, end: problem.primaryRange.end.offset })))
      .toContainEqual({ category: 'expected-token', ...this.driver.sourceSpan(text) });
  }
  module(locator: string, text: string): void { this.driver.module(locator, text); }
  checkScenario(title: string): void { this.driver.check(title, 'scenario'); }
  checkExample(title: string): void { this.driver.check(title, 'example'); }
  expectStaticallyValid(): void {
    this.expectNoProblems();
    this.expectNoDeferred();
    expect(this.driver.findings().value).toBeUndefined();
  }
  expectNoProblems(): void { expect(this.driver.findings().problems).toEqual([]); }
  expectNoDeferred(): void { expect(this.driver.findings().deferred).toEqual([]); }
  expectSteps(steps: string[]): void { expect(this.driver.steps()).toEqual(steps); }
  expectOperation(step: number, name: string): void {
    const operation = this.driver.operation(step);
    expect(operation.problems).toEqual([]);
    expect(operation.deferred).toEqual([]);
    expect(operation.value).toBe(this.driver.namedOperation(name));
  }
  expectArgument(step: number, argument: number, text: string): void { expect(this.driver.argument(step, argument)).toBe(text); }
  expectCaptureAtStep(step: number, name: string): void { expect(this.driver.capture(step).decoded).toBe(name); }
  expectProblem(code: string, text: string): void { this.problem(code, text); }
  expectProblemAtStep(step: number, code: string, text: string): void { this.problem(code, text, step); }
  expectOriginalProblem(code: string, text: string, context?: { step: number }): void {
    const expected = this.driver.expectedSpan(text, context?.step);
    const cause = this.driver.upstreamProblems().find(problem => problem.code === code && JSON.stringify(this.driver.span(problem.at)) === JSON.stringify(expected));
    expect(cause, `Expected upstream ${code}`).toBeDefined();
    const preserved = this.problem(code, text, context?.step);
    expect(preserved.message).toBe(cause!.message);
    expect(preserved.at).toEqual(cause!.at);
    expect(preserved.related).toEqual(expect.arrayContaining([...cause!.related]));
  }
  expectDuplicateCapture(name: string, positions: { firstStep: number; repeatedStep: number }): void {
    const problem = this.problem('duplicate-capture', name, positions.repeatedStep);
    expect(problem.related.map(origin => this.driver.span(origin))).toContainEqual(this.driver.expectedSpan(name, positions.firstStep));
  }
  expectDeferred(reason: string, text: string): void {
    const requirements = this.driver.findings().deferred.filter(requirement => requirement.reason === reason);
    expect(requirements.map(requirement => this.driver.span(requirement.origin))).toContainEqual(this.driver.expectedSpan(text));
  }
  expectDeferredAtActual(reason: string): void {
    const requirements = this.driver.findings().deferred.filter(requirement => requirement.reason === reason);
    expect(requirements.map(requirement => this.driver.span(requirement.origin))).toContainEqual(this.driver.span(this.driver.actual().origin));
  }
  expectCauseReachesStep(text: string, step: number): void {
    const cause = this.driver.expectedSpan(text), use = this.driver.span(this.driver.step(step).origin)!;
    const problems = this.driver.findings().problems.filter(problem => JSON.stringify(this.driver.span(problem.at)) === JSON.stringify(cause));
    expect(problems.flatMap(problem => problem.related).some(origin => {
      const span = this.driver.span(origin);
      return span?.module === use.module && span.start >= use.start && span.end <= use.end;
    })).toBe(true);
  }
  expectFixtureCause(name: string, code: string, text: string): void {
    const expected = this.driver.fixtureSpan(name, text);
    const cause = this.driver.fixtureFindings(name).problems.find(problem => problem.code === code
      && JSON.stringify(this.driver.span(problem.at)) === JSON.stringify(expected));
    expect(cause, `Expected fixture cause ${code}`).toBeDefined();
    const preserved = this.driver.findings().problems.find(problem => problem.code === code && problem.message === cause!.message
      && JSON.stringify(this.driver.span(problem.at)) === JSON.stringify(expected));
    expect(preserved).toBeDefined();
    expect(preserved!.at).toEqual(cause!.at);
    expect(preserved!.related).toEqual(expect.arrayContaining([...cause!.related]));
    expect(preserved!.related.map(origin => this.driver.span(origin))).toContainEqual(this.driver.expectedSpan(name));
  }
  expectActual(text: string): void { expect(this.driver.textAt(this.driver.actual().origin)).toBe(text); }
  expectExpectedValue(text: string): void {
    expect(this.driver.expected().kind).not.toBe('prose-expectation');
    expect(this.driver.textAt(this.driver.expected().origin)).toBe(text);
  }
  expectDistinctActualAndExpectedOrigins(): void {
    const actual = this.driver.actual(), expected = this.driver.expected();
    expect(actual.id).not.toBe(expected.id);
    expect(this.driver.span(actual.origin)).not.toEqual(this.driver.span(expected.origin));
  }
  expectNoProseExpectation(): void { expect(this.driver.prose()).toEqual([]); }
  expectProseExpectation(text: string): void { expect(this.driver.prose()).toEqual([text]); }
  rememberOperation(step: number, label: string): void { this.driver.rememberOperation(step, label); }
  expectSameOperation(step: number, label: string): void { expect(this.driver.operation(step).value).toBe(this.driver.rememberedOperation(label)); }
  rememberReport(label: string): void { this.driver.rememberReport(label); }
  expectSameReportAs(label: string): void { expect(this.driver.findings()).toEqual(this.driver.rememberedReport(label).snapshot); }
  expectRememberedReportUnchanged(label: string): void {
    const { report, snapshot } = this.driver.rememberedReport(label);
    expect(report).toEqual(snapshot);
  }
  expectInspectionUnchanged(): void {
    const { before, after } = this.driver.inspectionSnapshots();
    expect(after).toBe(before);
  }
  attemptToCheckFunction(name: string): void { this.driver.attemptFunction(name); }
  attemptToCheckForeignExample(other: ScenarioExamples, title: string): void { this.driver.attemptForeign(other.driver, title); }
  expectQueryError(code: string): void {
    expect(this.driver.queryError()).toBeInstanceOf(QueryError);
    expect(this.driver.queryError()).toMatchObject({ code });
  }

  private problem(code: string, text: string, step?: number): Diagnostic {
    const expected = this.driver.expectedSpan(text, step);
    const problem = this.driver.findings().problems.find(problem => problem.code === code
      && JSON.stringify(this.driver.span(problem.at)) === JSON.stringify(expected));
    expect(problem, `Expected ${code} at ${text}`).toBeDefined();
    return problem!;
  }
}
