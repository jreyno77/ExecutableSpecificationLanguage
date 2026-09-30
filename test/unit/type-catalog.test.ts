import { describe, expect, it } from 'vitest';
import {
  AntlrSyntaxReader, DescriptionInspection, Resolver, TypeDescriber,
  type ModuleInspection, type NodeId, type TypeFact, type TypeId,
} from '../../src/index.js';

describe('a type catalog caller uses checked, stable queries', () => {
  it('rejects a declaration where a type expression is required', () => {
    const { inspection, catalog } = describeText('type Cart {}');
    const declaration = [...inspection.nodes('record-type-declaration')][0]!.id;
    expect(() => catalog.typeOf(declaration)).toThrow(expect.objectContaining({ code: 'unexpected-kind', nodeId: declaration }));
  });

  it('rejects a field where a type expression is required', () => {
    const { inspection, catalog } = describeText('type Cart { title: Text }');
    const field = [...inspection.nodes('field')][0]!.id;
    expect(() => catalog.typeOf(field)).toThrow(expect.objectContaining({ code: 'unexpected-kind', nodeId: field }));
  });

  it('rejects a function where a declared type is required', () => {
    const { inspection, catalog } = describeText('function save()');
    const callable = [...inspection.nodes('function')][0]!.id;
    expect(() => catalog.declaredType(callable)).toThrow(expect.objectContaining({ code: 'unexpected-kind', nodeId: callable }));
  });

  it('rejects a record where a callable is required', () => {
    const { inspection, catalog } = describeText('type Cart {}');
    const declaration = [...inspection.nodes('record-type-declaration')][0]!.id;
    expect(() => catalog.callable(declaration)).toThrow(expect.objectContaining({ code: 'unexpected-kind', nodeId: declaration }));
  });

  it('rejects an unknown node instead of inventing a type', () => {
    const { catalog } = describeText('type Cart {}');
    const unknown = {} as NodeId;
    expect(() => catalog.declaredType(unknown)).toThrow(expect.objectContaining({ code: 'missing-node', nodeId: unknown }));
  });

  it('rejects a declaration from a different inspection', () => {
    const { catalog } = describeText('type Cart {}');
    const foreign = [...read('type Other {}', 'other').nodes('record-type-declaration')][0]!.id;
    expect(() => catalog.declaredType(foreign)).toThrow(expect.objectContaining({ code: 'foreign-node', nodeId: foreign }));
  });

  it('distinguishes a supplied but unreached declaration from a foreign node', () => {
    const unused = read('type Other {}', 'unused');
    const inspection = new Resolver().resolve(read('type Cart {}'), { modules: [unused], packages: [] });
    const catalog = new TypeDescriber().describe(inspection);
    const declaration = [...unused.nodes('record-type-declaration')][0]!.id;
    expect(() => catalog.declaredType(declaration)).toThrow(expect.objectContaining({ code: 'not-analyzed', nodeId: declaration }));
  });

  it('rejects fabricated type handles in description and field queries', () => {
    const { catalog } = describeText('type Cart {}');
    const unknown = {} as TypeId;
    expect(() => catalog.describe(unknown)).toThrow(expect.objectContaining({ code: 'unknown-type', typeId: unknown }));
    expect(() => catalog.fields(unknown)).toThrow(expect.objectContaining({ code: 'unknown-type', typeId: unknown }));
  });

  it('rejects another catalogs handle even when they share the same inspection', () => {
    const { inspection, catalog } = describeText('type Cart {}');
    const other = new TypeDescriber().describe(inspection);
    const type = catalog.declaredType([...catalog.typeDeclarations()][0]!);
    expect(() => other.describe(type)).toThrow(expect.objectContaining({ code: 'unknown-type', typeId: type }));
  });

  it('reports a field-query error using the alias handle the caller supplied', () => {
    const { catalog } = describeText('type Count = Number');
    const alias = catalog.declaredType([...catalog.typeDeclarations()][0]!);
    expect(() => catalog.fields(alias)).toThrow(expect.objectContaining({ code: 'wrong-kind', typeId: alias }));
  });

  it('reports a field-query error for a tuple without pretending it is an empty record', () => {
    const { inspection, catalog } = describeText('type Pair = [Number, Text]');
    const tuple = known(catalog.typeOf([...inspection.nodes('tuple-type')][0]!.id));
    expect(() => catalog.fields(tuple)).toThrow(expect.objectContaining({ code: 'wrong-kind', typeId: tuple }));
  });

  it('identifies the builtin List constructor without inventing an inspected parameter', () => {
    const { inspection, catalog } = describeText('type Cart {}');
    const list = [...inspection.nodes('builtin-type')].find(node => inspection.name(node.payload.name) === 'List')!;
    const type = catalog.describe(catalog.declaredType(list.id));
    expect(type).toMatchObject({ kind: 'builtin', arguments: [] });
    if (type.kind !== 'builtin') throw new Error('Expected builtin List');
    expect(type.declaration).toBe(list.id);
    expect([...inspection.nodes('type-parameter')]).toEqual([]);
    expect([...catalog.typeDeclarations()]).not.toContain(list.id);
  });

  it('rejects an authored bare List because its element argument is missing', () => {
    const { inspection, catalog } = describeText('type Broken = List');
    const use = [...inspection.nodes('named-type')][0]!;
    const fact = catalog.typeOf(use.id);
    expect(fact.status).toBe('invalid');
    if (fact.status !== 'invalid') throw new Error('Expected invalid List application');
    expect(fact.problems).toContainEqual(expect.objectContaining({ code: 'wrong-type-argument-count', at: use.origin }));
    expect(catalog.problems.map(problem => problem.code)).toEqual(['wrong-type-argument-count']);
  });

  it('returns the original resolution problem object for an invalid type expression', () => {
    const { inspection, catalog } = describeText('type Broken = Missing');
    const fact = catalog.typeOf([...inspection.nodes('named-type')][0]!.id);
    expect(fact.status).toBe('invalid');
    if (fact.status !== 'invalid') throw new Error('Expected invalid type');
    expect(fact.problems).toHaveLength(1);
    expect(fact.problems[0]).toBe(inspection.problems[0]);
    expect(catalog.problems).toEqual([]);
  });

  it('does not call a use of an invalid alias known', () => {
    const { inspection, catalog } = describeText('type Broken = Missing\nfunction save(item: Broken)');
    const parameter = [...inspection.nodes('parameter')][0]!;
    const fact = catalog.typeOf(parameter.payload.declaredType);
    expect(fact.status).toBe('invalid');
    if (fact.status !== 'invalid') throw new Error('Expected invalid alias use');
    expect(fact.problems[0]).toBe(inspection.problems[0]);
    const identity = catalog.describe(catalog.declaredType([...inspection.nodes('alias-type-declaration')][0]!.id));
    expect(identity.kind).toBe('alias');
  });

  it('preserves original deferred prerequisites through a type expression query', () => {
    const { inspection, catalog } = describeText('include "later"\ntype Selected = Pending');
    const fact = catalog.typeOf([...inspection.nodes('named-type')][0]!.id);
    expect(fact.status).toBe('deferred');
    if (fact.status !== 'deferred') throw new Error('Expected deferred type');
    expect(fact.requirements).toHaveLength(1);
    expect(fact.requirements[0]).toBe(inspection.deferred[0]);
    expect(catalog.deferred[0]).toBe(inspection.deferred[0]);
  });

  it('keeps field and parameter identities from the original inspection', () => {
    const { inspection, catalog } = describeText('type Cart { title: Text }\nfunction save(cart: Cart)');
    const declaration = [...inspection.nodes('record-type-declaration')][0]!;
    const fields = known(catalog.fields(catalog.declaredType(declaration.id)));
    if (fields.kind !== 'available') throw new Error('Expected record fields');
    expect(fields.fields[0]!.declaration).toBe([...inspection.nodes('field')][0]!.id);
    const callable = catalog.callable([...inspection.nodes('function')][0]!.id);
    expect(callable.parameters[0]!.declaration).toBe([...inspection.nodes('parameter')][0]!.id);
    const parameterType = catalog.describe(known(callable.parameters[0]!.type));
    if (parameterType.kind !== 'declared') throw new Error('Expected Cart');
    expect(parameterType.declaration).toBe(declaration.id);
    expect(catalog.inspection).toBe(inspection);
  });

  it('describes each generic parameter by its original distinct declaration', () => {
    const { inspection, catalog } = describeText('type Pair<T> = [T, T]\ntype Box<T> { value: T }');
    const parameters = [...inspection.nodes('type-parameter')];
    const first = catalog.describe(catalog.declaredType(parameters[0]!.id));
    const second = catalog.describe(catalog.declaredType(parameters[1]!.id));
    expect(first.kind).toBe('parameter');
    expect(second.kind).toBe('parameter');
    if (first.kind !== 'parameter' || second.kind !== 'parameter') throw new Error('Expected parameter descriptions');
    expect(first.declaration).toBe(parameters[0]!.id);
    expect(second.declaration).toBe(parameters[1]!.id);
    expect(first.declaration).not.toBe(second.declaration);
  });

  it('keeps repeated expression and declaration query handles stable', () => {
    const { inspection, catalog } = describeText('type Box<T> { value: T }\ntype Selected = Box<Number>');
    const expression = [...inspection.nodes('named-type')].find(node => inspection.reference(node.payload.reference)[0] === 'Box')!;
    const first = known(catalog.typeOf(expression.id));
    const declaration = [...catalog.typeDeclarations()][0]!;
    expect(known(catalog.typeOf(expression.id))).toBe(first);
    expect(catalog.declaredType(declaration)).toBe(catalog.declaredType(declaration));
    catalog.fields(first);
    expect(known(catalog.typeOf(expression.id))).toBe(first);
  });

  it('publishes type findings before queries and never adds them while querying', () => {
    const { inspection, catalog } = describeText('type Broken = List<Text, Number>');
    const findings = [...catalog.problems];
    expect(findings.map(problem => problem.code)).toEqual(['wrong-type-argument-count']);
    const declaration = [...catalog.typeDeclarations()][0]!;
    catalog.describe(catalog.declaredType(declaration));
    catalog.typeOf([...inspection.nodes('named-type')][0]!.id);
    expect(catalog.problems).toHaveLength(findings.length);
    findings.forEach((problem, index) => expect(catalog.problems[index]).toBe(problem));
  });

  it('replays declaration enumerations without consuming another callers iteration', () => {
    const { catalog } = describeText('type First {}\ntype Second {}\nfunction save()');
    const types = catalog.typeDeclarations();
    const expected = [...types];
    expect(expected).toHaveLength(2);
    expect([...types]).toEqual(expected);
    expect([...catalog.callableDeclarations()]).toHaveLength(1);
    expect([...catalog.typeDeclarations()]).toEqual(expected);
  });

  it('reuses a describer without leaking findings or handles between calls', () => {
    const describer = new TypeDescriber();
    const invalid = describer.describe(resolve('type Broken = List<Number, Text>'));
    const valid = describer.describe(resolve('type Cart {}'));
    expect(invalid.problems.map(problem => problem.code)).toEqual(['wrong-type-argument-count']);
    expect(valid.problems).toEqual([]);
    expect(valid.deferred).toEqual([]);
    const oldType = invalid.declaredType([...invalid.typeDeclarations()][0]!);
    expect(() => valid.describe(oldType)).toThrow(expect.objectContaining({ code: 'unknown-type', typeId: oldType }));
    expect(invalid.problems).toHaveLength(1);
  });
});

function read(text: string, locator = 'types.expec'): ModuleInspection {
  const result = new AntlrSyntaxReader().read({ sourceId: locator, text });
  if (result.status !== 'accepted') throw new Error(JSON.stringify(result.diagnostics));
  return new DescriptionInspection(locator, result.description);
}
function resolve(text: string) { return new Resolver().resolve(read(text), { modules: [], packages: [] }); }
function describeText(text: string) {
  const inspection = resolve(text);
  return { inspection, catalog: new TypeDescriber().describe(inspection) };
}
function known<T>(fact: TypeFact<T>): T {
  expect(fact.status).toBe('known');
  if (fact.status !== 'known') throw new Error('Expected known type fact');
  return fact.value;
}
