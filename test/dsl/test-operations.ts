import { expect } from 'vitest';
import { OperationDriver, one } from '../driver/test-operations.js';

export class OperationExamples {
  private readonly driver = new OperationDriver();
  source(text: string, options?: { sourceId?: string; locator?: string }): void { this.driver.source(text, options); }
  module(locator: string, text: string, options?: { sourceId?: string }): void { this.driver.module(locator, text, options?.sourceId); }
  externalFunction(locator: string, name: string, signature: { inputs: Record<string, string>; result: string }): void {
    this.driver.external(locator, name, signature.inputs, signature.result);
  }
  compile(): void { this.driver.compile(); }
  checkOperation(name: string): void { this.driver.check(name); }
  checkAllOperations(): void { this.driver.checkAll(); }
  expectAccepted(): void { expect(this.driver.result).toEqual({ problems: [], deferred: [] }); }
  expectCompiled(): void { expect(this.driver.compilation).toMatchObject({ value: expect.any(Object), syntax: [], problems: [], deferred: [] }); }
  expectNoSpecification(): void { expect(this.driver.compilation?.value).toBeUndefined(); }
  expectAcceptedOperations(names: readonly string[]): void {
    expect([...this.driver.checks.keys()]).toEqual(names);
    for (const result of this.driver.checks.values()) expect(result).toEqual({ problems: [], deferred: [] });
  }
  expectBodiesAbsent(names: readonly string[]): void { for (const name of names) this.expectBody(name, 'absent'); }
  expectBody(name: string, kind: string): void { expect(this.driver.named(name)).toMatchObject({ body: { kind } }); }
  expectNoRuntimeOrProjectEffects(): void { expect(this.driver.effects).toEqual({ calls: 0, before: 'handwritten project', after: 'handwritten project' }); }
  expectCallTarget(text: string, name: string): void {
    const spec = this.driver.compilation?.value; expect(spec).toBeDefined();
    const node = one(this.driver.query('call-expression').filter(node => this.driver.text(node.origin) === text), text);
    const result = spec!.call(node.id); expect(result).toEqual({ value: this.driver.named(name).id, problems: [], deferred: [] });
    expect(result.value).toBe(this.driver.named(name).id);
  }
  expectAuthoredArguments(text: string, expected: readonly string[]): void {
    const node = one(this.driver.query('call-expression').filter(node => this.driver.text(node.origin) === text), text);
    expect(node.arguments.map(argument => this.driver.text(argument.origin))).toEqual(expected);
  }
  expectStatements(name: string, expected: readonly string[]): void { expect(this.driver.statements(name).map(node => this.driver.text(node.origin))).toEqual(expected); }
  expectDeclaredResult(name: string, expected: string): void {
    const result = this.driver.types.callable(this.driver.named(name).id).result; expect(result.status).toBe('known');
    if (result.status === 'known') expect(result.value.kind === 'value' ? this.driver.typeName(result.value.type) : result.value.kind).toBe(expected);
  }
  expectProblemAt(code: string, text: string, within?: string): void {
    expect(this.driver.result.problems.some(problem => problem.code === code && this.driver.matches(problem.at, text, within)), JSON.stringify(this.driver.result)).toBe(true);
  }
  expectProblemInFile(code: string, text: string, file: string): void {
    expect(this.driver.result.problems.some(problem => problem.code === code && this.driver.matches(problem.at, text, undefined, file))).toBe(true);
  }
  expectDeclarationProblem(code: string, name: string): void {
    expect(this.driver.result.problems).toContainEqual(expect.objectContaining({ code, at: this.driver.named(name).origin }));
  }
  expectNoProblem(code: string): void { expect(this.driver.result.problems.map(problem => problem.code)).not.toContain(code); }
  expectRequirementAt(reason: string, text: string): void {
    expect(this.driver.result.deferred.some(requirement => requirement.reason === reason && this.driver.matches(requirement.origin, text))).toBe(true);
  }
  expectNoRequirement(reason: string): void { expect(this.driver.result.deferred.map(requirement => requirement.reason)).not.toContain(reason); }
  expectOriginalCauseRelatedTo(within: string): void {
    expect(this.driver.result.problems.some(problem => problem.related.some(at => at.kind === 'source' && within.includes(this.driver.text(at))
      && this.driver.matches(at, this.driver.text(at), within)))).toBe(true);
  }
  expectRelatedParameter(name: string, parameter: string): void {
    const operation = this.driver.named(name); if (!('parameters' in operation)) throw new Error('Expected callable');
    const origin = one(operation.parameters.filter(node => node.name === parameter), parameter).origin;
    expect(this.driver.result.problems.some(problem => problem.code === 'duplicate-local' && problem.related.some(at => JSON.stringify(at) === JSON.stringify(origin)))).toBe(true);
  }
  expectRelatedLocal(text: string): void { this.expectRelatedText('duplicate-local', text); }
  expectRelatedReturn(text: string): void { this.expectRelatedText('unreachable-statement', text); }
  private expectRelatedText(code: string, text: string): void {
    expect(this.driver.result.problems.some(problem => problem.code === code && problem.related.some(at => this.driver.text(at) === text))).toBe(true);
  }
  expectNoSyntheticResultInBody(): void {
    const references = this.driver.query('reference').filter(node => node.segments.join('.') === 'result'); expect(references.length).toBeGreaterThan(0);
    for (const node of references) expect(node.resolution).not.toMatchObject({ status: 'deferred', requirement: { reason: 'contextual-result' } });
  }
  expectNoFindingIn(within: string): void {
    for (const at of [...this.driver.result.problems.map(problem => problem.at), ...this.driver.result.deferred.map(requirement => requirement.origin)]) {
      expect(this.driver.matches(at, this.driver.text(at), within)).toBe(false);
    }
  }
  expectNoFindingInFile(file: string): void {
    for (const at of [...this.driver.result.problems.map(problem => problem.at), ...this.driver.result.deferred.map(requirement => requirement.origin)]) {
      expect(at.kind === 'source' ? at.range.sourceId : undefined).not.toBe(file);
    }
  }
  expectParameterType(name: string, parameter: string, type: string): void {
    const signature = this.driver.types.callable(this.driver.named(name).id);
    const slot = one(signature.parameters.filter(slot => this.driver.types.inspection.read(slot.declaration, 'parameter').name === parameter), parameter);
    expect(slot.type.status).toBe('known'); if (slot.type.status === 'known') expect(this.driver.typeName(slot.type.value)).toBe(type);
  }
  expectDeclarationSource(name: string, file: string): void { expect(this.driver.named(name).origin).toMatchObject({ kind: 'source', range: { sourceId: file } }); }
}
