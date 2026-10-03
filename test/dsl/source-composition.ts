import { expect } from 'vitest';
import { QueryInspection, type Diagnostic, type ExternalDefinition, type NodeId, type Origin, type ProblemLocation, type TypeFact, type TypeId } from '../../src/index.js';
import { allNodes, CompositionDriver, modelState } from '../driver/source-composition.js';

export class CompositionExamples {
  private readonly driver = new CompositionDriver();
  private problem!: Diagnostic;
  entry(module: string, text: string): void { this.driver.source(module, text, true); }
  module(module: string, text: string): void { this.driver.source(module, text); }
  externalModule(module: string, definitions: readonly ExternalDefinition[]): void { this.driver.external(module, definitions); }
  mapsModule(owner: string, authored: string, supplied: string): void { this.driver.maps(owner, authored, supplied); }
  compose(): void { this.driver.compose(); }
  compile(): void { this.driver.compile(); }
  compileSource(): void { this.driver.compileSource(); }
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
  expectCapabilities(module: string, owner: string, names: readonly string[]): void {
    const node = this.driver.inspection.read(this.driver.declaration(module, owner).id);
    if (!('members' in node)) throw new Error('Expected concept members');
    expect(node.members.flatMap(member => member.kind === 'capability' ? [member.name] : [])).toEqual(names);
  }
  expectFields(module: string, record: string, names: readonly string[]): void {
    expect(this.driver.inspection.read(this.driver.declaration(module, record).id, 'record-type-declaration').fields.map(field => 'name' in field ? field.name : field.kind)).toEqual(names);
  }
  expectCapabilityOrigin(ownerModule: string, name: string, module: string, at: { line: number }): void {
    this.expectOrigin(this.driver.inspection.read(this.driver.declaration(ownerModule, name).id).origin, module, at.line);
  }
  expectDeclarationOrigin(module: string, name: string, origin: Origin): void {
    expect(this.driver.inspection.read(this.driver.declaration(module, name).id).origin).toEqual(origin);
  }
  expectOriginalMemberIdentity(module: string, name: string): void { this.expectOriginalDeclarationIdentity(module, name); }
  expectOriginalConceptMembers(module: string, owner: string, kinds: readonly string[]): void {
    const node = this.driver.modules.get(module)!.node(this.driver.declaration(module, owner).id);
    if (!('members' in node)) throw new Error('Expected authored members');
    expect(node.members.map(id => this.driver.modules.get(module)!.node(id).kind)).toEqual(kinds);
  }
  expectBoundType(module: string, name: string, targetModule: string, target: string): void {
    const raw = this.driver.modules.get(module)!;
    const occurrences = raw.nodes('named-type').filter(node => raw.node(node.reference, 'reference').segments
      .map(id => raw.node(id, 'name').decoded).join('.') === name);
    expect(occurrences.length).toBeGreaterThan(0);
    for (const node of occurrences) expect(this.driver.resolution.model.resolution(node.reference)).toEqual({ status: 'bound', target: this.driver.declaration(targetModule, target).id });
  }
  expectFixtureType(module: string, name: string, targetModule: string, target: string): void {
    const result = this.driver.fixtureType(module, name);
    expect(result.problems).toEqual([]); expect(result.deferred).toEqual([]);
    expect(result.value).toBe(this.driver.declaredType(targetModule, target));
  }
  expectScenarioSubject(title: string, module: string, subject: string): void {
    this.expectOwner(this.driver.scenario(title).id, this.driver.declaration(module, subject).id);
  }
  expectExampleSubject(module: string, title: string, targetModule: string, target: string): void {
    this.expectOwner(this.driver.example(module, title).id, this.driver.declaration(targetModule, target).id);
  }
  private expectOwner(id: NodeId, expected: NodeId): void {
    const owner = this.driver.owner(id);
    expect(owner?.id).toBe(expected);
    const block = this.driver.inspection.parent(id)!;
    expect(this.driver.resolution.model.children(expected).filter(child => child === block.id)).toHaveLength(1);
    expect(this.driver.resolution.model.roots()).not.toContain(block.id);
  }
  expectScenarioContract(title: string, expected: { subject: string; operation: string; arguments: readonly string[]; expectation: string }): void {
    const scenario = this.driver.scenario(title), owner = this.driver.owner(scenario.id);
    expect(owner && 'name' in owner ? owner.name : undefined).toBe(expected.subject);
    const when = scenario.steps.find(step => step.kind === 'when');
    if (!when) throw new Error('Missing when step');
    const selected = this.driver.calledOperation(when.content.id);
    expect(selected.problems).toEqual([]); expect(selected.deferred).toEqual([]);
    const operation = this.driver.inspection.read(selected.value!);
    expect(owner && 'name' in owner && 'name' in operation ? owner.name + '.' + operation.name : undefined).toBe(expected.operation);
    if (when.content.kind !== 'call-expression') throw new Error('Expected actual call');
    expect(when.content.arguments.map(argument => argument.kind === 'string-literal' ? argument.value : argument.kind)).toEqual(expected.arguments);
    const then = scenario.steps.find(step => step.kind === 'then');
    expect(then?.content.kind === 'prose-expectation' ? then.content.text.value : undefined).toBe(expected.expectation);
  }
  expectScenarioOrigin(title: string, module: string, at: { line: number }): void { this.expectOrigin(this.driver.scenario(title).origin, module, at.line); }
  expectExampleOrigin(module: string, title: string, at: { line: number }): void { this.expectOrigin(this.driver.inspection.read(this.driver.example(module, title).id).origin, module, at.line); }
  private expectOrigin(origin: Origin, module: string, line: number): void {
    expect(origin).toMatchObject({ kind: 'source', module, range: { sourceId: module + '.expec', start: { line } } });
  }
  expectRememberedCapabilities(saved: string, module: string, owner: string, names: readonly string[]): void {
    const previous = this.driver.remembered.get(saved)!, inspection = new QueryInspection(previous.resolution.model);
    const node = inspection.read(this.driver.declaration(module, owner).id);
    if (!('members' in node)) throw new Error('Expected remembered members');
    expect(node.members.filter(member => member.kind === 'capability').map(member => member.name)).toEqual(names);
  }
  expectCallTarget(module: string, example: string, targetModule: string, target: string): void {
    const node = this.driver.inspection.read(this.driver.example(module, example).id, 'example');
    expect(this.driver.calledOperation(node.actual.id)).toEqual({ value: this.driver.declaration(targetModule, target).id, problems: [], deferred: [] });
  }
  expectMemberParent(module: string, name: string, ownerModule: string, owner: string): void {
    const id = this.driver.declaration(module, name).id, parent = this.driver.declaration(ownerModule, owner).id;
    expect(this.driver.resolution.model.parent(id)).toBe(parent);
    expect(this.driver.resolution.model.children(parent).filter(child => child === id)).toHaveLength(1);
  }
  expectOriginalMemberParentKind(module: string, name: string, kind: string): void {
    const model = this.driver.modules.get(module)!;
    expect(model.node(model.parent(this.driver.declaration(module, name).id)!).kind).toBe(kind);
  }
  expectConsumedDirectiveHandles(module: string, kind: 'extend'): void {
    const raw = this.driver.modules.get(module)!;
    for (const directive of raw.nodes(kind)) {
      const consumed = [directive.id, directive.target, ...raw.children(directive.target)];
      for (const id of consumed) {
        expect(raw.node(id).id).toBe(id);
        expect(() => this.driver.resolution.model.node(id)).toThrowError(expect.objectContaining({ code: 'not-analyzed' }));
      }
      for (const id of directive.members) expect(this.driver.resolution.model.node(id).id).toBe(id);
    }
  }
  expectExampleCount(module: string, count: number): void {
    expect([...this.driver.inspection.query('example')].filter(node => node.origin.kind === 'source' && node.origin.module === module)).toHaveLength(count);
  }
  expectOriginalExampleIdentity(module: string, title: string): void {
    const original = this.driver.example(module, title), actual = this.driver.inspection.read(original.id);
    expect(actual.id).toBe(original.id); expect(actual.origin).toEqual(original.origin);
  }
  expectSubjectBinding(module: string, subject: string, targetModule: string, target: string): void {
    const raw = this.driver.modules.get(module)!;
    const block = raw.nodes('examples').find(block => block.subject && raw.node(block.subject, 'reference').segments.map(id => raw.node(id, 'name').decoded).join('.') === subject)!;
    expect(this.driver.resolution.model.resolution(block.subject!)).toEqual({ status: 'bound', target: this.driver.declaration(targetModule, target).id });
  }
  expectBlockIsNotRoot(module: string, index: number): void { expect(this.driver.resolution.model.roots()).not.toContain(this.driver.block(module, index).id); }
  expectBlockIsRoot(module: string, index: number): void { expect(this.driver.resolution.model.roots()).toContain(this.driver.block(module, index).id); }
  expectOriginalBlockIsRoot(module: string, index: number): void { expect(this.driver.modules.get(module)!.roots()).toContain(this.driver.block(module, index).id); }
  expectBlockHasNoAuthoredSubject(module: string, index: number): void { expect(this.driver.block(module, index).subject).toBeUndefined(); }
  expectBlockHasNoSyntheticSubject(module: string, index: number): void { expect(this.driver.inspection.read(this.driver.block(module, index).id, 'examples').subject).toBeUndefined(); }
  expectBlockNotAnalyzed(module: string, index: number): void {
    const raw = this.driver.modules.get(module)!;
    const visit = (id: NodeId): void => {
      expect(() => this.driver.resolution.model.node(id)).toThrowError(expect.objectContaining({ code: 'not-analyzed' }));
      for (const child of raw.children(id)) visit(child);
    };
    visit(this.driver.block(module, index).id);
  }
  expectNoOwnedExamples(module: string, owner: string): void {
    expect(this.driver.resolution.model.children(this.driver.declaration(module, owner).id).filter(id => this.driver.resolution.model.node(id).kind === 'examples')).toEqual([]);
  }
  expectBuiltinExampleSubject(title: string, name: string): void {
    const example = [...this.driver.inspection.query('example')].find(node => node.title.value === title)!;
    this.expectOwner(example.id, this.driver.declaration('builtin', name).id);
  }
  expectAuthoredDeclarationCount(name: string, count: number): void {
    const matches = [...this.driver.modules.values()].flatMap(model => allNodes(model).filter(node => 'name' in node && model.node(node.name, 'name').decoded === name));
    expect(matches).toHaveLength(count);
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
