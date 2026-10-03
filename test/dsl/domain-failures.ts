import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import type { ExternalDefinition, TypeFact } from '../../src/index.js';
import { FailureDriver, causes, known, requirements } from '../driver/domain-failures.js';

export class FailureExamples {
  readonly driver = new FailureDriver();
  source(text: string): void { this.driver.text = text; }
  revise(text: string): void { this.source(text); }
  module(locator: string, text: string): void { this.driver.modules.set(locator, text); }
  externalModule(locator: string, definitions: readonly ExternalDefinition[]): void { this.driver.modules.set(locator, definitions); }
  compile(): void { this.driver.compile(); }
  describeTypes(): void { this.driver.analyze(); }
  expectAcceptedSpecification(): void { expect(this.driver.compilation.syntax).toEqual([]); expect(this.driver.compilation.problems).toEqual([]); expect(this.driver.compilation.deferred).toEqual([]); expect(this.driver.compilation.value).toBeDefined(); }
  expectNoAcceptedSpecification(): void { expect(this.driver.compilation.value).toBeUndefined(); }
  expectNoCompilerProblems(): void { expect(this.driver.compilation.problems).toEqual([]); }
  expectNoProblem(code: string): void { expect(this.driver.compilation.problems.some(problem => problem.code === code)).toBe(false); }
  expectSuccessfulResult(name: string, expected: string): void {
    const result = known(this.driver.signature(name).result);
    expect(result.kind === 'value' ? this.driver.label(result.type) : result.kind === 'none' ? 'Nothing' : 'unspecified').toBe(expected);
  }
  expectDeclaredFailures(name: string, expected: string[]): void { expect(this.driver.signature(name).failures.map(fact => this.driver.label(known(fact)))).toEqual(expected); }
  expectErrorCodes(name: string, codes: string[]): void { expect(known(this.driver.error(name)).codes).toEqual(codes); }
  expectErrorFields(name: string, fields: string[]): void {
    expect(known(this.driver.error(name)).fields.map(slot => this.driver.name(slot.declaration) === 'code' ? 'code'
      : this.driver.name(slot.declaration) + ': ' + this.driver.label(known(slot.type)))).toEqual(fields);
  }
  collectFailuresForCode(name: string): void { this.driver.collect(name, false); }
  collectFailuresForDocumentation(name: string): void { this.driver.collect(name, true); }
  expectBothConsumersToRead(name: string, codes: string[]): void {
    expect(this.driver.consumers.map(error => ({ name: this.driver.name(error.declaration), codes: error.codes }))).toEqual([{ name, codes }, { name, codes }]);
  }
  expectBothConsumersToUseTheInspectedDeclaration(name: string): void {
    expect(this.driver.consumers).toHaveLength(2);
    for (const error of this.driver.consumers) expect(error.declaration).toBe(this.driver.node(name).id);
  }
  expectFailureFieldSlotsToMatchRecordFields(name: string): void {
    const fields = known(this.driver.types.fields(this.driver.type(name)));
    expect(fields.kind).toBe('available');
    if (fields.kind === 'available') {
      const described = known(this.driver.error(name)).fields;
      expect(described).toHaveLength(fields.fields.length);
      for (const [index, slot] of described.entries()) {
        const field = fields.fields[index]!;
        expect(slot.declaration).toBe(field.declaration);
        expect(slot.type).toEqual(field.type);
        if (slot.type.status === 'known' && field.type.status === 'known') expect(slot.type.value).toBe(field.type.value);
      }
    }
  }
  expectFixtureType(name: string, expected: string): void {
    const fixture = [...this.driver.types.inspection.query('fixture')].find(node => node.name === name)!;
    expect(this.driver.label(known(this.driver.types.typeOf(fixture.declaredType.id)))).toBe(expected);
  }
  expectNoGeneratedOrExecutedApplication(): void { expect(this.driver.effects).toBe(0); }
  expectProblemAt(code: string, text: string, within?: string): void {
    expect(this.driver.compilation.syntax).toEqual([]);
    expect(this.driver.compilation.problems.some(problem => problem.code === code && this.driver.location(problem.at, text, within))).toBe(true);
  }
  expectProblemAtOccurrence(code: string, text: string, occurrence: number): void {
    expect(this.driver.compilation.problems.some(problem => problem.code === code && this.driver.location(problem.at, text, undefined, occurrence))).toBe(true);
  }
  expectRelatedCodeOccurrence(text: string, occurrence: number): void {
    expect(this.driver.compilation.problems.some(problem => problem.related.some(at => this.driver.location(at, text, undefined, occurrence)))).toBe(true);
  }
  expectRelatedFailure(text: string, within: string): void {
    expect(this.driver.compilation.problems.some(problem => problem.code === 'duplicate-failure' && problem.related.some(at => this.driver.location(at, text, within)))).toBe(true);
  }
  expectDeclaredFailureOrigin(callable: string, module: string, name: string): void {
    const error = known(this.driver.types.error(known(this.driver.failure(callable, 0))));
    expect(this.driver.types.inspection.read(error.declaration).origin).toMatchObject({ module });
    expect(this.driver.name(error.declaration)).toBe(name);
  }
  expectFailurePayloadType(callable: string, failure: string, field: string, expected: string): void {
    const fact = this.driver.signature(callable).failures.find(fact => fact.status === 'known' && this.driver.label(fact.value) === failure)!;
    const slot = known(this.driver.types.error(known(fact))).fields.find(slot => this.driver.name(slot.declaration) === field)!;
    expect(this.driver.label(known(slot.type))).toBe(expected);
  }
  expectFailureOrigins(name: string, expected: string[]): void {
    const node = this.driver.node(name);
    if (!('failures' in node)) throw new Error('Expected callable');
    expect(node.failures.map(item => this.driver.at(item.origin))).toEqual(expected);
  }
  expectFailureOriginKind(name: string, kind: string): void {
    const error = known(this.driver.types.error(known(this.driver.failure(name, 0))));
    expect(this.driver.types.inspection.read(error.declaration).origin.kind).toBe(kind);
  }
  expectNoSyntheticSourceText(): void {
    expect([...this.driver.types.inspection.query('record-type-declaration')].every(node => node.origin.kind === 'external')).toBe(true);
  }
  loadBaselineFromReleaseBeforeDomainFailures(): void {
    const result = this.driver.identity.identity.read({ sourceId: 'pre-error-baseline.json',
      text: readFileSync(new URL('../resources/domain-failures/pre-error-baseline.json', import.meta.url), 'utf8') });
    expect(result.problems).toEqual([]); this.driver.identity.baseline = result.value!;
  }
  compileAndAssociateExistingIds(): void { this.driver.identify(); }
  compareWithLoadedBaseline(): void { this.driver.identity.compare(); }
  expectNoSpecificationChanges(): void { expect(this.driver.identity.diff.value?.changes).toEqual([]); expect(this.driver.identity.diff.value?.contextChanged).toBe(false); }
  compileAndRememberIdentity(): void { this.driver.identify(); this.driver.identity.remember(); }
  compileAndCompare(): void { this.driver.identify(); this.driver.identity.compare(); }
  expectSameIdentifier(name: string): void { expect(this.driver.identity.id(name)).toBe(this.driver.identity.id(name, true)); }
  expectContractUpdated(name: string): void { expect(this.driver.identity.diff.value?.changes).toContainEqual(expect.objectContaining({ id: this.driver.identity.id(name), kinds: expect.arrayContaining(['update']) })); }
  expectDeclaredReference(from: string, to: string): void { expect(this.driver.identity.record(from).references).toContain(this.driver.identity.id(to)); }
  rememberAnalysis(): void { this.driver.priorAnalysis = this.driver.analysis(); }
  queryErrorRepeatedly(name: string): void { expect(this.driver.error(name)).toEqual(this.driver.error(name)); }
  expectEarlierAnalysisUnchanged(): void { expect(this.driver.analysis()).toBe(this.driver.priorAnalysis); }
  expectErrorDescriptionStatus(name: string, status: string): void { expect(this.driver.error(name).status).toBe(status); }
  expectErrorFieldStatus(name: string, field: string, status: string): void { expect(this.driver.errorField(name, field).type.status).toBe(status); }
  expectFailureStatus(name: string, index: number, status: string): void { expect(this.driver.failure(name, index).status).toBe(status); }
  expectResultStatus(name: string, status: string): void { expect(this.driver.signature(name).result.status).toBe(status); }
  expectErrorFieldCause(name: string, field: string, code: string, text: string): void { this.expectCause(this.driver.errorField(name, field).type, code, text); }
  expectErrorCause(name: string, code: string, text: string): void { this.expectCause(this.driver.error(name), code, text); }
  expectFailureCause(name: string, index: number, code: string, text: string): void { this.expectCause(this.driver.failure(name, index), code, text); }
  expectResultCause(name: string, code: string, text: string): void { this.expectCause(this.driver.signature(name).result, code, text); }
  expectFailureRequirement(name: string, index: number, reason: string, text: string): void {
    expect(requirements(this.driver.failure(name, index)).some(requirement => requirement.reason === reason && this.driver.at(requirement.origin) === text)).toBe(true);
  }
  expectRequirementAt(reason: string, text: string): void { expect(this.driver.compilation.deferred.some(requirement => requirement.reason === reason && this.driver.at(requirement.origin) === text)).toBe(true); }
  private expectCause(fact: TypeFact<unknown>, code: string, text: string): void {
    expect(causes(fact).some(problem => problem.code === code && this.driver.at(problem.at) === text)).toBe(true);
  }
}
