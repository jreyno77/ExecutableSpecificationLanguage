import { expect } from 'vitest';
import {
  AntlrSyntaxReader, DescriptionInspection, ExternalInspection, Resolver,
  type Inspection, type ModuleInspection, type InspectionNode, type InspectionKind,
  type NodeId, type Origin, type ExternalDefinition, type ResolutionDependencies,
  type Resolution, type ResolutionProblemCode, type DeferredReason,
} from '../../src/index.js';
type PartialData<T> = { [K in keyof T]?: PartialData<T[K]> };
type Point = { line: number; column: number };
type Target = { name: string; kind?: InspectionKind; origin?: PartialData<Origin> };
type TypeObservation = {
  written: readonly string[];
  resolution?: 'not-analyzed' | 'bound' | 'invalid' | 'deferred';
  target?: { name: string; module?: string };
};

/** Domain observations shared by source and external module examples. */
export class DeclarationResolution {
  private readonly resolver = new Resolver();
  private entry!: ModuleInspection;
  private dependencies: ResolutionDependencies = { modules: [], packages: [] };
  private report: Resolution | undefined;
  private readonly originals = new Map<ModuleInspection, readonly InspectionNode<'reference'>[]>();
  private remembered: { view: Resolution; reference: NodeId; target: NodeId } | undefined;

  sourceIs(text: string, sourceId = 'resolution.expec'): void {
    this.entryIs('entry', sourceId, text);
  }
  entryIs(locator: string, sourceId: string, text: string): void {
    this.entry = this.read(locator, sourceId, text);
    this.report = undefined;
  }
  sourceModuleIs(locator: string, text: string, sourceId = locator + '.expec'): void {
    this.addModule(this.read(locator, sourceId, text));
  }
  externalModuleIs(locator: string, definitions: readonly ExternalDefinition[]): void {
    this.addModule(new ExternalInspection(locator, definitions));
  }
  externalEntryIs(locator: string, definitions: readonly ExternalDefinition[]): void {
    this.entry = new ExternalInspection(locator, definitions);
    this.rememberInput(this.entry);
    this.report = undefined;
  }
  dependenciesAre(dependencies: ResolutionDependencies): void {
    this.dependencies = dependencies;
    for (const module of dependencies.modules) this.rememberInput(module);
    this.report = undefined;
  }
  removeModules(): void { this.dependencies = { ...this.dependencies, modules: [] }; }
  resolveDeclarations(): void { this.report = this.resolver.resolve(this.entry, this.dependencies); }

  expectNoProblems(): void { expect(this.resolved().problems).toEqual([]); }
  expectProblemCodes(codes: ResolutionProblemCode[]): void {
    expect(this.resolved().problems.map(problem => problem.code).sort()).toEqual([...codes].sort());
  }
  expectProblem(code: ResolutionProblemCode, at?: Point, minimumRelated = 0): void {
    const found = this.resolved().problems.find(problem => problem.code === code
      && (!at || (problem.at.kind === 'source'
        && problem.at.range.start.line === at.line && problem.at.range.start.column === at.column)));
    expect(found, 'The authored problem must be reported at its actual use').toBeDefined();
    expect(found!.related.length).toBeGreaterThanOrEqual(minimumRelated);
  }
  expectInputProblemWithin(path: readonly (string | number)[]): void {
    const found = this.resolved().problems.find(problem => problem.code === 'invalid-dependency-input'
      && problem.at.kind === 'dependency'
      && path.every((part, index) => problem.at.kind === 'dependency' && problem.at.path[index] === part));
    expect(found, 'Malformed supplied input needs a located problem').toBeDefined();
  }
  expectExternalProblem(code: ResolutionProblemCode, module: string, path: readonly (string | number)[]): void {
    expect(this.resolved().problems).toContainEqual(expect.objectContaining({
      code, at: expect.objectContaining({ kind: 'external', module, path }),
    }));
  }

