import { expect } from 'vitest';
import type { Check, NodeId, Origin, QueryErrorCode, ScenarioCapture, ScenarioStep, Specification } from '../../../src/index.js';
import { CheckedQueryDriver, known, one } from '../../driver/compiler/checked-queries.js';

type Capture = { name: string; type: string };
export class CheckedQueries {
  private readonly driver = new CheckedQueryDriver();
  private tests!: Check<NodeId>;
  private documentation!: Check<NodeId>;
  private remembered!: { spec: Specification; call?: NodeId; step?: NodeId; operation?: Check<NodeId>; answer?: Check<ScenarioStep>; captures?: readonly ScenarioCapture[] };
  source(locator: string, text: string): void { this.driver.source(locator, text); }
  module(locator: string, text: string): void { this.driver.module(locator, text); }
  compile(): void { this.driver.compile(); expect(this.driver.result.syntax).toEqual([]); }
  compileComposed(): void { this.driver.compile(true); expect(this.driver.result.syntax).toEqual([]); }
  compileUsingSameCompiler(): void { this.compile(); }
  compileFresh(): void { this.compile(); }
  collectOperationForTests(text: string): void { this.tests = this.driver.specification().call(this.driver.expression(text).id); }
  collectOperationForDocumentation(text: string): void { this.documentation = this.driver.specification().call(this.driver.expression(text).id); }
  expectBothConsumersToSelect(name: string): void {
    expect(value(this.tests)).toBe(this.driver.named(name).id);
    expect(value(this.documentation)).toBe(this.driver.named(name).id);
  }
  expectSelectedOperation(text: string, name: string): void {
    expect(value(this.driver.specification().call(this.driver.expression(text).id))).toBe(this.driver.named(name).id);
  }
  expectAuthoredCallee(text: string, expected: string): void { expect(this.driver.text(this.driver.call(text).callee.origin)).toBe(expected); }
  expectAuthoredArguments(text: string, expected: string[]): void { expect(this.driver.call(text).arguments.map(node => this.driver.text(node.origin))).toEqual(expected); }
  expectCallOrigin(text: string, expected: { module: string; sourceId: string }): void { this.origin(this.driver.expression(text).origin, expected); }
  expectSelectedOperationOrigin(text: string, expected: { module: string; sourceId: string }): void {
    const spec = this.driver.specification();
    this.origin(spec.inspection.read(value(spec.call(this.driver.expression(text).id))).origin, expected);
  }
  private origin(origin: Origin, expected: { module: string; sourceId: string }): void {
    expect(origin).toMatchObject({ kind: 'source', module: expected.module, range: { sourceId: expected.sourceId } });
  }
  expectSelectedOperationOwner(text: string, expected: string): void {
    const spec = this.driver.specification();
    expect(spec.inspection.parent(value(spec.call(this.driver.expression(text).id)))?.id).toBe(this.driver.named(expected).id);
  }
  expectProseExpectation(title: string, expected: string): void {
    const prose = this.driver.titled('example', title).expected;
    expect(prose.kind).toBe('prose-expectation');
    if (prose.kind !== 'prose-expectation') throw new Error('Expected prose');
    expect(prose.text.value).toBe(expected);
  }
  expectDeclaredBody(name: string, expected: string): void {
    const declaration = this.driver.named(name);
    if (!('body' in declaration)) throw new Error('Expected a callable');
    expect(declaration.body.kind).toBe(expected);
  }
  expectDeclaredResult(name: string, expected: string): void {
    expect(known(this.driver.specification().types.callable(this.driver.named(name).id).result).kind).toBe(expected);
  }
  expectParameterDefault(name: string, parameter: string, expected: string): void {
    const declaration = this.driver.named(name);
    if (!('parameters' in declaration)) throw new Error('Expected callable parameters');
    const input = one(declaration.parameters.filter(node => node.name === parameter), parameter);
    expect(input.hasDefault).toBe(true);
    expect(input.defaultValue && this.driver.text(input.defaultValue.origin)).toBe(expected);
  }
  expectAvailableCaptures(title: string, index: number, expected: Capture[]): void {
    const spec = this.driver.specification(), captures = value(spec.step(this.driver.step(title, index).id)).available;
    expect(captures).toHaveLength(expected.length);
    expected.forEach((entry, position) => this.capture(captures[position]!, entry, spec));
    for (const capture of captures) expect(this.driver.titled('scenario', title).steps.slice(0, index).some(step => 'capture' in step && step.capture?.id === capture.name)).toBe(true);
  }
  expectStepCapture(title: string, index: number, expected: Capture | undefined): void {
    const spec = this.driver.specification(), step = this.driver.step(title, index), capture = value(spec.step(step.id)).capture;
    if (!expected) expect(capture).toBeUndefined();
    else {
      expect(capture).toBeDefined();
      this.capture(capture!, expected, spec);
      expect(capture!.name).toBe('capture' in step ? step.capture?.id : undefined);
    }
  }
  private capture(capture: ScenarioCapture, expected: Capture, spec: Specification): void {
    expect(spec.inspection.read(capture.name, 'name').decoded).toBe(expected.name);
    expect(capture.type).toBe(this.driver.namedType(expected.type, spec));
  }
  expectCaptureHandleIsAuthoredName(title: string, index: number): void {
    const step = this.driver.step(title, index);
    expect(value(this.driver.specification().step(step.id)).capture!.name).toBe('capture' in step ? step.capture?.id : undefined);
  }
  expectDistinctCaptureHandles(first: string, firstIndex: number, second: string, secondIndex: number): void {
    const spec = this.driver.specification();
    expect(value(spec.step(this.driver.step(first, firstIndex).id)).capture!.name).not.toBe(value(spec.step(this.driver.step(second, secondIndex).id)).capture!.name);
  }
  expectOriginalReceiverBindingStillDeferred(text: string): void {
    const receiver = this.driver.specification().inspection.read(this.driver.call(text).callee.id);
    if (receiver.kind !== 'member-expression' || receiver.receiver.kind !== 'name-expression') throw new Error('Expected a named receiver');
    expect(receiver.receiver.reference.resolution).toMatchObject({ status: 'deferred', requirement: { reason: 'ordered-scope' } });
  }
  expectOriginalResultBindingStillDeferred(text: string): void {
    const argument = this.driver.call(text).arguments[0]!;
    if (argument.kind !== 'name-expression') throw new Error('Expected a named result');
    expect(argument.reference.resolution).toMatchObject({ status: 'deferred', requirement: { reason: 'contextual-result' } });
  }
  expectArgumentReferenceTargetsFixture(text: string, name: string): void {
    const argument = this.driver.call(text).arguments[0]!;
    if (argument.kind !== 'name-expression') throw new Error('Expected a named fixture');
    expect(argument.reference.resolution.status).toBe('bound');
    if (argument.reference.resolution.status === 'bound') expect(argument.reference.resolution.target).toBe(this.driver.named(name).id);
  }
  expectFixtureType(name: string, expected: string): void {
    const fixture = this.driver.named(name), spec = this.driver.specification();
    if (fixture.kind !== 'fixture') throw new Error('Expected a fixture');
    expect(known(spec.types.typeOf(fixture.declaredType.id))).toBe(this.driver.namedType(expected));
  }
  expectProblemAt(code: string, text: string, within?: string): void { this.problemAt(code, text, this.driver.expectedOffset(text, within)); }
  expectProblemAtOccurrence(code: string, text: string, occurrence: number): void { this.problemAt(code, text, this.driver.expectedOffset(text, undefined, occurrence)); }
  private problemAt(code: string, text: string, offset: number): void {
    expect(this.driver.result.problems.some(problem => problem.code === code && problem.at.kind === 'source'
      && problem.at.range.start.offset === offset && this.driver.text(problem.at) === text)).toBe(true);
  }
  expectRequirementAt(reason: string, text: string): void {
    expect(this.driver.result.deferred.some(requirement => requirement.reason === reason && this.driver.text(requirement.origin) === text)).toBe(true);
  }
  expectRequirement(reason: string): void { expect(this.driver.result.deferred.map(requirement => requirement.reason)).toContain(reason); }
  expectNoSpecification(): void { expect(this.driver.result.value).toBeUndefined(); }
  expectNoCompilerProblems(): void { expect(this.driver.result.problems).toEqual([]); expect(this.driver.result.deferred).toEqual([]); }
  expectSelectedMessageOperation(title: string, index: number, name: string): void {
    expect(value(this.driver.specification().message(this.driver.message(title, index).id)).operation).toBe(this.driver.named(name).id);
  }
  expectNoScenarioStepForMessage(title: string, index: number): void {
    error(() => this.driver.specification().step(this.driver.message(title, index).id), 'unexpected-kind');
  }
  rememberSpecificationAndHandles(): void { this.remembered = { spec: this.driver.specification() }; }
  rememberSpecificationAndAnswers(call: string, title: string, index: number): void {
    const spec = this.driver.specification(), callId = this.driver.expression(call).id, stepId = this.driver.step(title, index).id;
    const answer = spec.step(stepId);
    value(answer);
    this.remembered = { spec, call: callId, step: stepId, operation: spec.call(callId), answer, captures: value(answer).available.map(capture => ({ ...capture })) };
  }
  rememberStepAnswer(title: string, index: number): void {
    const spec = this.driver.specification(), step = this.driver.step(title, index).id, answer = spec.step(step);
    this.remembered = { spec, step, answer, captures: value(answer).available.map(capture => ({ ...capture })) };
  }
  tryToMutateReturnedCaptures(title: string, index: number): void {
    const captures = value(this.driver.specification().step(this.driver.step(title, index).id)).available as { name: NodeId; type: object }[];
    try { captures[0]!.name = this.driver.named('Number').id; } catch (error) { expect(error).toBeInstanceOf(TypeError); }
    try { captures[0]!.type = {}; } catch (error) { expect(error).toBeInstanceOf(TypeError); }
    try { captures.length = 0; } catch (error) { expect(error).toBeInstanceOf(TypeError); }
  }
  expectRememberedStepAnswerUnchanged(): void {
    expect(value(this.remembered.answer!).available).toEqual(this.remembered.captures);
    expect(value(this.remembered.spec.step(this.remembered.step!)).available).toEqual(this.remembered.captures);
    value(this.remembered.answer!).available.forEach((capture, index) => {
      expect(capture.name).toBe(this.remembered.captures![index]!.name);
      expect(capture.type).toBe(this.remembered.captures![index]!.type);
    });
  }
  expectRememberedAnswersUnchanged(): void {
    expect(value(this.remembered.spec.call(this.remembered.call!))).toBe(value(this.remembered.operation!));
    this.expectRememberedStepAnswerUnchanged();
  }
  expectRememberedCaptureType(name: string, type: string): void {
    const capture = one(value(this.remembered.answer!).available.filter(item => this.remembered.spec.inspection.read(item.name, 'name').decoded === name), name);
    this.capture(capture, { name, type }, this.remembered.spec);
  }
  expectFreshCurrentHandles(): void {
    const old = [...this.remembered.spec.inspection.query('call-expression')][0]!;
    expect(this.driver.query('call-expression')[0]!.id).not.toBe(old.id);
  }
  expectCallQueryErrorForDeclaration(name: string, code: QueryErrorCode): void { error(() => this.driver.specification().call(this.driver.named(name).id), code); }
  expectCallQueryErrorForExpression(text: string, code: QueryErrorCode): void { error(() => this.driver.specification().call(this.driver.expression(text).id), code); }
  expectStepQueryErrorForExample(title: string, code: QueryErrorCode): void { error(() => this.driver.specification().step(this.driver.titled('example', title).id), code); }
  expectCallQueryErrorForRememberedHandle(text: string, code: QueryErrorCode): void { error(() => this.driver.specification().call(this.driver.expression(text, this.remembered.spec).id), code); }
  expectStepQueryErrorForRememberedHandle(title: string, index: number, code: QueryErrorCode): void { error(() => this.driver.specification().step(this.driver.step(title, index, this.remembered.spec).id), code); }
  expectRememberedSelectedOperation(text: string, name: string): void {
    expect(value(this.remembered.spec.call(this.driver.expression(text, this.remembered.spec).id))).toBe(this.driver.named(name, this.remembered.spec).id);
  }
}
function value<T>(check: Check<T>): T {
  expect(check.problems).toEqual([]); expect(check.deferred).toEqual([]); expect(check.value).toBeDefined();
  return check.value!;
}
function error(action: () => unknown, code: QueryErrorCode): void { expect(action).toThrow(expect.objectContaining({ name: 'QueryError', code })); }
