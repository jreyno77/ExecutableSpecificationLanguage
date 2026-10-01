import { expect } from 'vitest';
import type {
  InspectionKind, Origin, ExternalDefinition, ResolutionDependencies, ResolutionProblemCode, DeferredReason,
} from '../../src/index.js';
import { DeclarationResolutionDriver } from '../driver/declaration-resolution.js';

type PartialData<T> = { [K in keyof T]?: PartialData<T[K]> };
type Point = { line: number; column: number };
type Target = { name: string; kind?: InspectionKind; origin?: PartialData<Origin> };
type TypeObservation = {
  written: readonly string[];
  resolution?: 'not-analyzed' | 'bound' | 'invalid' | 'deferred';
  target?: { name: string; module?: string };
};

/** Domain actions and expectations shared by source and external module examples. */
export class DeclarationResolution {
  private readonly driver = new DeclarationResolutionDriver();
  sourceIs(text: string, sourceId = 'resolution.expec'): void { this.driver.sourceIs(text, sourceId); }
  entryIs(locator: string, sourceId: string, text: string): void { this.driver.entryIs(locator, sourceId, text); }
  sourceModuleIs(locator: string, text: string, sourceId = locator + '.expec'): void {
    this.driver.sourceModuleIs(locator, text, sourceId);
  }
  externalModuleIs(locator: string, definitions: readonly ExternalDefinition[]): void { this.driver.externalModuleIs(locator, definitions); }
  externalEntryIs(locator: string, definitions: readonly ExternalDefinition[]): void { this.driver.externalEntryIs(locator, definitions); }
  dependenciesAre(dependencies: ResolutionDependencies): void { this.driver.dependenciesAre(dependencies); }
  removeModules(): void { this.driver.removeModules(); }
  resolveDeclarations(): void { this.driver.resolveDeclarations(); }
  replaceExternalModule(locator: string, definitions: readonly ExternalDefinition[]): void {
    this.driver.replaceExternalModule(locator, definitions);
  }