  expectBound(segments: readonly string[], expected: Target, occurrence = 0): void {
    this.expectBoundIn(this.entry.locator, segments, expected, occurrence);
  }
  expectBoundIn(module: string, segments: readonly string[], expected: Target, occurrence = 0): void {
    const target = this.target(this.reference(module, segments, occurrence));
    expect(this.describeTarget(target)).toMatchObject(expected);
  }
  expectBoundAt(segments: readonly string[], expected: Point, occurrence = 0): void {
    expect(this.target(this.reference(this.entry.locator, segments, occurrence)).origin)
      .toMatchObject({ kind: 'source', range: { start: expected } });
  }
  expectInvalid(segments: readonly string[], code: ResolutionProblemCode, occurrence = 0): void {
    this.expectInvalidIn(this.entry.locator, segments, code, occurrence);
  }
  expectInvalidIn(module: string, segments: readonly string[], code: ResolutionProblemCode, occurrence = 0): void {
    const binding = this.resolved().node(this.reference(module, segments, occurrence).id, 'reference').payload.resolution;
    expect(binding.status).toBe('invalid');
    if (binding.status !== 'invalid') throw new Error('Expected an invalid reference');
    expect(binding.problems.map(problem => problem.code)).toContain(code);
  }
  expectDeferred(segments: readonly string[], reason: DeferredReason, occurrence = 0): void {
    const reference = this.resolved().node(this.reference(this.entry.locator, segments, occurrence).id, 'reference');
    const binding = reference.payload.resolution;
    expect(binding.status).toBe('deferred');
    if (binding.status !== 'deferred') throw new Error('Expected a deferred reference');
    expect(binding.requirement.occurrence).toBe(reference.id);
    expect(binding.requirement).toMatchObject({ origin: reference.origin, reason });
    expect(binding.requirement.requires.length).toBeGreaterThan(0);
    expect(this.resolved().deferred.find(requirement => requirement.occurrence === reference.id)).toEqual(binding.requirement);
  }
  expectSameTargets(left: readonly string[], right: readonly string[], leftOccurrence = 0, rightOccurrence = 0): void {
    expect(this.target(this.reference(this.entry.locator, left, leftOccurrence)).id)
      .toBe(this.target(this.reference(this.entry.locator, right, rightOccurrence)).id);
  }
  expectDifferentTargets(left: readonly string[], right: readonly string[], leftOccurrence = 0, rightOccurrence = 0): void {
    expect(this.target(this.reference(this.entry.locator, left, leftOccurrence)).id)
      .not.toBe(this.target(this.reference(this.entry.locator, right, rightOccurrence)).id);
  }
  expectDeclaration(name: string, kind: InspectionKind, owner?: string): void {
    const view = this.resolved();
    const found = Array.from(view.nodes(kind)).find(node => 'name' in node.payload && view.name(node.payload.name) === name);
    expect(found, 'The actual declaration must remain inspectable').toBeDefined();
    expect(view.node(found!.id).id).toBe(found!.id);
    expect(view.node(found!.id)).toEqual(found);
    if (owner !== undefined) {
      const parent = Array.from(view.nodes('concept')).find(node => view.name(node.payload.name) === owner);
      expect(parent, 'The declaring owner must exist').toBeDefined();
      expect(parent!.payload.members.map(id => {
        const member = view.node(id);
        return member.payload.kind === 'local' ? member.payload.declaration : member.id;
      })).toContain(found!.id);
    }
  }
  expectBuiltinHasNoSource(name: string): void {
    const view = this.resolved();
    const target = Array.from(view.nodes('builtin-type')).find(node => view.name(node.payload.name) === name);
    expect(target?.origin).toEqual({ kind: 'builtin', name });
  }
  expectRootDeclarations(names: string[]): void {
    const view = this.resolved();
    expect(Array.from(this.entry.roots()).map(id => {
      const node = view.node(id);
      return 'name' in node.payload ? view.name(node.payload.name) : node.payload.kind;
    })).toEqual(names);
  }
  expectDeclarationsReplay(): void {
    const records = this.resolved().nodes('record-type-declaration');
    const first = records[Symbol.iterator]().next();
    const second = records[Symbol.iterator]().next();
    expect(first.value?.id).toBe(second.value?.id);
    const before = Array.from(records);
    const after = Array.from(records);
    expect(after).toEqual(before);
    after.forEach((node, index) => expect(node.id).toBe(before[index]!.id));
  }
  expectInputsUnchanged(): void {
    for (const [input, before] of this.originals) {
      const after = Array.from(input.nodes('reference'));
      expect(after).toEqual(before);
      after.forEach((node, index) => expect(node.id).toBe(before[index]!.id));
      for (const reference of before) expect(reference.payload.resolution).toEqual({ status: 'not-analyzed' });
    }
  }
  expectIndependentObservers(segments: readonly string[], expectedName: string): void {
    const problemsBefore = [...this.resolved().problems];
    const target = this.target(this.reference(this.entry.locator, segments, 0));
    expect(this.describeTarget(target).name).toBe(expectedName);
    expect(this.resolved().node(target.id).id).toBe(target.id);
    expect(this.resolved().node(target.id).origin).toEqual(target.origin);
    expect(this.resolved().problems).toEqual(problemsBefore);
  }
  rememberFacts(): unknown {
    const view = this.resolved();
    return {
      references: Array.from(view.nodes('reference'), node => ({
        origin: node.origin, written: view.reference(node.id),
        resolution: node.payload.resolution.status === 'bound'
          ? { status: 'bound', target: this.describeTarget(view.node(node.payload.resolution.target)) }
          : node.payload.resolution,
      })),
      problems: view.problems,
    };
  }
  expectFactsEqual(facts: unknown): void { expect(this.rememberFacts()).toEqual(facts); }
  expectCheckedQueries(): void {
    const record = Array.from(this.entry.nodes('record-type-declaration'))[0]!;
    expect(() => this.resolved().node(record.id, 'reference'))
      .toThrowError(expect.objectContaining({ code: 'unexpected-kind' }));
    const foreign = this.read('foreign', 'foreign.expec', 'type Elsewhere {}');
    expect(() => this.resolved().node(Array.from(foreign.roots())[0]!))
      .toThrowError(expect.objectContaining({ code: 'foreign-node' }));
    expect(() => this.resolved().node({} as NodeId))
      .toThrowError(expect.objectContaining({ code: 'missing-node' }));
  }

