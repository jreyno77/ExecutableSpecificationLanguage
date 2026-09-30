import { expect } from 'vitest';
import {
  AntlrSyntaxReader, DescriptionInspection, ExternalInspection, Resolver, TypeDescriber,
  type ExternalDefinition, type ModuleInspection, type NodeId, type ProblemLocation,
  type Resolution, type TypeCatalog, type TypeId, type TypeFact, type TypedSlot,
} from '../../src/index.js';

/** A contract viewer using the public reader, resolver and type queries. */
export class TypeDescriptions {
  private entry!: ModuleInspection;
  private readonly modules: ModuleInspection[] = [];
  private readonly texts = new Map<string, string>();
  private resolution!: Resolution;
  private catalog!: TypeCatalog;
  private selected!: TypeId;
  private originalReferences = '';

  source(text: string, locator = 'types.expec'): void { this.entry = this.read(text, locator); }
  module(locator: string, text: string): void { this.modules.push(this.read(text, locator)); }
  external(definitions: readonly ExternalDefinition[]): void { this.entry = new ExternalInspection('external', definitions); }
  externalModule(locator: string, definitions: readonly ExternalDefinition[]): void {
    this.modules.push(new ExternalInspection(locator, definitions));
  }
  analyze(): void {
    this.resolution = new Resolver().resolve(this.entry, { modules: this.modules, packages: [] });
    this.originalReferences = JSON.stringify([...this.resolution.nodes('reference')]);
    this.catalog = new TypeDescriber().describe(this.resolution);
  }
  describe(name: string): void {
    if (!this.catalog) this.analyze();
    this.selected = this.catalog.declaredType(this.declaration(name));
  }
  describeCallables(): void { this.analyze(); }
  followField(name: string): void { this.selected = known(this.field(name).type); }
  followArgument(index: number): void {
    const type = this.catalog.describe(this.meaning(this.selected));
    if (!('arguments' in type)) throw new Error('Expected an applied type');
    this.selected = type.arguments[index]!;
  }

  expectType(name: string): void { expect(this.label(this.selected)).toBe(name); }
  expectTupleElements(names: string[]): void {
    const type = this.catalog.describe(this.meaning(this.selected));
    expect(type.kind).toBe('tuple');
    if (type.kind !== 'tuple') throw new Error('Expected a tuple');
    expect(type.elements.map(id => this.label(id))).toEqual(names);
  }
  expectOpenParameters(first: string, second: string): void {
    const one = this.catalog.describe(this.meaning(this.catalog.declaredType(this.declaration(first))));
    const two = this.catalog.describe(this.catalog.declaredType(this.declaration(second)));
    if (one.kind !== 'tuple' || !('arguments' in two)) throw new Error('Expected an open pair and box');
    expect(one.elements[0]).toBe(one.elements[1]);
    const parameter = this.catalog.describe(one.elements[0]!);
    const other = this.catalog.describe(two.arguments[0]!);
    expect(parameter.kind).toBe('parameter');
    expect(other.kind).toBe('parameter');
    if (parameter.kind !== 'parameter' || other.kind !== 'parameter') throw new Error('Expected parameters');
    expect(parameter.declaration).not.toBe(other.declaration);
    expect(this.resolution.node(parameter.declaration, 'type-parameter')).toBeDefined();
  }
  expectDistinctDeclarations(first: string, second: string): void {
    expect(this.declaration(first)).not.toBe(this.declaration(second));
    expect(this.catalog.declaredType(this.declaration(first))).not.toBe(this.catalog.declaredType(this.declaration(second)));
  }
  expectAlias(name: string, target: string): void {
    const alias = this.catalog.describe(this.selected);
    expect(alias.kind).toBe('alias');
    if (alias.kind !== 'alias') throw new Error('Expected an alias');
    expect(alias.declaration).toBe(this.declaration(name));
    expect(known(alias.target)).toBe(this.catalog.declaredType(this.declaration(target)));
  }
  expectSelectedDeclaration(name: string): void {
    const type = this.catalog.describe(this.meaning(this.selected));
    expect('declaration' in type && type.declaration).toBe(this.declaration(name));
  }
  expectFields(names: string[]): void {
    const fields = known(this.catalog.fields(this.selected));
    expect(fields.kind).toBe('available');
    if (fields.kind !== 'available') throw new Error('Expected readable fields');
    expect(fields.fields.map(field => this.name(field.declaration))).toEqual(names);
  }
  expectOpaque(): void { expect(this.catalog.fields(this.selected)).toEqual({ status: 'known', value: { kind: 'opaque' } }); }
  expectFieldType(name: string, type: string): void { expect(this.label(known(this.field(name).type))).toBe(type); }
  expectFieldProblem(name: string, code: string, at: string): void { this.expectFailure(this.field(name).type, code, at); }
  expectAliasProblem(code: string, at: string): void {
    const alias = this.catalog.describe(this.selected);
    if (alias.kind !== 'alias') throw new Error('Expected an alias');
    this.expectFailure(alias.target, code, at);
  }
  expectAliasDeferred(reason: string): void {
    const alias = this.catalog.describe(this.selected);
    if (alias.kind !== 'alias') throw new Error('Expected an alias');
    expect(alias.target.status).toBe('deferred');
    if (alias.target.status !== 'deferred') throw new Error('Expected a deferred alias target');
    expect(alias.target.requirements.map(item => item.reason)).toContain(reason);
    expect(this.catalog.deferred).toEqual(expect.arrayContaining(alias.target.requirements));
  }
  expectMixedAliasFailure(code: string, reason: string): void {
    const alias = this.catalog.describe(this.selected);
    if (alias.kind !== 'alias' || alias.target.status !== 'invalid') throw new Error('Expected an invalid alias target');
    expect(alias.target.problems.map(problem => problem.code)).toContain(code);
    expect(alias.target.deferred.map(item => item.reason)).toContain(reason);
    for (const requirement of alias.target.deferred) expect(this.resolution.deferred).toContain(requirement);
  }

