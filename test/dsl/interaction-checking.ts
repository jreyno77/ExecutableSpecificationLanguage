import { expect } from 'vitest';
import { QueryError, type Check, type Communication, type Diagnostic, type ExternalDefinition } from '../../src/index.js';
import { InteractionCheckingDriver, type SourceSelection } from '../driver/interaction-checking.js';

export class InteractionExamples {
  private readonly driver = new InteractionCheckingDriver();
  private problem!: Diagnostic;
  source(text: string): void { this.driver.source(text); }
  externalModule(locator: string, declarations: readonly ExternalDefinition[]): void { this.driver.externalModule(locator, declarations); }
  otherSource(text: string): void { this.driver.otherSource(text); }
  checkInteraction(title: string): void { this.driver.checkInteraction(title); }
  checkMessage(title: string, number: number): void { this.driver.checkMessage(title, number); }
  expectStaticallyValid(): void {
    this.expectNoProblems();
    expect(this.driver.findings().deferred).toEqual([]);
    if (this.driver.checkingMessage()) expect(this.driver.findings().value).toBeDefined();
    else expect(this.driver.findings().value).toBeUndefined();
  }
  expectNoProblems(): void { expect(this.driver.findings().problems).toEqual([]); }
  expectMessages(title: string, expected: { from: string; to: string; operation: string }[]): void {
    const messages = this.driver.messages(title).map(report => this.communication(report));
    expect(messages.map(message => this.driver.messageNames(message))).toEqual(expected);
    expected.forEach((item, index) => {
      expect(messages[index]!.sender).toBe(this.driver.participant(title, item.from));
      expect(messages[index]!.receiver).toBe(this.driver.participant(title, item.to));
      expect(messages[index]!.operation).toBe(this.driver.operation(item.operation));
    });
  }
  expectMessageOperation(title: string, number: number, name: string): void {
    expect(this.communication(this.driver.message(title, number)).operation).toBe(this.driver.operation(name));
  }
  expectCapturedReply(title: string, name: string, type: string): void {
    expect(this.communication(this.driver.capture(title, name)).reply).toBe(this.driver.namedType(type));
  }
  expectNoCapturedReplies(title: string): void {
    for (const report of this.driver.messages(title)) expect(this.communication(report).reply).toBeUndefined();
  }
  expectArguments(title: string, number: number, expected: string[]): void { expect(this.driver.arguments(title, number)).toEqual(expected); }
  expectNoCommunication(title: string, number: number): void { expect(this.driver.message(title, number).value).toBeUndefined(); }
  expectProblem(code: string, selection: SourceSelection): void {
    const expected = this.driver.expectedSpan(selection);
    const problem = this.driver.findings().problems.find(problem => problem.code === code
      && JSON.stringify(this.driver.span(problem.at)) === JSON.stringify(expected));
    expect(problem, `Expected ${code} at ${selection.text}`).toBeDefined();
    this.problem = problem!;
  }
  expectRelated(selection: SourceSelection): void {
    expect(this.problem.related.map(origin => this.driver.span(origin))).toContainEqual(this.driver.expectedSpan(selection));
  }
  expectDeferred(reason: string, selection: SourceSelection): void {
    const requirements = this.driver.findings().deferred.filter(requirement => requirement.reason === reason);
    expect(requirements.map(requirement => this.driver.span(requirement.origin))).toContainEqual(this.driver.expectedSpan(selection));
  }
  expectOriginalProblem(code: string, selection: SourceSelection): void {
    this.expectProblem(code, selection);
    const cause = this.driver.upstreamProblems().find(problem => problem.code === code
      && JSON.stringify(this.driver.span(problem.at)) === JSON.stringify(this.driver.expectedSpan(selection)));
    expect(cause).toBeDefined();
    expect(this.problem.message).toBe(cause!.message);
    expect(this.problem.at).toEqual(cause!.at);
    expect(this.problem.related).toEqual(expect.arrayContaining([...cause!.related]));
  }
  expectOperationOrigin(title: string, number: number, origin: { module: string; path: (string | number)[] }): void {
    this.communication(this.driver.message(title, number));
    expect(this.driver.operationOrigin(title, number)).toEqual({ kind: 'external', ...origin });
  }
  rememberInspection(): void { this.driver.rememberInspection(); }
  expectInspectionUnchanged(): void {
    const { before, after } = this.driver.inspectionSnapshots();
    expect(after).toBe(before);
  }
  rememberReport(label: string): void { this.driver.rememberReport(label); }
  expectSameReportAs(label: string): void { this.sameReport(this.driver.findings(), this.driver.rememberedReport(label).snapshot); }
  expectRememberedReportUnchanged(label: string): void {
    const { report, snapshot } = this.driver.rememberedReport(label);
    this.sameReport(report, snapshot);
  }
  attemptToCheckDeclaration(name: string): void { this.driver.attemptDeclaration(name); }
  attemptToReadOtherMessage(title: string, number: number): void { this.driver.attemptOtherMessage(title, number); }
  expectQueryError(code: string): void {
    expect(this.driver.queryError()).toBeInstanceOf(QueryError);
    expect(this.driver.queryError()).toMatchObject({ code });
  }

  private communication(report: Check<Communication>): Communication {
    expect(report.problems).toEqual([]);
    expect(report.deferred).toEqual([]);
    expect(report.value).toBeDefined();
    return report.value!;
  }
  private sameReport(actual: Check<Communication>, expected: Check<Communication>): void {
    expect(actual).toEqual(expected);
    expect(actual.value?.sender).toBe(expected.value?.sender);
    expect(actual.value?.receiver).toBe(expected.value?.receiver);
    expect(actual.value?.operation).toBe(expected.value?.operation);
    expect(actual.value?.reply).toBe(expected.value?.reply);
  }
}