  expectRecord(module: string, name: string, fields: Record<string, string>, resolved = true): void {
    const view = resolved ? this.resolved() : this.module(module);
    const record = this.named(view, module, 'record-type-declaration', name);
    const actual = Object.fromEntries(record.payload.fields.map(id => {
      const field = view.node(id, 'field');
      return [view.name(field.payload.name), this.typeText(view, field.payload.declaredType)];
    }));
    expect(actual).toEqual(fields);
  }
  expectFunction(module: string, name: string, parameters: Record<string, string>, result: string | undefined,
    body: 'absent' | 'available' | 'unavailable', resolved = true): void {
    const view = resolved ? this.resolved() : this.module(module);
    const callable = this.named(view, module, 'function', name);
    expect(Object.fromEntries(callable.payload.parameters.map(id => {
      const parameter = view.node(id, 'parameter');
      return [view.name(parameter.payload.name), this.typeText(view, parameter.payload.declaredType)];
    }))).toEqual(parameters);
    expect(callable.payload.returnType ? this.typeText(view, callable.payload.returnType) : undefined).toBe(result);
    expect(callable.payload.body.kind).toBe(body);
  }
  expectParameterType(module: string, callableName: string, parameterName: string, expected: TypeObservation, resolved = true): void {
    const view = resolved ? this.resolved() : this.module(module);
    const callable = this.named(view, module, 'function', callableName);
    const parameter = callable.payload.parameters.map(id => view.node(id, 'parameter'))
      .find(node => view.name(node.payload.name) === parameterName)!;
    this.expectTypeReference(view, parameter.payload.declaredType, expected);
  }
  expectFieldType(module: string, recordName: string, fieldName: string, expected: TypeObservation): void {
    const view = this.resolved();
    const record = this.named(view, module, 'record-type-declaration', recordName);
    const field = record.payload.fields.map(id => view.node(id, 'field'))
      .find(node => view.name(node.payload.name) === fieldName)!;
    this.expectTypeReference(view, field.payload.declaredType, expected);
  }
  expectOrigin(module: string, kind: InspectionKind, name: string, expected: PartialData<Origin>): void {
    const view = this.resolved();
    const node = Array.from(view.nodes(kind)).find(node => this.inModule(node, module)
      && 'name' in node.payload && view.name(node.payload.name) === name);
    expect(node?.origin).toMatchObject(expected);
  }
  expectReferenceOrigin(module: string, written: readonly string[], expected: PartialData<Origin>, occurrence = 0): void {
    expect(this.reference(module, written, occurrence).origin).toMatchObject(expected);
  }
  rememberBinding(module: string, written: readonly string[], occurrence = 0): void {
    const reference = this.reference(module, written, occurrence);
    this.remembered = { view: this.resolved(), reference: reference.id, target: this.target(reference).id };
  }
  expectRememberedBinding(name: string): void {
    if (!this.remembered) throw new Error('Remember a resolved reference first');
    const { view, reference, target } = this.remembered;
    const binding = view.node(reference, 'reference').payload.resolution;
    expect(binding.status).toBe('bound');
    if (binding.status !== 'bound') throw new Error('The earlier view lost its binding');
    expect(binding.target).toBe(target);
    const node = view.node(target);
    expect('name' in node.payload && view.name(node.payload.name)).toBe(name);
  }
  replaceExternalModule(locator: string, definitions: readonly ExternalDefinition[]): void {
    this.dependencies = { ...this.dependencies, modules: this.dependencies.modules.filter(module => module.locator !== locator) };
    this.externalModuleIs(locator, definitions);
  }
  expectUnreachedModule(locator: string, name: string): void {
    const module = this.module(locator);
    const node = Array.from(module.nodes('record-type-declaration')).find(node => module.name(node.payload.name) === name)!;
    expect(module.node(node.id)).toBe(node);
    expect(() => this.resolved().node(node.id)).toThrowError(expect.objectContaining({ code: 'not-analyzed' }));
    expect(Array.from(this.resolved().nodes('record-type-declaration')).some(node => this.inModule(node, locator))).toBe(false);
  }
  expectCompleteReferenceOutcomes(): void {
    const view = this.resolved();
    for (const reference of view.nodes('reference')) {
      const outcome = reference.payload.resolution;
      expect(outcome.status).not.toBe('not-analyzed');
      if (outcome.status === 'bound') expect(view.node(outcome.target)).toBeDefined();
    }
  }
  expectDefault(module: string, callableName: string, parameterName: string, present: boolean, text?: string): void {
    const view = this.resolved();
    const callable = this.named(view, module, 'function', callableName);
    const parameter = callable.payload.parameters.map(id => view.node(id, 'parameter'))
      .find(node => view.name(node.payload.name) === parameterName)!;
    expect(parameter.payload.hasDefault).toBe(present);
    if (text === undefined) expect(parameter.payload.defaultValue).toBeUndefined();
    else expect(view.node(parameter.payload.defaultValue!, 'string-literal').payload.value).toBe(text);
  }