  expectParameters(name: string, parameters: string[]): void {
    expect(this.catalog.callable(this.declaration(name)).parameters.map(slot => `${this.name(slot.declaration)}: ${this.label(known(slot.type))}`)).toEqual(parameters);
  }
  expectParameterProblem(callable: string, parameter: string, code: string, at: string): void {
    this.expectFailure(this.catalog.callable(this.declaration(callable)).parameters.find(slot => this.name(slot.declaration) === parameter)!.type, code, at);
  }
  expectParameterType(callable: string, parameter: string, type: string): void {
    expect(this.label(known(this.catalog.callable(this.declaration(callable)).parameters.find(slot => this.name(slot.declaration) === parameter)!.type))).toBe(type);
  }
  expectResult(name: string, expected: { kind: 'value'; type: string } | { kind: 'none' | 'unspecified' }): void {
    const result = known(this.catalog.callable(this.declaration(name)).result);
    expect(result.kind === 'value' ? { kind: result.kind, type: this.label(result.type) } : result).toEqual(expected);
  }
  expectResultProblem(name: string, code: string, at: string): void {
    this.expectFailure(this.catalog.callable(this.declaration(name)).result, code, at);
  }
  expectCallableProblem(name: string, code: string): void {
    expect(this.catalog.callable(this.declaration(name)).problems.map(problem => problem.code)).toContain(code);
  }
  expectConstruction(name: string, parameters: string[] | undefined): void {
    const result = known(this.catalog.construction(this.declaration(name)));
    expect(result?.parameters.map(slot => `${this.name(slot.declaration)}: ${this.label(known(slot.type))}`)).toEqual(parameters);
    if (result) expect(this.resolution.node(result.declaration, 'construction')).toBeDefined();
  }
  expectConstructionProblem(name: string, code: string): void {
    const fact = this.catalog.construction(this.declaration(name));
    expect(fact.status).toBe('invalid');
    if (fact.status !== 'invalid') throw new Error('Expected invalid construction');
    expect(fact.problems.map(problem => problem.code)).toContain(code);
    for (const problem of fact.problems) expect(this.resolution.problems).toContain(problem);
  }
  expectExternalDefault(callable: string, parameter: string): void {
    const slot = this.catalog.callable(this.declaration(callable)).parameters.find(slot => this.name(slot.declaration) === parameter)!;
    expect(this.resolution.node(slot.declaration, 'parameter').payload).toMatchObject({ hasDefault: true });
    expect(this.resolution.node(slot.declaration, 'parameter').payload.defaultValue).toBeUndefined();
  }
  expectBody(callable: string, kind: string): void {
    const node = this.resolution.node(this.declaration(callable));
    if (!('body' in node.payload)) throw new Error('Expected a callable');
    expect(node.payload.body.kind).toBe(kind);
  }
  expectDeclarations(types: string[], callables: string[]): void {
    expect([...this.catalog.typeDeclarations()].map(id => this.name(id))).toEqual(types);
    expect([...this.catalog.callableDeclarations()].map(id => this.name(id))).toEqual(callables);
  }
  expectProblem(code: string, at?: string, related?: string): void {
    const problem = this.catalog.problems.find(problem => problem.code === code && (!at || this.textAt(problem.at) === at));
    expect(problem, `Expected ${code}${at ? ` at ${at}` : ''}`).toBeDefined();
    if (related) expect(problem!.related.map(location => this.textAt(location))).toContain(related);
  }
  expectNoProblems(): void { expect(this.catalog.problems).toEqual([]); expect(this.resolution.problems).toEqual([]); }
  expectNoTypeProblems(): void { expect(this.catalog.problems).toEqual([]); }
  expectOnlyBodyDeferred(): void {
    expect(this.resolution.deferred.map(item => item.reason)).toContain('receiver-type');
    expect(this.catalog.deferred).toEqual([]);
  }
  expectUnchangedAfterQueries(): void {
    const findings = JSON.stringify([this.catalog.problems, this.catalog.deferred]);
    const declared = [...this.catalog.typeDeclarations()].map(id => [id, this.catalog.declaredType(id)] as const);
    for (const id of [...this.catalog.callableDeclarations()].reverse()) this.catalog.callable(id);
    for (const [id, type] of declared.reverse()) expect(this.catalog.declaredType(id)).toBe(type);
    expect(JSON.stringify([this.catalog.problems, this.catalog.deferred])).toBe(findings);
    expect(JSON.stringify([...this.resolution.nodes('reference')])).toBe(this.originalReferences);
    expect(this.catalog.inspection).toBe(this.resolution);
  }
  expectIndependentCatalog(): void {
    const next = new TypeDescriber().describe(this.resolution);
    expect(() => next.describe(this.selected)).toThrow(expect.objectContaining({ code: 'unknown-type', typeId: this.selected }));
    const original = this.catalog.describe(this.selected);
    if (!('declaration' in original)) throw new Error('Expected a declared type');
    expect(next.describe(next.declaredType(original.declaration))).toMatchObject({ declaration: original.declaration });
    expect(next.declaredType(original.declaration)).not.toBe(this.selected);
  }
  expectLiteralOrigins(spellings: string[]): void {
    const type = this.catalog.describe(this.meaning(this.selected));
    if (type.kind !== 'tuple') throw new Error('Expected literal tuple');
    expect(type.elements.map(id => {
      const literal = this.catalog.describe(id);
      if (literal.kind !== 'literal') throw new Error('Expected literal type');
      return this.textAt(this.resolution.node(literal.expression, 'literal-type').origin);
    })).toEqual(spellings);
  }

