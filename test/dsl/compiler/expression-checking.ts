import { expect } from 'vitest';
import type { ExternalDefinition } from '../../../src/index.js';
import { ExpressionCheckingDriver } from '../../driver/compiler/expression-checking.js';

/** Consumer actions and observations; source fixtures only select expressions to check. */
export class ExpressionChecking {
  private readonly driver = new ExpressionCheckingDriver();
  source(text: string): void { this.driver.source(text); }
  module(locator: string, text: string): void { this.driver.module(locator, text); }
  externalModule(locator: string, definitions: readonly ExternalDefinition[]): void { this.driver.externalModule(locator, definitions); }
  available(...names: string[]): void { this.driver.available(names); }
  typeOf(name: string): void { this.driver.typeOf(name); }
  checkValue(name: string): void { this.driver.checkValue(name); }
  checkCall(name: string): void { this.driver.checkCall(name); }
  checkCondition(name: string): void { this.driver.checkCondition(name); }
  checkExpectation(name: string): void { this.driver.checkExpectation(name); }
  checkDefault(owner: string, name: string): void { this.driver.checkDefault(owner, name); }
  checkContract(name: string): void { this.driver.checkContract(name); }
  expectType(type: string): void { expect(this.driver.typeLabel()).toBe(type); this.expectValid(); }
  expectValid(): void { expect(this.driver.findings().problems).toEqual([]); expect(this.driver.findings().deferred).toEqual([]); }
  expectProblem(code: string, at?: string): void {
    const problems = this.driver.findings().problems.filter(problem => problem.code === code && (at === undefined || this.driver.textAt(problem.at) === at));
    expect(problems, `Expected ${code}${at === undefined ? '' : ` at ${at}`}`).not.toEqual([]);
  }
  expectDeferred(reason: string): void { expect(this.driver.findings().deferred.map(item => item.reason)).toContain(reason); }
  expectNoProblems(): void { expect(this.driver.findings().problems).toEqual([]); }
  expectOriginalProblem(code: string): void {
    const cause = this.driver.causes().problems.find(problem => problem.code === code);
    expect(cause).toBeDefined();
    expect(this.driver.findings().problems).toContain(cause);
  }
  expectOriginalRequirement(reason: string): void {
    const cause = this.driver.causes().deferred.find(requirement => requirement.reason === reason);
    expect(cause).toBeDefined();
    expect(this.driver.findings().deferred).toContain(cause);
  }
  expectPromises(text: string[]): void { expect(this.driver.promises()).toEqual(text); }
  expectRecordEntries(name: string, fields: string[]): void { expect(this.driver.recordEntries(name)).toEqual(fields); }
  expectScopeReference(name: string): void {
    const { references, target } = this.driver.scopeReferences(name);
    expect(references).toContainEqual(expect.objectContaining({
      kind: 'reference', segments: [name], resolution: { status: 'bound', target },
    }));
  }
}
