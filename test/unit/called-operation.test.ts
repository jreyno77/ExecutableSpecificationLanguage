import { describe, expect, it } from 'vitest';
import {
  ExpressionChecker, LangiumModel, LangiumReader, Resolver, TypeDescriber,
  type Check,
} from '../../src/index.js';

describe('a caller identifies an operation independently of checking its use', () => {
  it('identifies the declared operation even when arguments and its result are invalid', () => {
    const source = read(`function quantity(seed: Number) returns Missing
examples { example "quantity": quantity("many") => 1 }`);

    const selected = source.checker.calledOperation(source.call().id);

    expect(selected.value).toBe(source.operation('quantity').id);
    expect(selected.problems).toEqual([]);
    expect(selected.deferred).toEqual([]);
    expect(source.checker.checkCall(source.call().id).problems.map(problem => problem.code))
      .toEqual(expect.arrayContaining(['incompatible-type', 'unresolved-reference']));
  });

  it('identifies an operation even when an argument is unresolved and its result is unspecified', () => {
    const source = read(`function quantity(seed: Number)
examples { example "quantity": quantity(missing) => 1 }`);

    expect(source.checker.calledOperation(source.call().id).value).toBe(source.operation('quantity').id);
    expect(source.checker.typeOf(source.call().id).deferred)
      .toContainEqual(expect.objectContaining({ reason: 'declared-result' }));
  });

  it('identifies a check without accepting it as an effect', () => {
    const source = read(`examples {
  check hasQuantity(expected: Number)
  scenario "check" {
    when hasQuantity(1)
    then true
  }
}`);

    expect(source.checker.calledOperation(source.call().id).value).toBe(source.operation('hasQuantity').id);
    expect(source.checker.checkCall(source.call().id).problems)
      .toContainEqual(expect.objectContaining({ code: 'invalid-purpose' }));
  });

  it('preserves operation identity through grouped and qualified calls', () => {
    const source = read(`concept Basket {
  public add
  capability add() returns Nothing
}
examples { example "add": ((Basket.add)()) => satisfies "A book is added" }`);
    const example = [...source.catalog.inspection.query('example')][0]!;

    expect(source.checker.calledOperation(example.actual.id).value).toBe(source.operation('add').id);
  });

  it('identifies a capability through the type of a captured receiver', () => {
    const source = read(`concept Basket {
  public add
  capability add(title: Text) returns Nothing
}
examples {
  action open() returns Basket
  scenario "add" {
    when basket = open()
    when basket.add("Dune")
    then true
  }
}`);
    const receiver = source.checker.typeOf(source.call().id);

    expect(source.checker.calledOperation(source.call(1).id, () => receiver).value)
      .toBe(source.operation('add').id);
    expect(source.checker.checkCall(source.call(1).id, () => receiver)).toEqual({ problems: [], deferred: [] });
  });

  it('retains an unresolved operation without accepting a supplied value as its declaration', () => {
    const source = read('examples { example "missing": missing() => 1 }');

    const selected = source.checker.calledOperation(source.call().id, () => known(source.number));

    expect(selected.value).toBeUndefined();
    expect(selected.problems[0]).toBe(source.resolution.problems[0]);
  });

  it('rejects a noncall expression at the expression itself', () => {
    const source = read('examples { example "number": 8 => 8 }');
    const actual = [...source.catalog.inspection.query('example')][0]!.actual;

    expect(source.checker.calledOperation(actual.id).problems)
      .toContainEqual(expect.objectContaining({ code: 'invalid-purpose', at: actual.origin }));
  });
});

describe('a caller applies ordered value availability to direct callees', () => {
  it('reports a captured name as unavailable before introduction', () => {
    const source = read(`examples {
  action quantity() returns Number
  scenario "not yet available" {
    when count()
    when count = quantity()
    then true
  }
}`);

    expect(source.checker.calledOperation(source.call().id).problems)
      .toContainEqual(expect.objectContaining({ code: 'unavailable-value' }));
    expect(source.checker.checkCall(source.call().id).problems)
      .toContainEqual(expect.objectContaining({ code: 'unavailable-value' }));
  });

  it('rejects an available captured value as non-callable without changing its earlier answer', () => {
    const source = capturedCall();
    const unavailable = source.checker.calledOperation(source.call(1).id);
    const snapshot = structuredClone(unavailable);

    const selected = source.checker.calledOperation(source.call(1).id, () => known(source.number));

    expect(selected.value).toBeUndefined();
    expect(selected.problems).toContainEqual(expect.objectContaining({ code: 'invalid-purpose' }));
    expect(selected.deferred).toEqual([]);
    expect(source.checker.checkCall(source.call(1).id, () => known(source.number)).problems)
      .toContainEqual(expect.objectContaining({ code: 'invalid-purpose' }));
    expect(unavailable).toEqual(snapshot);
  });

  it('retains failed producer causes and an independent bad argument', () => {
    const source = read(`examples {
  action quantity(seed: Number)
  scenario "failed producer" {
    when count = quantity("many")
    when count(missing)
    then true
  }
}`);
    const producer = source.checker.typeOf(source.call().id);

    const selected = source.checker.calledOperation(source.call(1).id, () => producer);
    const checked = source.checker.checkCall(source.call(1).id, () => producer);

    expect(selected.value).toBeUndefined();
    expect(selected.problems[0]).toBe(producer.problems[0]);
    expect(selected.deferred[0]).toBe(producer.deferred[0]);
    expect(checked.problems).toContain(producer.problems[0]);
    expect(checked.problems).toContain(source.resolution.problems[0]);
    expect(checked.deferred).toContain(producer.deferred[0]);
  });
});

describe('a caller queries operations using handles from its inspection', () => {
  it('rejects a foreign call handle', () => {
    const source = read('function quantity() returns Number');
    const foreign = read('function other() returns Number\nexamples { example "other": other() => 1 }').call();

    expect(() => source.checker.calledOperation(foreign.id))
      .toThrow(expect.objectContaining({ code: 'foreign-node', nodeId: foreign.id }));
  });

  it('rejects a declaration where an expression was requested', () => {
    const source = read('function quantity() returns Number');
    const declaration = source.operation('quantity');

    expect(() => source.checker.calledOperation(declaration.id))
      .toThrow(expect.objectContaining({ code: 'unexpected-kind', nodeId: declaration.id }));
  });
});

function capturedCall() {
  return read(`examples {
  action quantity() returns Number
  scenario "not callable" {
    when count = quantity()
    when count()
    then true
  }
}`);
}
function read(text: string) {
  const parsed = new LangiumReader().read({ sourceId: 'called-operation.expec', text });
  if (parsed.status !== 'accepted') throw new Error(JSON.stringify(parsed.diagnostics));
  const resolution = new Resolver().resolve(new LangiumModel('called-operation.expec', parsed.document), { modules: [], packages: [] });
  const catalog = new TypeDescriber().describe(resolution);
  const number = catalog.declaredType([...catalog.inspection.query('builtin-type')].find(type => type.name === 'Number')!.id);
  return { catalog, resolution, number, checker: new ExpressionChecker(catalog),
    call: (index = 0) => [...catalog.inspection.query('call-expression')][index]!,
    operation: (name: string) => [...catalog.callableDeclarations()].map(id => catalog.inspection.read(id))
      .find(declaration => 'name' in declaration && declaration.name === name)!,
  };
}
function known<T>(value: T): Check<T> { return { value, problems: [], deferred: [] }; }