  expectRejectedExternal(locator: string, definitions: unknown, path: readonly (string | number)[]): void {
    let failure: unknown;
    try { new ExternalInspection(locator, definitions as readonly ExternalDefinition[]); }
    catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: 'invalid-dependency-input', problems: expect.arrayContaining([
      expect.objectContaining({ at: { kind: 'external', module: locator, path } }),
    ]) });
  }
  expectOriginalReferencesUnanalyzed(module: string): void {
    for (const reference of this.module(module).nodes('reference')) {
      expect(reference.payload.resolution).toEqual({ status: 'not-analyzed' });
    }
  }
  expectTypeParametersStayDistinct(module: string, first: string, second: string, name: string): void {
    const view = this.resolved();
    const firstOwner = this.named(view, module, 'record-type-declaration', first);
    const secondOwner = this.named(view, module, 'record-type-declaration', second);
    const firstParameter = firstOwner.payload.typeParameters.map(id => view.node(id, 'type-parameter'))
      .find(node => view.name(node.payload.name) === name)!;
    const secondParameter = secondOwner.payload.typeParameters.map(id => view.node(id, 'type-parameter'))
      .find(node => view.name(node.payload.name) === name)!;
    expect(firstParameter.id).not.toBe(secondParameter.id);
    const targets = Array.from(view.nodes('reference')).filter(node => this.inModule(node, module)
      && JSON.stringify(view.reference(node.id)) === JSON.stringify([name])).map(node => this.target(node).id);
    expect(targets).toHaveLength(2);
    expect(targets[0]).toBe(firstParameter.id);
    expect(targets[1]).toBe(secondParameter.id);
  }
  expectPreservedIteratorWhileResolving(module: string): void {
    const input = this.module(module);
    const nodes = input.nodes('reference');
    const before = Array.from(nodes);
    const cursor = nodes[Symbol.iterator]();
    const first = cursor.next();
    this.resolveDeclarations();
    expect(first.value?.id).toBe(before[0]?.id);
    const remaining = Array.from({ [Symbol.iterator]: () => cursor });
    expect(remaining).toEqual(before.slice(1));
    remaining.forEach((node, index) => expect(node.id).toBe(before[index + 1]!.id));
    const replay = Array.from(nodes);
    expect(replay).toEqual(before);
    replay.forEach((node, index) => expect(node.id).toBe(before[index]!.id));
    for (const reference of before) expect(reference.payload.resolution).toEqual({ status: 'not-analyzed' });
  }
  expectReferenceTargetsDeclaration(module: string, written: readonly string[], targetModule: string,
    kind: InspectionKind, name: string, occurrence = 0): void {
    const view = this.resolved();
    const declaration = Array.from(this.module(targetModule).nodes(kind)).find(node => 'name' in node.payload
      && view.name(node.payload.name) === name)!;
    expect(this.target(this.reference(module, written, occurrence)).id).toBe(declaration.id);
  }
  private expectTypeReference(view: Inspection, id: NodeId, expected: TypeObservation): void {
    const type = view.node(id, 'named-type');
    const reference = view.node(type.payload.reference, 'reference');
    expect(view.reference(reference.id)).toEqual(expected.written);
    if (expected.resolution) expect(reference.payload.resolution.status).toBe(expected.resolution);
    if (expected.target) {
      const outcome = reference.payload.resolution;
      expect(outcome.status).toBe('bound');
      if (outcome.status !== 'bound') throw new Error('Expected a resolved type');
      const target = view.node(outcome.target);
      expect('name' in target.payload && view.name(target.payload.name)).toBe(expected.target.name);
      if (expected.target.module) expect(target.origin).toMatchObject({ module: expected.target.module });
    }
  }
  private named<K extends 'record-type-declaration' | 'function'>(view: Inspection, module: string, kind: K, name: string): InspectionNode<K> {
    const found = Array.from(view.nodes(kind)).find(node => this.inModule(node, module) && view.name(node.payload.name) === name);
    if (!found) throw new Error(`Expected ${kind} ${module}.${name}`);
    return found;
  }
  private typeText(view: Inspection, id: NodeId): string {
    const type = view.node(id);
    switch (type.payload.kind) {
      case 'named-type': return view.reference(type.payload.reference).join('.')
        + (type.payload.arguments.length ? '<' + type.payload.arguments.map(id => this.typeText(view, id)).join(', ') + '>' : '');
      case 'tuple-type': return '[' + type.payload.elements.map(id => this.typeText(view, id)).join(', ') + ']';
      case 'optional-type': return this.typeText(view, type.payload.inner) + '?';
      case 'union-type': return type.payload.alternatives.map(id => this.typeText(view, id)).join(' | ');
      case 'grouped-type': return '(' + this.typeText(view, type.payload.inner) + ')';
      default: throw new Error('This observation expects a named, tuple, optional, union or grouped type');
    }
  }
  private module(locator: string): ModuleInspection {
    const module = [this.entry, ...this.dependencies.modules].find(module => module.locator === locator);
    if (!module) throw new Error('No supplied module ' + locator);
    return module;
  }
  private read(locator: string, sourceId: string, text: string): ModuleInspection {
    const result = new AntlrSyntaxReader().read({ sourceId, text });
    if (result.status !== 'accepted') throw new Error('Acceptance source must be grammatical: ' + JSON.stringify(result.diagnostics));
    const inspection = new DescriptionInspection(locator, result.description);
    this.rememberInput(inspection);
    return inspection;
  }
  private rememberInput(module: ModuleInspection): void { this.originals.set(module, Array.from(module.nodes('reference'))); }
  private addModule(module: ModuleInspection): void {
    this.dependencies = { ...this.dependencies, modules: [...this.dependencies.modules, module] };
    this.rememberInput(module);
    this.report = undefined;
  }
  private resolved(): Resolution {
    if (!this.report) throw new Error('Resolve declarations before observing them');
    return this.report;
  }
  private reference(module: string, segments: readonly string[], occurrence: number): InspectionNode<'reference'> {
    const view = this.resolved();
    const references = Array.from(view.nodes('reference')).filter(node => this.inModule(node, module)
      && JSON.stringify(view.reference(node.id)) === JSON.stringify(segments));
    const reference = references[occurrence];
    if (!reference) throw new Error('The example has no reference occurrence: ' + JSON.stringify({ module, segments, occurrence }));
    return reference;
  }
  private target(reference: InspectionNode<'reference'>): InspectionNode {
    const outcome = this.resolved().node(reference.id, 'reference').payload.resolution;
    expect(outcome.status, 'The authored reference must identify its actual declaration').toBe('bound');
    if (outcome.status !== 'bound') throw new Error('Expected a bound declaration');
    return this.resolved().node(outcome.target);
  }
  private describeTarget(node: InspectionNode): Target {
    if (!('name' in node.payload)) throw new Error('A declaration target must have a name');
    return { name: this.resolved().name(node.payload.name), kind: node.payload.kind, origin: node.origin };
  }
  private inModule(node: InspectionNode, module: string): boolean {
    return node.origin.kind !== 'builtin' && node.origin.module === module;
  }
}
