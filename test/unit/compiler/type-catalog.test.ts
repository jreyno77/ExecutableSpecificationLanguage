import { describe, expect, it } from 'vitest';
import {
  LangiumReader, LangiumModel, Resolver, TypeDescriber,
  type ModuleModel, type NodeId, type TypeFact, type TypeId,
} from '../../../src/index.js';

describe('a type catalog caller uses checked, stable queries', () => {
  it('shares inferred collection types with signature and field queries', () => {
    const { catalog } = describeText('type Box<T> { value: T }');
    const builtin = (name: string) => [...catalog.inspection.query('builtin-type')].find(type => type.name === name)!;
    const number = catalog.declaredType(builtin('Number').id), text = catalog.declaredType(builtin('Text').id);
    const union = catalog.types.unionOf([number, text]);
    const list = catalog.types.intern({ kind: 'builtin', declaration: builtin('List').id, arguments: [union] });
    const box = catalog.types.intern({ kind: 'declared', declaration: [...catalog.typeDeclarations()][0]!, arguments: [list] });
    const fields = known(catalog.fields(box));
    if (fields.kind !== 'available') throw new Error('Expected Box fields');
    expect(known(fields.fields[0]!.type)).toBe(list);
    expect(catalog.describe(list)).toEqual({ kind: 'builtin', declaration: builtin('List').id, arguments: [union] });
    expect(catalog.describe(union)).toEqual({ kind: 'union', alternatives: [number, text] });
    expect(catalog.problems).toEqual([]);
    expect(catalog.deferred).toEqual([]);
  });

  it('keeps inferred type handles local to the catalog snapshot that owns them', () => {
    const { resolution, catalog } = describeText('type Cart {}');
    const cart = catalog.declaredType([...catalog.typeDeclarations()][0]!);
    const inferred = catalog.types.intern({ kind: 'optional', inner: cart });
    const other = new TypeDescriber().describe(resolution);
    expect(other.types).not.toBe(catalog.types);
    expect(() => other.describe(inferred)).toThrow(expect.objectContaining({ code: 'unknown-type', typeId: inferred }));
    expect(catalog.describe(inferred)).toEqual({ kind: 'optional', inner: cart });
  });

  it('rejects a declaration where a type expression is required', () => {
    const { resolution, catalog } = describeText('type Cart {}');
    const declaration = [...resolution.model.nodes('record-type-declaration')][0]!.id;
    expect(() => catalog.typeOf(declaration)).toThrow(expect.objectContaining({ code: 'unexpected-kind', nodeId: declaration }));
  });

  it('rejects a field where a type expression is required', () => {
    const { resolution, catalog } = describeText('type Cart { title: Text }');
    const field = [...resolution.model.nodes('field')][0]!.id;
    expect(() => catalog.typeOf(field)).toThrow(expect.objectContaining({ code: 'unexpected-kind', nodeId: field }));
  });

  it('rejects a function where a declared type is required', () => {
    const { resolution, catalog } = describeText('function save()');
    const callable = [...resolution.model.nodes('function')][0]!.id;
    expect(() => catalog.declaredType(callable)).toThrow(expect.objectContaining({ code: 'unexpected-kind', nodeId: callable }));
  });

  it('rejects a record where a callable is required', () => {
    const { resolution, catalog } = describeText('type Cart {}');
    const declaration = [...resolution.model.nodes('record-type-declaration')][0]!.id;
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
    const resolution = new Resolver().resolve(read('type Cart {}'), { modules: [unused], packages: [] });
    const catalog = new TypeDescriber().describe(resolution);
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
    const { resolution, catalog } = describeText('type Cart {}');
    const other = new TypeDescriber().describe(resolution);
    const type = catalog.declaredType([...catalog.typeDeclarations()][0]!);
    expect(() => other.describe(type)).toThrow(expect.objectContaining({ code: 'unknown-type', typeId: type }));
  });

  it('reports a field-query error using the alias handle the caller supplied', () => {
    const { catalog } = describeText('type Count = Number');
    const alias = catalog.declaredType([...catalog.typeDeclarations()][0]!);
    expect(() => catalog.fields(alias)).toThrow(expect.objectContaining({ code: 'wrong-kind', typeId: alias }));
  });

  it('reports a field-query error for a tuple without pretending it is an empty record', () => {
    const { resolution, catalog } = describeText('type Pair = [Number, Text]');
    const tuple = known(catalog.typeOf([...resolution.model.nodes('tuple-type')][0]!.id));
    expect(() => catalog.fields(tuple)).toThrow(expect.objectContaining({ code: 'wrong-kind', typeId: tuple }));
  });

  it('identifies the builtin List constructor without inventing an inspected parameter', () => {
    const { resolution, catalog } = describeText('type Cart {}');
    const list = [...resolution.model.nodes('builtin-type')].find(node => catalog.inspection.read(node.id, 'builtin-type').name === 'List')!;
    const type = catalog.describe(catalog.declaredType(list.id));
    expect(type).toMatchObject({ kind: 'builtin', arguments: [] });
    if (type.kind !== 'builtin') throw new Error('Expected builtin List');
    expect(type.declaration).toBe(list.id);
    expect([...resolution.model.nodes('type-parameter')]).toEqual([]);
    expect([...catalog.typeDeclarations()]).not.toContain(list.id);
  });

  it('rejects an authored bare List because its element argument is missing', () => {
    const { resolution, catalog } = describeText('type Broken = List');
    const use = [...resolution.model.nodes('named-type')][0]!;
    const fact = catalog.typeOf(use.id);
    expect(fact.status).toBe('invalid');
    if (fact.status !== 'invalid') throw new Error('Expected invalid List application');
    expect(fact.problems).toContainEqual(expect.objectContaining({ code: 'wrong-type-argument-count', at: use.origin }));
    expect(catalog.problems.map(problem => problem.code)).toEqual(['wrong-type-argument-count']);
  });

  it('returns the original resolution problem object for an invalid type expression', () => {
    const { resolution, catalog } = describeText('type Broken = Missing');
    const fact = catalog.typeOf([...resolution.model.nodes('named-type')][0]!.id);
    expect(fact.status).toBe('invalid');
    if (fact.status !== 'invalid') throw new Error('Expected invalid type');
    expect(fact.problems).toHaveLength(1);
    expect(fact.problems[0]).toBe(resolution.problems[0]);
    expect(catalog.problems).toEqual([]);
  });

  it('does not call a use of an invalid alias known', () => {
    const { resolution, catalog } = describeText('type Broken = Missing\nfunction save(item: Broken)');
    const parameter = [...resolution.model.nodes('parameter')][0]!;
    const fact = catalog.typeOf(parameter.declaredType);
    expect(fact.status).toBe('invalid');
    if (fact.status !== 'invalid') throw new Error('Expected invalid alias use');
    expect(fact.problems[0]).toBe(resolution.problems[0]);
    const identity = catalog.describe(catalog.declaredType([...resolution.model.nodes('alias-type-declaration')][0]!.id));
    expect(identity.kind).toBe('alias');
  });

  it('preserves original deferred prerequisites through a type expression query', () => {
    const { resolution, catalog } = describeText('include "later"\ntype Selected = Pending');
    const fact = catalog.typeOf([...resolution.model.nodes('named-type')][0]!.id);
    expect(fact.status).toBe('deferred');
    if (fact.status !== 'deferred') throw new Error('Expected deferred type');
    expect(fact.requirements).toHaveLength(1);
    expect(fact.requirements[0]).toBe(resolution.deferred[0]);
    expect(catalog.deferred[0]).toBe(resolution.deferred[0]);
  });

  it('keeps field and parameter identities from the original inspection', () => {
    const { resolution, catalog } = describeText('type Cart { title: Text }\nfunction save(cart: Cart)');
    const declaration = [...resolution.model.nodes('record-type-declaration')][0]!;
    const fields = known(catalog.fields(catalog.declaredType(declaration.id)));
    if (fields.kind !== 'available') throw new Error('Expected record fields');
    expect(fields.fields[0]!.declaration).toBe([...resolution.model.nodes('field')][0]!.id);
    const callable = catalog.callable([...resolution.model.nodes('function')][0]!.id);
    expect(callable.parameters[0]!.declaration).toBe([...resolution.model.nodes('parameter')][0]!.id);
    const parameterType = catalog.describe(known(callable.parameters[0]!.type));
    if (parameterType.kind !== 'declared') throw new Error('Expected Cart');
    expect(parameterType.declaration).toBe(declaration.id);
    expect(catalog.inspection.read(declaration.id, 'record-type-declaration').name).toBe('Cart');
    expect(catalog.inspection.read(fields.fields[0]!.declaration, 'field').name).toBe('title');
    expect(catalog.inspection.read(callable.parameters[0]!.declaration, 'parameter').name).toBe('cart');
    expect(catalog.inspection.read(declaration.id).origin).toEqual(declaration.origin);
  });

  it('describes each generic parameter by its original distinct declaration', () => {
    const { resolution, catalog } = describeText('type Pair<T> = [T, T]\ntype Box<T> { value: T }');
    const parameters = [...resolution.model.nodes('type-parameter')];
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
    const { resolution, catalog } = describeText('type Box<T> { value: T }\ntype Selected = Box<Number>');
    const expression = [...resolution.model.nodes('named-type')].find(node => catalog.inspection.read(node.reference, 'reference').segments[0] === 'Box')!;
    const first = known(catalog.typeOf(expression.id));
    const declaration = [...catalog.typeDeclarations()][0]!;
    expect(known(catalog.typeOf(expression.id))).toBe(first);
    expect(catalog.declaredType(declaration)).toBe(catalog.declaredType(declaration));
    catalog.fields(first);
    expect(known(catalog.typeOf(expression.id))).toBe(first);
  });

  it('publishes type findings before queries and never adds them while querying', () => {
    const { resolution, catalog } = describeText('type Broken = List<Text, Number>');
    const findings = [...catalog.problems];
    expect(findings.map(problem => problem.code)).toEqual(['wrong-type-argument-count']);
    const declaration = [...catalog.typeDeclarations()][0]!;
    catalog.describe(catalog.declaredType(declaration));
    catalog.typeOf([...resolution.model.nodes('named-type')][0]!.id);
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

function read(text: string, locator = 'types.expec'): ModuleModel {
  const result = new LangiumReader().read({ sourceId: locator, text });
  if (result.status !== 'accepted') throw new Error(JSON.stringify(result.diagnostics));
  return new LangiumModel(locator, result.document);
}
function resolve(text: string) { return new Resolver().resolve(read(text), { modules: [], packages: [] }); }
function describeText(text: string) {
  const resolution = resolve(text);
  return { resolution, catalog: new TypeDescriber().describe(resolution) };
}
function known<T>(fact: TypeFact<T>): T {
  expect(fact.status).toBe('known');
  if (fact.status !== 'known') throw new Error('Expected known type fact');
  return fact.value;
}
