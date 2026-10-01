import { expect } from 'vitest';
import type { Item, NodeKind, Origin, ExternalDefinition, ResolutionDependencies, ResolutionProblemCode, DeferredReason } from '../../src/index.js';
import { ResolutionDriver } from '../driver/declaration-resolution.js';

type PartialData<T> = { [K in keyof T]?: PartialData<T[K]> };
type Point = { line: number; column: number };
type Target = { name: string; kind?: NodeKind; origin?: PartialData<Origin> };
type TypeObservation = {
  written: readonly string[];
  resolution?: 'not-analyzed' | 'bound' | 'invalid' | 'deferred';
  target?: { name: string; module?: string };
};

/** Domain actions and independent expectations for declaration resolution. */
export class DeclarationResolution {
  private readonly driver = new ResolutionDriver();
  sourceIs(text: string, sourceId = 'resolution.expec'): void { this.entryIs('entry', sourceId, text); }
  entryIs(locator: string, sourceId: string, text: string): void { this.driver.entryIs(locator, sourceId, text); }
  sourceModuleIs(locator: string, text: string, sourceId = locator + '.expec'): void { this.driver.sourceModuleIs(locator, text, sourceId); }
  externalModuleIs(locator: string, definitions: readonly ExternalDefinition[]): void { this.driver.externalModuleIs(locator, definitions); }
  externalEntryIs(locator: string, definitions: readonly ExternalDefinition[]): void { this.driver.externalEntryIs(locator, definitions); }
  dependenciesAre(dependencies: ResolutionDependencies): void { this.driver.dependenciesAre(dependencies); }
  removeModules(): void { this.driver.removeModules(); }
  resolveDeclarations(): void { this.driver.resolveDeclarations(); }

