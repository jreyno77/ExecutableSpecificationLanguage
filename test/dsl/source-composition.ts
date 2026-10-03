import { expect } from 'vitest';
import type { Diagnostic, ExternalDefinition, ProblemLocation, TypeFact, TypeId } from '../../src/index.js';
import { CompositionDriver, modelState } from '../driver/source-composition.js';

export class CompositionExamples {
  private readonly driver = new CompositionDriver();
  private problem!: Diagnostic;
  entry(module: string, text: string): void { this.driver.source(module, text, true); }
  module(module: string, text: string): void { this.driver.source(module, text); }
  externalModule(module: string, definitions: readonly ExternalDefinition[]): void { this.driver.external(module, definitions); }
  mapsModule(owner: string, authored: string, supplied: string): void { this.driver.maps(owner, authored, supplied); }
  compose(): void { this.driver.compose(); }
  compile(): void { this.driver.compile(); }
  expectCompiled(): void {
    expect(this.driver.compilation.syntax).toEqual([]);
    expect(this.driver.compilation.problems).toEqual([]);
    expect(this.driver.compilation.deferred).toEqual([]);
    expect(this.driver.compilation.value).toBeDefined();
  }
  expectNoSpecification(): void { expect(this.driver.compilation.value).toBeUndefined(); }
  expectParameterType(module: string, callable: string, parameter: string, targetModule: string, type: string): void {
    expectType(this.driver.parameterType(module, callable, parameter), this.driver.declaredType(targetModule, type));
  }
  expectFieldType(module: string, record: string, field: string, targetModule: string, type: string): void {
    expectType(this.driver.fieldType(module, record, field), this.driver.declaredType(targetModule, type));
  }
  expectSameFieldAndParameterType(module: string, record: string, field: string, targetModule: string, callable: string, parameter: string): void {
    const target = this.driver.parameterType(targetModule, callable, parameter);
    expect(target.status).toBe('known');
    if (target.status !== 'known') throw new Error('Expected a known parameter type');
    expectType(this.driver.fieldType(module, record, field), target.value);
  }
  expectOriginalDeclarationIdentity(module: string, name: string): void {
    const original = this.driver.declaration(module, name), composed = this.driver.readOriginal(module, name);
    expect(composed.id).toBe(original.id);
    expect(composed.origin).toEqual(original.origin);
  }
  expectAuthoredLocator(module: string, locator: string): void { expect(this.driver.originalLocators(module)).toContain(locator); }
  expectDeclarationCount(name: string, count: number): void { expect(this.driver.declarationsNamed(name)).toHaveLength(count); }
  expectNotAnalyzed(module: string, name: string): void {
    expect(() => this.driver.readOriginal(module, name)).toThrowError(expect.objectContaining({ code: 'not-analyzed' }));
  }
  expectProblem(code: string, module: string, text: string, position: { line: number }): void {
    const expected = this.driver.located(module, text, position.line);
    const problem = this.driver.compilation.problems.find(problem => problem.code === code && matches(problem.at, expected));
    expect(problem, JSON.stringify(this.driver.compilation.problems)).toBeDefined();
    this.problem = problem!;
  }
  expectRelatedOrigin(module: string, text: string, position: { line: number }): void {
    expect(this.problem.related.some(at => matches(at, this.driver.located(module, text, position.line)))).toBe(true);
  }
  expectRelatedOrigins(origins: readonly { module: string; text: string; line: number }[]): void {
    for (const origin of origins) this.expectRelatedOrigin(origin.module, origin.text, origin);
  }
  expectRelatedDependency(path: readonly (string | number)[]): void {
    expect(this.problem.related).toContainEqual({ kind: 'dependency', path });
  }
  expectNoProblem(code: string): void { expect(this.driver.compilation.problems.some(problem => problem.code === code)).toBe(false); }
  expectNoPendingComposition(): void {
    this.expectNoProblem('composition-required');
    expect(this.driver.compilation.deferred.some(requirement => requirement.reason === 'composition')).toBe(false);
  }
  expectDeferred(reason: string, module: string, position: { line: number }): void {
    expect(this.driver.compilation.deferred.some(requirement => requirement.reason === reason
      && requirement.origin.kind === 'source' && requirement.origin.module === module
      && requirement.origin.range.start.line === position.line)).toBe(true);
  }
  expectExternalFieldOrigin(module: string, record: string, field: string, path: readonly (string | number)[]): void {
    const node = this.driver.declaration(module, record + '.' + field);
    expect(this.driver.resolution.model.node(node.id).origin).toEqual({ kind: 'external', module, path });
  }
  rememberResult(name: string): void { this.driver.remember(name); }
  expectRememberedResultUnchanged(name: string): void {
    const remembered = this.driver.remembered.get(name)!;
    expectState(modelState(remembered.resolution.model), remembered.state);
    expect(JSON.stringify(remembered.compilation)).toBe(remembered.findings);
  }
  expectAuthoredModelsUnchanged(): void {
    for (const [model, state] of this.driver.inputs) expectState(modelState(model), state);
  }
}
function expectType(fact: TypeFact<TypeId>, expected: TypeId): void {
  expect(fact.status, JSON.stringify(fact)).toBe('known');
  if (fact.status === 'known') expect(fact.value).toBe(expected);
}
function matches(at: ProblemLocation, expected: ReturnType<CompositionDriver['located']>): boolean {
  return at.kind === 'source' && at.module === expected.module && at.range.sourceId === expected.sourceId
    && at.range.start.line === expected.line && at.range.start.column === expected.column && at.range.start.offset === expected.offset;
}
function expectState(actual: ReturnType<typeof modelState>, expected: ReturnType<typeof modelState>): void {
  expect(actual.facts).toBe(expected.facts);
  expect(actual.ids).toHaveLength(expected.ids.length);
  expect(actual.roots).toHaveLength(expected.roots.length);
  expect(actual.targets).toHaveLength(expected.targets.length);
  actual.ids.forEach((id, index) => expect(id).toBe(expected.ids[index]));
  actual.roots.forEach((id, index) => expect(id).toBe(expected.roots[index]));
  actual.parents.forEach((id, index) => expect(id).toBe(expected.parents[index]));
  actual.targets.forEach((id, index) => expect(id).toBe(expected.targets[index]));
  actual.children.forEach((children, index) => {
    expect(children).toHaveLength(expected.children[index]!.length);
    children.forEach((id, child) => expect(id).toBe(expected.children[index]![child]));
  });
}