  private read(text: string, locator: string): ModuleInspection {
    const result = new AntlrSyntaxReader().read({ sourceId: locator, text });
    if (result.status !== 'accepted') throw new Error('Acceptance source must be grammatical: ' + JSON.stringify(result.diagnostics));
    this.texts.set(locator, text);
    return new DescriptionInspection(locator, result.description);
  }
  private declaration(name: string): NodeId {
    const found = [...this.catalog.typeDeclarations(), ...this.catalog.callableDeclarations()].find(id => this.name(id) === name);
    if (!found) throw new Error(`Expected declaration ${name}`);
    return found;
  }
  private name(id: NodeId): string {
    const node = this.resolution.node(id);
    if (!('name' in node.payload)) throw new Error('Expected a named declaration');
    return this.resolution.name(node.payload.name);
  }
  private field(name: string): TypedSlot {
    const fields = known(this.catalog.fields(this.selected));
    if (fields.kind !== 'available') throw new Error('Expected readable fields');
    const field = fields.fields.find(slot => this.name(slot.declaration) === name);
    if (!field) throw new Error(`Expected field ${name}`);
    expect(this.resolution.node(field.declaration, 'field')).toBeDefined();
    return field;
  }
  private meaning(id: TypeId): TypeId {
    const visited = new Set<TypeId>();
    for (;;) {
      if (visited.has(id)) throw new Error('A type query returned an unreported alias cycle');
      visited.add(id);
      const type = this.catalog.describe(id);
      if (type.kind !== 'alias') return id;
      id = known(type.target);
    }
  }
  private label(id: TypeId): string {
    const type = this.catalog.describe(this.meaning(id));
    switch (type.kind) {
      case 'builtin': case 'declared': return this.name(type.declaration) + (type.arguments.length ? `<${type.arguments.map(id => this.label(id)).join(', ')}>` : '');
      case 'parameter': return this.name(type.declaration);
      case 'tuple': return `[${type.elements.map(id => this.label(id)).join(', ')}]`;
      case 'union': return type.alternatives.map(id => this.label(id)).join(' | ');
      case 'optional': return `${this.label(type.inner)}?`;
      case 'literal': return this.textAt(this.resolution.node(type.expression).origin);
      default: throw new Error('Expected a described type');
    }
  }
  private textAt(location: ProblemLocation): string {
    return location.kind === 'source' ? this.texts.get(location.module)!.slice(location.range.start.offset, location.range.end.offset) : JSON.stringify(location);
  }
  private expectFailure<T>(fact: TypeFact<T>, code: string, at: string): void {
    expect(fact.status).toBe('invalid');
    if (fact.status !== 'invalid') throw new Error('Expected an invalid type fact');
    const problem = fact.problems.find(problem => problem.code === code && this.textAt(problem.at) === at);
    expect(problem, `Expected ${code} at ${at}`).toBeDefined();
    if (this.resolution.problems.some(cause => cause.code === code)) expect(this.resolution.problems).toContain(problem);
  }
}

function known<T>(fact: TypeFact<T>): T {
  expect(fact.status).toBe('known');
  if (fact.status !== 'known') throw new Error(`Expected a known fact: ${JSON.stringify(fact)}`);
  return fact.value;
}