  expectNoProblems(): void { expect(this.driver.result.problems).toEqual([]); }
  expectProblemCodes(codes: ResolutionProblemCode[]): void {
    expect(this.driver.result.problems.map(problem => problem.code).sort()).toEqual([...codes].sort());
  }
  expectProblem(code: ResolutionProblemCode, at?: Point, minimumRelated = 0): void {
    const found = this.driver.result.problems.find(problem => problem.code === code && (!at || (problem.at.kind === 'source'
      && problem.at.range.start.line === at.line && problem.at.range.start.column === at.column)));
    expect(found, 'The authored problem must be reported at its actual use').toBeDefined();
    expect(found!.related.length).toBeGreaterThanOrEqual(minimumRelated);
  }
  expectInputProblemWithin(path: readonly (string | number)[]): void {
    const found = this.driver.result.problems.find(problem => problem.code === 'invalid-dependency-input'
      && problem.at.kind === 'dependency' && path.every((part, index) => problem.at.kind === 'dependency' && problem.at.path[index] === part));
    expect(found, 'Malformed supplied input needs a located problem').toBeDefined();
  }
  expectExternalProblem(code: ResolutionProblemCode, module: string, path: readonly (string | number)[]): void {
    expect(this.driver.result.problems).toContainEqual(expect.objectContaining({ code, at: expect.objectContaining({ kind: 'external', module, path }) }));
  }
  expectBound(segments: readonly string[], expected: Target, occurrence = 0): void {
    this.expectBoundIn(this.driver.entryLocator, segments, expected, occurrence);
  }
  expectBoundIn(module: string, segments: readonly string[], expected: Target, occurrence = 0): void {
    const reference = this.driver.reference(module, segments, occurrence);
    expect(reference.resolution.status, 'The authored reference must identify its actual declaration').toBe('bound');
    expect(this.driver.describeTarget(this.driver.target(reference))).toMatchObject(expected);
  }
  expectBoundAt(segments: readonly string[], expected: Point, occurrence = 0): void {
    expect(this.driver.target(this.driver.reference(this.driver.entryLocator, segments, occurrence)).origin)
      .toMatchObject({ kind: 'source', range: { start: expected } });
  }
  expectInvalid(segments: readonly string[], code: ResolutionProblemCode, occurrence = 0): void {
    this.expectInvalidIn(this.driver.entryLocator, segments, code, occurrence);
  }
  expectInvalidIn(module: string, segments: readonly string[], code: ResolutionProblemCode, occurrence = 0): void {
    const binding = this.driver.reference(module, segments, occurrence).resolution;
    expect(binding.status).toBe('invalid');
    if (binding.status !== 'invalid') throw new Error('Expected an invalid reference');
    expect(binding.problems.map(problem => problem.code)).toContain(code);
  }
  expectDeferred(segments: readonly string[], reason: DeferredReason, occurrence = 0): void {
    const reference = this.driver.reference(this.driver.entryLocator, segments, occurrence), binding = reference.resolution;
    expect(binding.status).toBe('deferred');
    if (binding.status !== 'deferred') throw new Error('Expected a deferred reference');
    expect(binding.requirement.occurrence).toBe(reference.id);
    expect(binding.requirement).toMatchObject({ origin: reference.origin, reason });
    expect(binding.requirement.requires.length).toBeGreaterThan(0);
    expect(this.driver.result.deferred.find(requirement => requirement.occurrence === reference.id)).toEqual(binding.requirement);
  }
  expectSameTargets(left: readonly string[], right: readonly string[], leftOccurrence = 0, rightOccurrence = 0): void {
    expect(this.driver.target(this.driver.reference(this.driver.entryLocator, left, leftOccurrence)).id)
      .toBe(this.driver.target(this.driver.reference(this.driver.entryLocator, right, rightOccurrence)).id);
  }
  expectDifferentTargets(left: readonly string[], right: readonly string[], leftOccurrence = 0, rightOccurrence = 0): void {
    expect(this.driver.target(this.driver.reference(this.driver.entryLocator, left, leftOccurrence)).id)
      .not.toBe(this.driver.target(this.driver.reference(this.driver.entryLocator, right, rightOccurrence)).id);
  }
  expectDeclaration(name: string, kind: NodeKind, owner?: string): void {
    const found = this.driver.declarations(kind).find(node => 'name' in node && node.name === name);
    expect(found, 'The actual declaration must remain inspectable').toBeDefined();
    expect(this.driver.readItem(found!.id).id).toBe(found!.id);
    expect(this.driver.readItem(found!.id)).toEqual(found);
    if (owner !== undefined) {
      const parent = this.driver.declarations('concept').find(node => node.name === owner);
      expect(parent, 'The declaring owner must exist').toBeDefined();
      expect(parent!.members.map(member => member.kind === 'local' ? member.declaration.id : member.id)).toContain(found!.id);
    }
  }
  expectBuiltinHasNoSource(name: string): void {
    expect(this.driver.declarations('builtin-type').find(node => node.name === name)?.origin).toEqual({ kind: 'builtin', name });
  }
  expectRootDeclarations(names: string[]): void {
    expect(this.driver.entryRoots().map(node => 'name' in node ? node.name : node.kind)).toEqual(names);
  }
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
      for (const reference of before) expect(reference.resolution).toEqual({ status: 'not-analyzed' });
    }
  }
  expectIndependentObservers(segments: readonly string[], expectedName: string): void {
    const problemsBefore = [...this.driver.result.problems];
    const target = this.driver.target(this.driver.reference(this.driver.entryLocator, segments));
    expect(this.driver.describeTarget(target).name).toBe(expectedName);
    expect(this.driver.readItem(target.id).id).toBe(target.id);
    expect(this.driver.readItem(target.id).origin).toEqual(target.origin);
    expect(this.driver.result.problems).toEqual(problemsBefore);
  }
  rememberFacts(): unknown { return this.driver.facts(); }
  expectFactsEqual(facts: unknown): void { expect(this.driver.facts()).toEqual(facts); }
  expectCheckedQueries(): void {
    const checks = this.driver.checkedReads();
    expect(checks.wrongKind).toThrowError(expect.objectContaining({ code: 'unexpected-kind' }));
    expect(checks.foreign).toThrowError(expect.objectContaining({ code: 'foreign-node' }));
    expect(checks.missing).toThrowError(expect.objectContaining({ code: 'missing-node' }));
  }
  expectRecord(module: string, name: string, fields: Record<string, string>, resolved = true): void {
    expect(this.driver.recordFields(module, name, resolved)).toEqual(fields);
  }
  expectFunction(module: string, name: string, parameters: Record<string, string>, result: string | undefined,
    body: 'absent' | 'available' | 'unavailable', resolved = true): void {
    expect(this.driver.functionDetails(module, name, resolved)).toEqual({ parameters, result, body });
  }
  expectParameterType(module: string, callableName: string, parameterName: string, expected: TypeObservation, resolved = true): void {
    this.expectTypeReference(this.driver.parameter(module, callableName, parameterName, resolved).declaredType, expected);
  }
  expectFieldType(module: string, recordName: string, fieldName: string, expected: TypeObservation): void {
    this.expectTypeReference(this.driver.field(module, recordName, fieldName).declaredType, expected);
  }
  expectOrigin(module: string, kind: NodeKind, name: string, expected: PartialData<Origin>): void {
    expect(this.driver.declaration(module, kind, name).origin).toMatchObject(expected);
  }
  expectReferenceOrigin(module: string, written: readonly string[], expected: PartialData<Origin>, occurrence = 0): void {
    expect(this.driver.reference(module, written, occurrence).origin).toMatchObject(expected);
  }
  rememberBinding(module: string, written: readonly string[], occurrence = 0): void { this.driver.rememberBinding(module, written, occurrence); }
  expectRememberedBinding(name: string): void {
    const { reference, target, expectedId } = this.driver.rememberedBinding(), binding = reference.resolution;
    expect(binding.status).toBe('bound');
    if (binding.status !== 'bound') throw new Error('The earlier view lost its binding');
    expect(binding.target).toBe(expectedId);
    expect(this.driver.describeTarget(target).name).toBe(name);
  }
  replaceExternalModule(locator: string, definitions: readonly ExternalDefinition[]): void { this.driver.replaceExternalModule(locator, definitions); }
  expectUnreachedModule(locator: string, name: string): void {
    const { node, again } = this.driver.inputDeclarationReads(locator, name);
    expect(again).toBe(node);
    expect(() => this.driver.readItem(node.id)).toThrowError(expect.objectContaining({ code: 'not-analyzed' }));
    expect(this.driver.declarations('record-type-declaration', locator)).toEqual([]);
  }
  expectCompleteReferenceOutcomes(): void {
    for (const reference of this.driver.declarations('reference')) {
      expect(reference.resolution.status).not.toBe('not-analyzed');
      if (reference.resolution.status === 'bound') expect(this.driver.readItem(reference.resolution.target)).toBeDefined();
    }
  }
  expectDefault(module: string, callableName: string, parameterName: string, present: boolean, text?: string): void {
    const parameter = this.driver.parameter(module, callableName, parameterName);
    expect(parameter.hasDefault).toBe(present);
    if (text === undefined) expect(parameter.defaultValue).toBeUndefined();
    else {
      expect(parameter.defaultValue?.kind).toBe('string-literal');
      if (parameter.defaultValue?.kind !== 'string-literal') throw new Error('Expected a string default');
      expect(parameter.defaultValue.value).toBe(text);
    }
  }
  expectRejectedExternal(locator: string, definitions: unknown, path: readonly (string | number)[]): void {
    expect(this.driver.rejectExternal(locator, definitions)).toMatchObject({ code: 'invalid-dependency-input', problems: expect.arrayContaining([
      expect.objectContaining({ at: { kind: 'external', module: locator, path } }),
    ]) });
  }
  expectOriginalReferencesUnanalyzed(module: string): void {
    for (const reference of this.driver.inputReferences(module)) expect(reference.resolution).toEqual({ status: 'not-analyzed' });
  }
  expectTypeParametersStayDistinct(module: string, first: string, second: string, name: string): void {
    const firstParameter = this.driver.declaration(module, 'record-type-declaration', first).typeParameters.find(node => node.name === name)!;
    const secondParameter = this.driver.declaration(module, 'record-type-declaration', second).typeParameters.find(node => node.name === name)!;
    expect(firstParameter.id).not.toBe(secondParameter.id);
    const targets = this.driver.references(module, [name]).map(node => this.driver.target(node).id);
    expect(targets).toHaveLength(2);
    expect(targets[0]).toBe(firstParameter.id);
    expect(targets[1]).toBe(secondParameter.id);
  }
  expectPreservedIteratorWhileResolving(module: string): void {
    const { before, first, remaining, replay } = this.driver.iteratorDuringResolution(module);
    expect(first.value?.id).toBe(before[0]?.id);
    expect(remaining).toEqual(before.slice(1));
    remaining.forEach((node, index) => expect(node.id).toBe(before[index + 1]!.id));
    expect(replay).toEqual(before);
    replay.forEach((node, index) => expect(node.id).toBe(before[index]!.id));
    for (const reference of before) expect(reference.resolution).toEqual({ status: 'not-analyzed' });
  }
  expectReferenceTargetsDeclaration(module: string, written: readonly string[], targetModule: string,
    kind: NodeKind, name: string, occurrence = 0): void {
    expect(this.driver.target(this.driver.reference(module, written, occurrence)).id)
      .toBe(this.driver.inputDeclaration(targetModule, kind, name).id);
  }
  private expectTypeReference(type: Item, expected: TypeObservation): void {
    const reference = this.driver.namedType(type).reference;
    expect(reference.segments).toEqual(expected.written);
    if (expected.resolution) expect(reference.resolution.status).toBe(expected.resolution);
    if (expected.target) {
      expect(reference.resolution.status).toBe('bound');
      const target = this.driver.describeTarget(this.driver.target(reference));
      expect(target.name).toBe(expected.target.name);
      if (expected.target.module) expect(target.origin).toMatchObject({ module: expected.target.module });
    }
  }
}
