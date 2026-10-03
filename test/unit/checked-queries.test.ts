import { describe, expect, it, vi } from 'vitest';
import {
  Compiler, ExpressionChecker, LangiumModel, LangiumReader, Resolver, ScenarioChecker,
  type Compilation, type Model, type ModelNode, type NodeId, type Specification,
} from '../../src/index.js';

const dependencies = { modules: [], packages: [] };
function compile(text: string): Compilation {
  return new Compiler().compile({ locator: 'game', source: { sourceId: 'game.expec', text }, dependencies });
}
function checked(text: string): Specification {
  const result = compile(text);
  expect(result.syntax).toEqual([]); expect(result.problems).toEqual([]); expect(result.deferred).toEqual([]);
  expect(result.value).toBeDefined();
  return result.value!;
}
function selected(spec: Specification, index: number, operation: string): void {
  const call = [...spec.inspection.query('call-expression')][index]!;
  const expected = [...spec.types.callableDeclarations()].find(id => {
    const node = spec.inspection.read(id);
    return 'name' in node && node.name === operation;
  });
  expect(expected).toBeDefined();
  expect(spec.call(call.id).value).toBe(expected);
  expect(spec.call(call.id).problems).toEqual([]); expect(spec.call(call.id).deferred).toEqual([]);
}

describe('checked call facts retain their original context', () => {
  it('keeps both Boolean operands even when runtime short circuit could skip one', () => {
    const spec = checked(`function left() returns Boolean
function right() returns Boolean
examples { example "condition": left() and right() => true }`);
    selected(spec, 0, 'left');
    selected(spec, 1, 'right');
  });

  it('retains a computed receiver under grouping', () => {
    const spec = checked(`concept Basket {
  public count
  capability count() returns Number
}
function open() returns Basket
examples { example "count": (open()).count() => 1 }`);
    const calls = [...spec.inspection.query('call-expression')];
    expect(calls).toHaveLength(2);
    const operations = calls.map(call => spec.call(call.id).value);
    expect(operations).toContain([...spec.inspection.query('function')][0]!.id);
    expect(operations).toContain([...spec.inspection.query('capability')][0]!.id);
  });

  it('retains a call in an interaction default with its earlier parameter in scope', () => {
    const spec = checked(`function next(count: Number) returns Number
interaction "defaults"(first: Number, second: Number = next(first)) {}`);
    selected(spec, 0, 'next');
  });

  it('retains distinct calls in chained parameter defaults', () => {
    const spec = checked(`function next(count: Number) returns Number
function save(first: Number, second: Number = next(first), third: Number = next(second)) returns Nothing`);
    selected(spec, 0, 'next');
    selected(spec, 1, 'next');
    const calls = [...spec.inspection.query('call-expression')];
    expect(calls[0]!.id).not.toBe(calls[1]!.id);
  });

  it('does not publish a selected operation when its argument and result are invalid', () => {
    const report = compile(`function count(seed: Number) returns Missing
examples { example "count": count("many") => 1 }`);
    expect(report.syntax).toEqual([]); expect(report.value).toBeUndefined();
    expect(report.problems.map(problem => problem.code)).toEqual(expect.arrayContaining(['incompatible-type', 'unresolved-reference']));
  });

  it('reports conflicting selections instead of replacing an earlier operation', () => {
    const original = ExpressionChecker.prototype.calledOperation;
    let attempts = 0;
    const selection = vi.spyOn(ExpressionChecker.prototype, 'calledOperation').mockImplementation(function (this: ExpressionChecker, call, scope) {
      const result = original.call(this, call, scope);
      if (!result.value || ++attempts !== 2) return result;
      // A controlled lower-boundary inconsistency must not become a trusted public answer.
      return { ...result, value: alternative! };
    });
    const text = `function first() returns Nothing
function second() returns Nothing
examples { scenario "save" {
  when first()
  then true
} }`;
    const read = new LangiumReader().read({ sourceId: 'conflict.expec', text });
    if (read.status !== 'accepted') throw new Error(JSON.stringify(read.diagnostics));
    const resolution = new Resolver().resolve(new LangiumModel('conflict', read.document), dependencies);
    const alternative = resolution.model.nodes('function').find(node => resolution.model.node(node.name, 'name').decoded === 'second')!.id;
    try {
      const report = new Compiler().compile({ resolution });
      expect(attempts).toBe(2);
      expect(report.value).toBeUndefined();
      const problem = report.problems.find(problem => problem.code === 'ambiguous-reference');
      expect(problem?.at).toBe(resolution.model.nodes('call-expression')[0]!.origin);
      expect(problem?.related).toEqual(resolution.model.nodes('function').map(node => node.origin));
    } finally { selection.mockRestore(); }
  });
  it('keeps a no-value result invalid when the scenario tries to capture it', () => {
    const report = compile(`function save() returns Nothing
examples { scenario "save" {
  when result = save()
  then true
} }`);
    expect(report.syntax).toEqual([]); expect(report.value).toBeUndefined();
    expect(report.problems.map(problem => problem.code)).toContain('invalid-purpose');
  });
});