  expectNoProblems(): void { expect(this.driver.problems).toEqual([]); }
  expectProblemCodes(codes: ResolutionProblemCode[]): void {
    expect(this.driver.problems.map(problem => problem.code).sort()).toEqual([...codes].sort());
  }
  expectProblem(code: ResolutionProblemCode, at?: Point, minimumRelated = 0): void {
    const found = this.driver.problems.find(problem => problem.code === code
      && (!at || (problem.at.kind === 'source'
        && problem.at.range.start.line === at.line && problem.at.range.start.column === at.column)));
    expect(found, 'The authored problem must be reported at its actual use').toBeDefined();
    expect(found!.related.length).toBeGreaterThanOrEqual(minimumRelated);
  }
  expectInputProblemWithin(path: readonly (string | number)[]): void {
    const found = this.driver.problems.find(problem => problem.code === 'invalid-dependency-input'
      && problem.at.kind === 'dependency'
      && path.every((part, index) => problem.at.kind === 'dependency' && problem.at.path[index] === part));
    expect(found, 'Malformed supplied input needs a located problem').toBeDefined();
  }
  expectExternalProblem(code: ResolutionProblemCode, module: string, path: readonly (string | number)[]): void {
    expect(this.driver.problems).toContainEqual(expect.objectContaining({
      code, at: expect.objectContaining({ kind: 'external', module, path }),
    }));
  }
  expectBound(segments: readonly string[], expected: Target, occurrence = 0): void {
    this.expectBoundIn(this.driver.entryLocator, segments, expected, occurrence);
  }
  expectBoundIn(module: string, segments: readonly string[], expected: Target, occurrence = 0): void {
    expect(this.driver.describeTarget(this.boundTarget(module, segments, occurrence))).toMatchObject(expected);
  }
  expectBoundAt(segments: readonly string[], expected: Point, occurrence = 0): void {
    expect(this.boundTarget(this.driver.entryLocator, segments, occurrence).origin)
      .toMatchObject({ kind: 'source', range: { start: expected } });
  }
  expectInvalid(segments: readonly string[], code: ResolutionProblemCode, occurrence = 0): void {
    this.expectInvalidIn(this.driver.entryLocator, segments, code, occurrence);
  }
  expectInvalidIn(module: string, segments: readonly string[], code: ResolutionProblemCode, occurrence = 0): void {
    const binding = this.driver.reference(module, segments, occurrence).payload.resolution;
    expect(binding.status).toBe('invalid');
    if (binding.status !== 'invalid') throw new Error('Expected an invalid reference');
    expect(binding.problems.map(problem => problem.code)).toContain(code);
  }
  expectDeferred(segments: readonly string[], reason: DeferredReason, occurrence = 0): void {
    const reference = this.driver.reference(this.driver.entryLocator, segments, occurrence);
    const binding = reference.payload.resolution;
    expect(binding.status).toBe('deferred');
    if (binding.status !== 'deferred') throw new Error('Expected a deferred reference');
    expect(binding.requirement.occurrence).toBe(reference.id);
    expect(binding.requirement).toMatchObject({ origin: reference.origin, reason });
    expect(binding.requirement.requires.length).toBeGreaterThan(0);
    expect(this.driver.deferredFor(reference.id)).toEqual(binding.requirement);
  }
  expectSameTargets(left: readonly string[], right: readonly string[], leftOccurrence = 0, rightOccurrence = 0): void {
    expect(this.boundTarget(this.driver.entryLocator, left, leftOccurrence).id)
      .toBe(this.boundTarget(this.driver.entryLocator, right, rightOccurrence).id);
  }
  expectDifferentTargets(left: readonly string[], right: readonly string[], leftOccurrence = 0, rightOccurrence = 0): void {
    expect(this.boundTarget(this.driver.entryLocator, left, leftOccurrence).id)
      .not.toBe(this.boundTarget(this.driver.entryLocator, right, rightOccurrence).id);
  }
  expectDeclaration(name: string, kind: InspectionKind, owner?: string): void {
    const { found, readback, parent, members } = this.driver.declaration(name, kind, owner);
    expect(found, 'The actual declaration must remain inspectable').toBeDefined();
    expect(readback!.id).toBe(found!.id);
    expect(readback).toEqual(found);
    if (owner !== undefined) {
      expect(parent, 'The declaring owner must exist').toBeDefined();
      expect(members).toContain(found!.id);
    }
  }
  expectBuiltinHasNoSource(name: string): void { expect(this.driver.builtin(name)?.origin).toEqual({ kind: 'builtin', name }); }
  expectRootDeclarations(names: string[]): void { expect(this.driver.rootNames()).toEqual(names); }
  expectDeclarationsReplay(): void {
    const { first, second, before, after } = this.driver.declarationsReplay();
    expect(first.value?.id).toBe(second.value?.id);
    expect(after).toEqual(before);
    after.forEach((node, index) => expect(node.id).toBe(before[index]!.id));
  }
  expectInputsUnchanged(): void {
    for (const { before, after } of this.driver.inputSnapshots()) {
      expect(after).toEqual(before);
      after.forEach((node, index) => expect(node.id).toBe(before[index]!.id));
      for (const reference of before) expect(reference.payload.resolution).toEqual({ status: 'not-analyzed' });
    }
  }
  expectIndependentObservers(segments: readonly string[], expectedName: string): void {
    const problemsBefore = [...this.driver.problems];
    const target = this.boundTarget(this.driver.entryLocator, segments, 0);
    expect(this.driver.describeTarget(target).name).toBe(expectedName);
    expect(this.driver.readback(target).id).toBe(target.id);
    expect(this.driver.readback(target).origin).toEqual(target.origin);
    expect(this.driver.problems).toEqual(problemsBefore);
  }
  rememberFacts(): unknown { return this.driver.facts(); }
  expectFactsEqual(facts: unknown): void { expect(this.rememberFacts()).toEqual(facts); }
  expectCheckedQueries(): void {
    expect(() => this.driver.queryWrongKind()).toThrowError(expect.objectContaining({ code: 'unexpected-kind' }));
    expect(() => this.driver.queryForeignNode()).toThrowError(expect.objectContaining({ code: 'foreign-node' }));
    expect(() => this.driver.queryMissingNode()).toThrowError(expect.objectContaining({ code: 'missing-node' }));
  }
  expectRecord(module: string, name: string, fields: Record<string, string>, resolved = true): void {
    expect(this.driver.record(module, name, resolved)).toEqual(fields);
  }
  expectFunction(module: string, name: string, parameters: Record<string, string>, result: string | undefined,
    body: 'absent' | 'available' | 'unavailable', resolved = true): void {
    const actual = this.driver.callable(module, name, resolved);
    expect(actual.parameters).toEqual(parameters);
    expect(actual.result).toBe(result);
    expect(actual.body).toBe(body);
  }
  expectParameterType(module: string, callableName: string, parameterName: string, expected: TypeObservation, resolved = true): void {
    this.expectTypeReference(this.driver.parameterType(module, callableName, parameterName, resolved), expected);
  }
  expectFieldType(module: string, recordName: string, fieldName: string, expected: TypeObservation): void {
    this.expectTypeReference(this.driver.fieldType(module, recordName, fieldName), expected);
  }
  expectOrigin(module: string, kind: InspectionKind, name: string, expected: PartialData<Origin>): void {
    expect(this.driver.origin(module, kind, name)).toMatchObject(expected);
  }
  expectReferenceOrigin(module: string, written: readonly string[], expected: PartialData<Origin>, occurrence = 0): void {
    expect(this.driver.reference(module, written, occurrence).origin).toMatchObject(expected);
  }
  rememberBinding(module: string, written: readonly string[], occurrence = 0): void {
    expect(this.driver.rememberBinding(module, written, occurrence).binding.status,
      'The authored reference must identify its actual declaration').toBe('bound');
  }
  expectRememberedBinding(name: string): void {
    const { binding, target, name: actualName } = this.driver.rememberedBinding();
    expect(binding.status).toBe('bound');
    if (binding.status !== 'bound') throw new Error('The earlier view lost its binding');
    expect(binding.target).toBe(target);
    expect(actualName).toBe(name);
  }
  expectUnreachedModule(locator: string, name: string): void {
    const { node, readback, query, included } = this.driver.unreachedModule(locator, name);
    expect(readback).toBe(node);
    expect(query).toThrowError(expect.objectContaining({ code: 'not-analyzed' }));
    expect(included).toBe(false);
  }
  expectCompleteReferenceOutcomes(): void {
    for (const { outcome, target } of this.driver.referenceOutcomes()) {
      expect(outcome.status).not.toBe('not-analyzed');
      if (outcome.status === 'bound') expect(target).toBeDefined();
    }
  }
  expectDefault(module: string, callableName: string, parameterName: string, present: boolean, text?: string): void {
    const actual = this.driver.parameterDefault(module, callableName, parameterName);
    expect(actual.present).toBe(present);
    if (text === undefined) expect(actual.value).toBeUndefined();
    else expect(actual.text).toBe(text);
  }
  expectRejectedExternal(locator: string, definitions: unknown, path: readonly (string | number)[]): void {
    expect(this.driver.rejectedExternal(locator, definitions)).toMatchObject({ code: 'invalid-dependency-input', problems: expect.arrayContaining([
      expect.objectContaining({ at: { kind: 'external', module: locator, path } }),
    ]) });
  }
  expectOriginalReferencesUnanalyzed(module: string): void {
    for (const reference of this.driver.originalReferences(module)) {
      expect(reference.payload.resolution).toEqual({ status: 'not-analyzed' });
    }
  }
  expectTypeParametersStayDistinct(module: string, first: string, second: string, name: string): void {
    const actual = this.driver.typeParameters(module, first, second, name);
    expect(actual.first.id).not.toBe(actual.second.id);
    const targets = actual.targets.map(target => {
      expect(target.binding.status, 'The authored reference must identify its actual declaration').toBe('bound');
      return target.node!.id;
    });
    expect(targets).toHaveLength(2);
    expect(targets[0]).toBe(actual.first.id);
    expect(targets[1]).toBe(actual.second.id);
  }
  expectPreservedIteratorWhileResolving(module: string): void {
    const { before, first, remaining, replay } = this.driver.iteratorWhileResolving(module);
    expect(first.value?.id).toBe(before[0]?.id);
    expect(remaining).toEqual(before.slice(1));
    remaining.forEach((node, index) => expect(node.id).toBe(before[index + 1]!.id));
    expect(replay).toEqual(before);
    replay.forEach((node, index) => expect(node.id).toBe(before[index]!.id));
    for (const reference of before) expect(reference.payload.resolution).toEqual({ status: 'not-analyzed' });
  }
  expectReferenceTargetsDeclaration(module: string, written: readonly string[], targetModule: string,
    kind: InspectionKind, name: string, occurrence = 0): void {
    expect(this.boundTarget(module, written, occurrence).id).toBe(this.driver.moduleDeclaration(targetModule, kind, name).id);
  }

  private expectTypeReference(actual: ReturnType<DeclarationResolutionDriver['parameterType']>, expected: TypeObservation): void {
    expect(actual.written).toEqual(expected.written);
    if (expected.resolution) expect(actual.outcome.status).toBe(expected.resolution);
    if (expected.target) {
      expect(actual.outcome.status).toBe('bound');
      if (actual.outcome.status !== 'bound') throw new Error('Expected a resolved type');
      expect(actual.name).toBe(expected.target.name);
      if (expected.target.module) expect(actual.target!.origin).toMatchObject({ module: expected.target.module });
    }
  }
  private boundTarget(module: string, segments: readonly string[], occurrence: number) {
    const target = this.driver.target(this.driver.reference(module, segments, occurrence));
    expect(target.binding.status, 'The authored reference must identify its actual declaration').toBe('bound');
    if (!target.node) throw new Error('Expected a bound declaration');
    return target.node;
  }
}
