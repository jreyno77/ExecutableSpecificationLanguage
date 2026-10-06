import { describe, expect, it } from 'vitest';
import { ExpressionChecker, FixtureChecker, LangiumModel, LangiumReader, QueryError, Resolver, TestOperationChecker, TypeDescriber,
  createNodeId, type ModelNode, type ModuleModel, type NodeId } from '../../../src/index.js';

describe('test operation checking stays local to its contract', () => {
  it('keeps equal local names and earlier reports independent across repeated and reversed checks', () => {
    const operations = read('examples {\nobservation title() returns Text {\nlet result = "Dune"\nreturn result\n}\nobservation copies() returns Number {\nlet result = 1\nreturn result\n}\n}');
    const before = operations.references(), first = operations.check('title');
    expect(operations.check('copies')).toEqual({ problems: [], deferred: [] });
    expect(operations.check('title')).toEqual(first);
    expect(first).toEqual({ problems: [], deferred: [] });
    expect(operations.references()).toEqual(before);
  });

  it('keeps invalid local data separate from a later body using the same local name', () => {
    const operations = read('examples {\nobservation bad() returns Number {\nlet count = missing\nreturn count\n}\nobservation good() returns Number {\nlet count = 1\nreturn count\n}\n}');
    const first = operations.check('bad'), saved = JSON.stringify(first);
    expect(first.problems.map(problem => problem.code)).toContain('unresolved-reference');
    expect(operations.check('good')).toEqual({ problems: [], deferred: [] });
    expect(JSON.stringify(first)).toBe(saved);
    expect(operations.check('bad')).toEqual(first);
  });

  it('uses a declared record result as the context for nested returned data', () => {
    const operations = read('type Book { title: Text }\ntype Box { book: Book }\nexamples { observation book() returns Box { return { book: { title: "Dune" } } } }');
    expect(operations.check('book')).toEqual({ problems: [], deferred: [] });
  });

  it('retains an invalid signature and an independent invalid body expression', () => {
    const operations = read('examples { observation number() returns Missing { return absent } }');
    const checked = operations.check('number');
    expect(checked.problems.map(problem => operations.text(problem.at))).toEqual(expect.arrayContaining(['Missing', 'absent']));
    expect(checked.problems.every(problem => problem.code === 'unresolved-reference')).toBe(true);
  });

  it('does not recursively expand calls to another operation body', () => {
    const operations = read('examples {\nobservation first() returns Number { return second() }\nobservation second() returns Number { return first() }\n}');
    expect(operations.check('first')).toEqual({ problems: [], deferred: [] });
    expect(operations.check('second')).toEqual({ problems: [], deferred: [] });
  });

  it('checks a second return independently while retaining its unreachable location', () => {
    const operations = read('examples { observation number() returns Number {\nreturn 1\nreturn "many"\n} }');
    const checked = operations.check('number');
    expect(checked.problems.map(problem => [problem.code, operations.text(problem.at)])).toEqual([
      ['unreachable-statement', 'return "many"'], ['incompatible-type', '"many"'],
    ]);
    expect(checked.problems[0]!.related.map(at => operations.text(at))).toEqual(['return 1']);
  });

  it('keeps a failed initializer unavailable even when a later return expects a type', () => {
    const operations = read('examples { observation number() returns Number {\nlet value = []\nreturn value\n} }');
    const checked = operations.check('number');
    expect(checked.deferred.map(requirement => requirement.reason)).toContain('expected-type');
    expect(checked.problems).toEqual([]);
  });

  it('ends local availability at the first return even when its value is invalid', () => {
    const operations = read('function consume(value: Number) returns Nothing\nexamples { observation number() returns Number {\nreturn "many"\nlet later = 1\ndo consume(later)\n} }');
    const checked = operations.check('number');
    expect(checked.problems.map(problem => [problem.code, operations.text(problem.at)])).toEqual(expect.arrayContaining([
      ['incompatible-type', '"many"'], ['unreachable-statement', 'let later = 1'], ['unreachable-statement', 'do consume(later)'], ['unavailable-value', 'later'],
    ]));
    expect(checked.problems.some(problem => problem.code === 'missing-return')).toBe(false);
  });

  it('retains composition needed by the result and an independently invalid operator', () => {
    const operations = read('include "later"\nexamples { observation number() returns AddedLater { return "many" - 1 } }');
    const checked = operations.check('number');
    expect(checked.deferred.map(requirement => requirement.reason)).toContain('composition');
    expect(checked.problems.map(problem => problem.code)).toContain('invalid-operator');
  });

  it('accepts an authored Boolean assertion without claiming to execute it', () => {
    expect(read('examples { check explicitExpectation() { assert true } }').check('explicitExpectation')).toEqual({ problems: [], deferred: [] });
  });

  it('keeps result parameters and fixtures ordinary inside a test body', () => {
    const operations = read('examples {\nfixture result: Number = 1\nobservation parameter(result: Text) returns Text { return result }\nobservation fixtureValue() returns Number { return result }\n}');
    expect(operations.check('parameter')).toEqual({ problems: [], deferred: [] });
    expect(operations.check('fixtureValue')).toEqual({ problems: [], deferred: [] });
    expect(operations.references().some(reference => reference.status === 'deferred' && reference.requirement.reason === 'contextual-result')).toBe(false);
  });

  it('reports unavailable supplied body metadata without pretending it is bodyless', () => {
    const source = module('examples { action save() returns Nothing }'), operation = source.nodes('action')[0]!;
    const replace = (node: ModelNode): ModelNode => node.id === operation.id ? { ...operation, body: { kind: 'unavailable' },
      origin: { kind: 'external', module: 'entry', path: ['save'] } } : node;
    const supplied: ModuleModel = { locator: source.locator, roots: () => source.roots(), children: id => source.children(id),
      parent: id => source.parent(id), resolution: id => source.resolution(id),
      node: ((id: NodeId) => replace(source.node(id))) as ModuleModel['node'],
      nodes: (kind => source.nodes(kind).map(replace)) as ModuleModel['nodes'] };
    const operations = assemble(supplied), checked = operations.check('save');
    expect(checked.problems).toEqual([]);
    expect(checked.deferred).toEqual([expect.objectContaining({ reason: 'test-operation-body', origin: { kind: 'external', module: 'entry', path: ['save'] } })]);
  });

  it('rejects foreign, fabricated and wrong-kind handles through existing query errors', () => {
    const operations = read('type Book { title: Text }\nexamples { action save() {} }');
    const foreign = read('examples { action other() {} }');
    for (const id of [foreign.named('other'), createNodeId(), {} as NodeId]) {
      expect(() => operations.checker.check(id)).toThrow(QueryError);
    }
    expect(() => operations.checker.check(operations.types.inspection.query('record-type-declaration')[Symbol.iterator]().next().value!.id))
      .toThrow(expect.objectContaining({ code: 'unexpected-kind' }));
  });
});

function module(text: string): ModuleModel {
  const result = new LangiumReader().read({ sourceId: 'entry.expec', text });
  if (result.status !== 'accepted') throw new Error(JSON.stringify(result.diagnostics));
  return new LangiumModel('entry', result.document);
}
function read(text: string) { return assemble(module(text), text); }
function assemble(source: ModuleModel, text = '') {
  const resolution = new Resolver().resolve(source, { modules: [], packages: [] });
  const types = new TypeDescriber().describe(resolution), expressions = new ExpressionChecker(types);
  const checker = new TestOperationChecker(types, expressions, new FixtureChecker(types, expressions));
  const named = (name: string) => [...types.callableDeclarations()].find(id => {
    const node = types.inspection.read(id); return 'name' in node && node.name === name;
  })!;
  return { types, checker, named, check: (name: string) => checker.check(named(name)),
    references: () => [...types.inspection.query('reference')].map(reference => reference.resolution),
    text: (at: import('../../../src/index.js').ProblemLocation) => at.kind === 'source' ? Array.from(text).slice(at.range.start.offset, at.range.end.offset).join('') : '' };
}