describe('scenario facts preserve capture identities and snapshots', () => {
  it('preserves the declared alias TypeId in a captured value', () => {
    const spec = checked(`type Count = Number
function count() returns Count
examples { scenario "count" {
  when result = count()
  then result == 1
} }`);
    const steps = [...spec.inspection.query('scenario')][0]!.steps;
    const expected = spec.types.declaredType([...spec.inspection.query('alias-type-declaration')][0]!.id);
    expect(spec.step(steps[0]!.id).value?.capture?.type).toBe(expected);
    expect(spec.step(steps[1]!.id).value?.available[0]?.type).toBe(expected);
    expect(spec.types.describe(expected).kind).toBe('alias');
  });

  it('isolates mutation of the introduced capture as well as available values', () => {
    const spec = checked(`function count() returns Number
examples { scenario "count" {
  when result = count()
  then result == 1
} }`);
    const steps = [...spec.inspection.query('scenario')][0]!.steps;
    const first = spec.step(steps[0]!.id), other = spec.step(steps[0]!.id);
    expect(first.value?.capture).toBeDefined();
    const name = first.value!.capture!.name, type = first.value!.capture!.type;
    try { (other.value!.capture as { name: object }).name = {}; } catch (error) { expect(error).toBeInstanceOf(TypeError); }
    try { (other.value!.capture as { type: object }).type = {}; } catch (error) { expect(error).toBeInstanceOf(TypeError); }
    expect(first.value!.capture!.name).toBe(name); expect(first.value!.capture!.type).toBe(type);
    expect(spec.step(steps[0]!.id).value!.capture!.name).toBe(name);
    expect(spec.step(steps[1]!.id).value!.available[0]!.type).toBe(type);
  });

  it('answers queries without rerunning expression or scenario checks', () => {
    const spec = checked(`function count() returns Number
examples { scenario "count" {
  when result = count()
  then result == 1
} }`);
    const spies = [vi.spyOn(ExpressionChecker.prototype, 'calledOperation'), vi.spyOn(ExpressionChecker.prototype, 'typeOf'),
      vi.spyOn(ExpressionChecker.prototype, 'checkCall'), vi.spyOn(ScenarioChecker.prototype, 'check')];
    for (const spy of spies) spy.mockImplementation(() => { throw new Error('A query reran checking'); });
    try {
      selected(spec, 0, 'count');
      for (const step of [...spec.inspection.query('scenario')][0]!.steps) expect(spec.step(step.id).value).toBeDefined();
    } finally { for (const spy of spies) spy.mockRestore(); }
  });
});

describe('query misuse is distinct from unchecked executable content', () => {
  it('uses missing-node for a fabricated handle', () => {
    const spec = checked('opaque type Token');
    expect(() => spec.call({} as NodeId)).toThrow(expect.objectContaining({ code: 'missing-node' }));
    expect(() => spec.step({} as NodeId)).toThrow(expect.objectContaining({ code: 'missing-node' }));
  });

  it('does not infer checked call or step facts from supplied external executable content', () => {
    const read = new LangiumReader().read({ sourceId: 'external.expec', text: `function save() returns Nothing
examples { scenario "save" {
  when save()
  then true
} }` });
    if (read.status !== 'accepted') throw new Error(JSON.stringify(read.diagnostics));
    const resolution = new Resolver().resolve(new LangiumModel('external', read.document), dependencies);
    const external = (node: ModelNode): ModelNode => ({ ...node, origin: { kind: 'external', module: 'external', path: [node.kind] } });
    const model: Model = new Proxy(resolution.model, { get(target, key) {
      if (key === 'node') return (id: NodeId) => external(target.node(id));
      if (key === 'nodes') return (kind: Parameters<Model['nodes']>[0]) => target.nodes(kind).map(external);
      const member = Reflect.get(target, key);
      return typeof member === 'function' ? member.bind(target) : member;
    } });
    const report = new Compiler().compile({ resolution: { ...resolution, model } });
    expect(report.problems).toEqual([]); expect(report.deferred).toEqual([]); expect(report.value).toBeDefined();
    const spec = report.value!;
    expect(() => spec.call([...spec.inspection.query('call-expression')][0]!.id)).toThrow(expect.objectContaining({ code: 'not-analyzed' }));
    expect(() => spec.step([...spec.inspection.query('when')][0]!.id)).toThrow(expect.objectContaining({ code: 'not-analyzed' }));
  });
});
