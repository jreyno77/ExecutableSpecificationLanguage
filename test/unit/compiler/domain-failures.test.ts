import { describe, expect, it } from 'vitest';
import { Compiler, ExternalInputError, ExternalModel, ExpressionChecker, FixtureChecker, InteractionChecker, LangiumModel, LangiumReader,
  Resolver, TestOperationChecker, TypeDescriber, TypeQueryError, type TypeFact, type TypeId } from '../../../src/index.js';

describe('domain failure type facts', () => {
  it('retains invalid failure facts when checking a declared communication independently', () => {
    const language = read('error type Rejected { code: Text }\ninterface Store { public save\ncapability save() returns Nothing fails with Rejected }\ninteraction "save"() {\nparticipant store: Store\nmessage store -> store.save()\n}');
    const checker = new InteractionChecker(language.types, new ExpressionChecker(language.types));
    const message = [...language.types.inspection.query('message')][0]!;
    const checked = checker.message(message.id);
    expect(checked.value).toBeUndefined();
    expect(checked.problems.some(problem => problem.code === 'invalid-error-code')).toBe(true);
  });
  it('retains deferred failure facts when checking a declared communication independently', () => {
    const language = read('include "later"\ninterface Store { public save\ncapability save() returns Nothing fails with Later }\ninteraction "save"() {\nparticipant store: Store\nmessage store -> store.save()\n}');
    const checker = new InteractionChecker(language.types, new ExpressionChecker(language.types));
    const checked = checker.message([...language.types.inspection.query('message')][0]!.id);
    expect(checked.value).toBeUndefined();
    expect(checked.deferred.some(requirement => requirement.reason === 'composition')).toBe(true);
  });

  it('does not specialize an open code parameter into a valid closed code family', () => {
    const language = read('error type Rejected<T> { code: T }\nfunction accept() returns Nothing fails with Rejected<"rejected">');
    expect(language.error('Rejected').status).toBe('invalid');
    expect(language.types.error(known(language.types.typeOf(language.operation('accept').failures[0]!.id))).status).toBe('invalid');
    expect(language.types.callable(language.operation('accept').id).failures[0]!.status).toBe('invalid');
  });
  it('requires a nonoptional code even when a value is supplied elsewhere', () => {
    expect(read('error type Rejected { code: "rejected"? }').error('Rejected').status).toBe('invalid');
  });
  it('rejects blank code text at its authored literal', () => {
    const language = read('error type Rejected { code: "   " }');
    const error = language.error('Rejected');
    expect(error.status).toBe('invalid');
    if (error.status === 'invalid') expect(error.problems.map(problem => language.textAt(problem.at))).toEqual(['"   "']);
  });
  it('rejects numeric code data', () => {
    expect(read('error type Rejected { code: 7 }').error('Rejected').status).toBe('invalid');
  });
  it('retains an unresolved code alias instead of reporting an invented closed set', () => {
    const language = read('type Code = Missing\nerror type Rejected { code: Code }');
    const error = language.error('Rejected');
    expect(error.status).toBe('invalid');
    if (error.status === 'invalid') expect(error.problems.map(problem => [problem.code, language.textAt(problem.at)])).toContainEqual(['unresolved-reference', 'Missing']);
  });
  it('retains a cyclic alias cause without recursively expanding error fields', () => {
    const error = read('type Code = Other\ntype Other = Code\nerror type Rejected { code: Code }').error('Rejected');
    expect(error.status).toBe('invalid');
    if (error.status === 'invalid') expect(error.problems.some(problem => problem.code === 'circular-alias')).toBe(true);
  });
  it('rejects equivalent generic failures through both family and argument aliases', () => {
    const language = read('type Title = Text\nerror type Rejected<T> { code: "rejected"\nvalue: T }\ntype Alias = Rejected<Title>\nfunction accept() returns Nothing fails with Rejected<Text>, Alias');
    const failures = language.types.callable(language.operation('accept').id).failures;
    expect(failures.map(fact => fact.status)).toEqual(['known', 'invalid']);
    if (failures[1]!.status === 'invalid') expect(failures[1]!.problems.map(problem => [problem.code, language.textAt(problem.at)])).toEqual([['duplicate-failure', 'Alias']]);
  });
  it('keeps code aliases and authored fields in order', () => {
    const language = read('type Code = ("b" | "a")\nerror type Rejected { code: Code\nz: Text\na: Number }');
    const error = known(language.error('Rejected'));
    expect(error.codes).toEqual(['b', 'a']);
    expect(error.fields.map(slot => language.types.inspection.read(slot.declaration, 'field').name)).toEqual(['code', 'z', 'a']);
  });
  it('does not change an earlier error report when another family is queried', () => {
    const language = read('error type First { code: "first" }\nerror type Second { code: Text }');
    const report = language.error('First'), before = JSON.stringify(report), findings = JSON.stringify(language.types.problems);
    language.error('Second');
    expect(language.error('First')).toEqual(report);
    expect(JSON.stringify(report)).toBe(before);
    expect(JSON.stringify(language.types.problems)).toBe(findings);
  });
  it('rejects a wrong or foreign type handle with the established query errors', () => {
    const language = read('type Ordinary { value: Text }'), foreign = read('error type Rejected { code: "rejected" }');
    expect(() => language.error('Ordinary')).toThrow(expect.objectContaining({ code: 'wrong-kind' }));
    expect(() => language.types.error(foreign.type('Rejected'))).toThrow(TypeQueryError);
    expect(() => language.types.error({} as TypeId)).toThrow(expect.objectContaining({ code: 'unknown-type' }));
  });
  it('retains failure prerequisites when a contract or call is checked independently', () => {
    const language = read('error type Rejected { code: Text }\nfunction act() returns Number fails with Rejected\nexamples { example "call": act() => 1 }');
    const expressions = new ExpressionChecker(language.types);
    expect(expressions.checkContract(language.operation('act').id).problems.some(problem => problem.code === 'invalid-error-code')).toBe(true);
    const call = [...language.types.inspection.query('call-expression')][0]!;
    expect(expressions.typeOf(call.id).problems.some(problem => problem.code === 'invalid-error-code')).toBe(true);
  });
  it('retains failure prerequisites in the standalone test-operation checker', () => {
    const language = read('error type Rejected { code: Text }\nexamples { action act() returns Nothing fails with Rejected {} }');
    const expressions = new ExpressionChecker(language.types);
    const checker = new TestOperationChecker(language.types, expressions, new FixtureChecker(language.types, expressions));
    expect(checker.check(language.operation('act').id).problems.some(problem => problem.code === 'invalid-error-code')).toBe(true);
  });
  it('retains a deferred failure when an otherwise valid standalone helper is checked', () => {
    const language = read('include "later"\nexamples { action act() returns Nothing fails with Later {} }');
    const expressions = new ExpressionChecker(language.types);
    const checker = new TestOperationChecker(language.types, expressions, new FixtureChecker(language.types, expressions));
    expect(checker.check(language.operation('act').id).deferred.some(requirement => requirement.reason === 'composition')).toBe(true);
  });
});
describe('domain failure source and metadata', () => {
  it('keeps supplied optional and union failure forms visible until semantic checking', () => {
    const model = new ExternalModel('external', [
      { kind: 'record-type', name: 'Rejected', error: true, fields: [
        { kind: 'field', name: 'code', type: { kind: 'literal', value: { kind: 'text', value: 'rejected' } } },
      ] },
      { kind: 'function', name: 'act', parameters: [], failures: [
        { kind: 'optional', inner: { kind: 'named', path: ['Rejected'] } },
        { kind: 'union', alternatives: [{ kind: 'named', path: ['Rejected'] }, { kind: 'builtin', name: 'Text' }] },
      ] },
    ]);
    const resolution = new Resolver().resolve(model, { modules: [], packages: [] });
    const types = new TypeDescriber().describe(resolution);
    const operation = [...types.inspection.query('function')][0]!;
    expect(operation.failures.map(type => type.kind)).toEqual(['optional-type', 'union-type']);
    expect(types.callable(operation.id).failures.map(fact => fact.status)).toEqual(['invalid', 'invalid']);
    expect(types.problems).toEqual([
      expect.objectContaining({ code: 'invalid-failure-type', at: { kind: 'external', module: 'external', path: [1, 'failures', 0] } }),
      expect.objectContaining({ code: 'invalid-failure-type', at: { kind: 'external', module: 'external', path: [1, 'failures', 1] } }),
    ]);
    const result = new Compiler().compile({ resolution });
    expect(result.value).toBeUndefined();
    expect(result.problems.map(problem => problem.code)).toEqual(['invalid-failure-type', 'invalid-failure-type']);
  });

  it('keeps the new words usable as ordinary names', () => {
    const language = read('type error { fails: Text\nwith: Number }\nfunction fails(with: error) returns error');
    expect(language.types.problems).toEqual([]);
    expect(language.types.inspection.read(language.typeNode('error'), 'record-type-declaration').error).toBe(false);
    expect(language.operation('fails').failures).toEqual([]);
  });
  it('reads a declared failure on every existing callable role', () => {
    const language = read('error type Rejected { code: "rejected" }\nfunction fn() fails with Rejected\nconcept Store { capability save() fails with Rejected }\nexamples { setup arrange() fails with Rejected\naction act() fails with Rejected\nobservation see() fails with Rejected\ncheck verify() fails with Rejected }');
    expect([...language.types.callableDeclarations()].map(id => language.types.callable(id).failures.map(fact => fact.status)))
      .toEqual([['known'], ['known'], ['known'], ['known'], ['known'], ['known']]);
  });
  it('rejects an empty failure clause', () => {
    expect(new LangiumReader().read({ sourceId: 'entry', text: 'function act() fails with' }).status).toBe('rejected');
  });
  it('rejects a repeated failure clause', () => {
    expect(new LangiumReader().read({ sourceId: 'entry', text: 'function act() fails with One fails with Two' }).status).toBe('rejected');
  });
  it('rejects an error modifier on an alias', () => {
    expect(new LangiumReader().read({ sourceId: 'entry', text: 'error type Rejected = Text' }).status).toBe('rejected');
  });
  it('validates external error flags rather than coercing them', () => {
    expect(() => new ExternalModel('external', [{ kind: 'record-type', name: 'Rejected', error: 'yes', fields: [] }] as never)).toThrow(ExternalInputError);
  });
  it('validates an external failure collection at the input boundary', () => {
    expect(() => new ExternalModel('external', [{ kind: 'function', name: 'act', parameters: [], failures: {} }] as never)).toThrow(ExternalInputError);
  });
  it('checks external code meaning without inventing source origins', () => {
    const model = new ExternalModel('external', [{ kind: 'record-type', name: 'Rejected', error: true,
      fields: [{ kind: 'field', name: 'code', type: { kind: 'builtin', name: 'Text' } }] }]);
    const types = new TypeDescriber().describe(new Resolver().resolve(model, { modules: [], packages: [] }));
    expect(types.problems).toEqual([expect.objectContaining({ code: 'invalid-error-code', at: { kind: 'external', module: 'external', path: [0, 'fields', 0, 'type'] } })]);
  });
});

function read(text: string) {
  const read = new LangiumReader().read({ sourceId: 'entry', text });
  if (read.status !== 'accepted') throw new Error(JSON.stringify(read.diagnostics));
  const resolution = new Resolver().resolve(new LangiumModel('entry', read.document), { modules: [], packages: [] });
  const types = new TypeDescriber().describe(resolution);
  const typeNode = (name: string) => [...types.typeDeclarations()].find(id => (types.inspection.read(id) as { name: string }).name === name)!;
  return { types, typeNode, type: (name: string) => types.declaredType(typeNode(name)), error: (name: string) => types.error(types.declaredType(typeNode(name))),
    operation: (name: string) => {
      const id = [...types.callableDeclarations()].find(id => (types.inspection.read(id) as { name: string }).name === name)!;
      const node = types.inspection.read(id);
      if (!('failures' in node)) throw new Error('Expected callable'); return node;
    },
    textAt: (at: import('../../../src/index.js').ProblemLocation) => at.kind === 'source'
      ? Array.from(text).slice(at.range.start.offset, at.range.end.offset).join('') : JSON.stringify(at) };
}
function known<T>(fact: TypeFact<T>): T { if (fact.status !== 'known') throw new Error(JSON.stringify(fact)); return fact.value; }
