import { expect } from 'vitest';
import type { ExternalDefinition, TypeFact } from '../../src/index.js';
import { TypeDescriptionsDriver } from '../driver/type-descriptions.js';

/** Domain actions and expectations for a consumer of type and callable descriptions. */
export class TypeDescriptions {
  private readonly driver = new TypeDescriptionsDriver();

  source(text: string, locator?: string): void { this.driver.source(text, locator); }
  module(locator: string, text: string): void { this.driver.module(locator, text); }
  external(definitions: readonly ExternalDefinition[]): void { this.driver.external(definitions); }
  externalModule(locator: string, definitions: readonly ExternalDefinition[]): void { this.driver.externalModule(locator, definitions); }
  analyze(): void { this.driver.analyze(); }
  describe(name: string): void { this.driver.describe(name); }
  describeCallables(): void { this.driver.analyze(); }
  followField(name: string): void { this.driver.followField(name); }
  followArgument(index: number): void { this.driver.followArgument(index); }

  expectType(name: string): void { expect(this.driver.selectedLabel()).toBe(name); }
  expectTupleElements(names: string[]): void { expect(this.driver.tupleElements()).toEqual({ kind: 'tuple', elements: names }); }
  expectOpenParameters(first: string, second: string): void {
    const { elements, parameter, other, node } = this.driver.openParameters(first, second);
    expect(elements[0]).toBe(elements[1]);
    expect(parameter.kind).toBe('parameter');
    expect(other.kind).toBe('parameter');
    expect(parameter.declaration).not.toBe(other.declaration);
    expect(node).toBeDefined();
  }
  expectDistinctDeclarations(first: string, second: string): void {
    const one = this.driver.declared(first), two = this.driver.declared(second);
    expect(one.declaration).not.toBe(two.declaration);
    expect(one.type).not.toBe(two.type);
  }
  expectAlias(name: string, target: string): void {
    const alias = this.driver.alias();
    expect(alias.kind).toBe('alias');
    expect(alias.declaration).toBe(this.driver.declared(name).declaration);
    expect(known(alias.target)).toBe(this.driver.declared(target).type);
  }
  expectSelectedDeclaration(name: string): void { expect(this.driver.selectedDeclaration()).toBe(this.driver.declared(name).declaration); }
  expectFields(names: string[]): void { expect(known(this.driver.fields())).toEqual({ kind: 'available', fields: names }); }
  expectOpaque(): void { expect(this.driver.fields()).toEqual({ status: 'known', value: { kind: 'opaque' } }); }
  expectFieldType(name: string, type: string): void { expect(this.driver.label(known(this.driver.field(name).type))).toBe(type); }
  expectFieldProblem(name: string, code: string, at: string): void { this.expectFailure(this.driver.field(name).type, code, at); }
  expectAliasProblem(code: string, at: string): void { this.expectFailure(this.driver.alias().target, code, at); }
  expectAliasDeferred(reason: string): void {
    const target = this.driver.alias().target;
    expect(target.status).toBe('deferred');
    if (target.status !== 'deferred') throw new Error('Expected a deferred alias target');
    expect(target.requirements.map(item => item.reason)).toContain(reason);
    for (const requirement of target.requirements) expect(this.driver.findings().deferred).toContain(requirement);
  }
  expectMixedAliasFailure(code: string, reason: string): void {
    const target = this.driver.alias().target;
    if (target.status !== 'invalid') throw new Error('Expected an invalid alias target');
    expect(target.problems.map(problem => problem.code)).toContain(code);
    expect(target.deferred.map(item => item.reason)).toContain(reason);
    for (const requirement of target.deferred) expect(this.driver.findings().resolutionDeferred).toContain(requirement);
  }
  expectParameters(name: string, parameters: string[]): void { expect(this.driver.parameters(name)).toEqual(parameters); }
  expectParameterProblem(callable: string, parameter: string, code: string, at: string): void {
    this.expectFailure(this.driver.parameter(callable, parameter).type, code, at);
  }
  expectParameterType(callable: string, parameter: string, type: string): void {
    expect(this.driver.label(known(this.driver.parameter(callable, parameter).type))).toBe(type);
  }
  expectResult(name: string, expected: { kind: 'value'; type: string } | { kind: 'none' | 'unspecified' }): void {
    expect(known(this.driver.result(name))).toEqual(expected);
  }
  expectResultProblem(name: string, code: string, at: string): void { this.expectFailure(this.driver.result(name), code, at); }
  expectCallableProblem(name: string, code: string): void { expect(this.driver.callableProblems(name).map(problem => problem.code)).toContain(code); }
  expectConstruction(name: string, parameters: string[] | undefined): void {
    const result = known(this.driver.construction(name));
    expect(result?.parameters).toEqual(parameters);
    if (result) expect(result.node).toBeDefined();
  }
  expectConstructionProblem(name: string, code: string): void {
    const fact = this.driver.construction(name);
    expect(fact.status).toBe('invalid');
    if (fact.status !== 'invalid') throw new Error('Expected invalid construction');
    expect(fact.problems.map(problem => problem.code)).toContain(code);
    for (const problem of fact.problems) expect(this.driver.findings().resolutionProblems).toContain(problem);
  }
  expectExternalDefault(callable: string, parameter: string): void {
    const payload = this.driver.externalDefault(callable, parameter);
    expect(payload).toMatchObject({ hasDefault: true });
    expect(payload.defaultValue).toBeUndefined();
  }
  expectBody(callable: string, kind: string): void { expect(this.driver.body(callable)).toBe(kind); }
  expectDeclarations(types: string[], callables: string[]): void { expect(this.driver.declarations()).toEqual({ types, callables }); }
  expectProblem(code: string, at?: string, related?: string): void {
    const problem = this.driver.findings().problems.find(problem => problem.code === code && (!at || this.driver.textAt(problem.at) === at));
    expect(problem, `Expected ${code}${at ? ` at ${at}` : ''}`).toBeDefined();
    if (related) expect(problem!.related.map(location => this.driver.textAt(location))).toContain(related);
  }
  expectCircularAliasAtLines(lines: number[]): void {
    const target = this.driver.alias().target;
    if (target.status !== 'invalid') throw new Error('Expected an invalid alias target');
    const cycle = target.problems.find(problem => problem.code === 'circular-alias');
    expect(cycle).toBeDefined();
    expect([...new Set([cycle!.at, ...cycle!.related].flatMap(location => location.kind === 'source' ? [location.range.start.line] : []))].sort()).toEqual(lines);
  }
  expectNoProblems(): void { expect(this.driver.findings().problems).toEqual([]); expect(this.driver.findings().resolutionProblems).toEqual([]); }
  expectNoTypeProblems(): void { expect(this.driver.findings().problems).toEqual([]); }
  expectOnlyBodyDeferred(): void {
    expect(this.driver.findings().resolutionDeferred.map(item => item.reason)).toContain('receiver-type');
    expect(this.driver.findings().deferred).toEqual([]);
  }
  expectUnchangedAfterQueries(): void {
    const { declarations, findings, references, inspection, resolution } = this.driver.afterQueries();
    for (const declaration of declarations) expect(declaration.after).toBe(declaration.before);
    expect(findings.after).toBe(findings.before);
    expect(references.after).toBe(references.before);
    expect(inspection).toBe(resolution);
  }
  expectIndependentCatalog(): void {
    const { error, selected, original, description, type } = this.driver.independentCatalog();
    expect(error).toEqual(expect.objectContaining({ code: 'unknown-type', typeId: selected }));
    expect(description).toMatchObject({ declaration: original.declaration });
    expect(type).not.toBe(selected);
  }
  expectLiteralOrigins(spellings: string[]): void { expect(this.driver.literalOrigins()).toEqual(spellings); }

  private expectFailure<T>(fact: TypeFact<T>, code: string, at: string): void {
    expect(fact.status).toBe('invalid');
    if (fact.status !== 'invalid') throw new Error('Expected an invalid type fact');
    const problem = fact.problems.find(problem => problem.code === code && this.driver.textAt(problem.at) === at);
    expect(problem, `Expected ${code} at ${at}`).toBeDefined();
    if (this.driver.findings().resolutionProblems.some(cause => cause.code === code)) expect(this.driver.findings().resolutionProblems).toContain(problem);
  }
}

function known<T>(fact: TypeFact<T>): T {
  expect(fact.status).toBe('known');
  if (fact.status !== 'known') throw new Error(`Expected a known fact: ${JSON.stringify(fact)}`);
  return fact.value;
}
