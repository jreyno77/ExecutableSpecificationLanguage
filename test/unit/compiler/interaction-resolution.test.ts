import { describe, expect, it } from 'vitest';
import { ExpressionChecker, LangiumModel, LangiumReader, QueryInspection, Resolver, TypeDescriber } from '../../../src/index.js';

describe('interaction values retain their ordinary names', () => {
  it('binds an input named result in a message argument', () => {
    const { inspection, references } = resolve(`interface Storage {
  public persist
  capability persist(count: Number) returns Nothing
}
interaction "ordinary input"(result: Number) {
  participant storage: Storage
  message storage -> storage.persist(result)
}`);
    const parameter = [...inspection.query('interaction')][0]!.parameters[0]!;

    expect(references[0]!.resolution).toEqual({ status: 'bound', target: parameter.id });
  });

  it('binds a participant named result as a value while deferring endpoint selection', () => {
    const { inspection, references } = resolve(`component Screen {}
interface Storage {
  public connect
  capability connect(screen: Screen) returns Nothing
}
interaction "ordinary participant"() {
  participant result: Screen
  participant storage: Storage
  message result -> storage.connect(result)
}`);
    const participant = [...inspection.query('participant')].find(node => node.name === 'result')!;
    const message = [...inspection.query('message')][0]!;

    expect(references[0]!.resolution).toEqual({ status: 'bound', target: participant.id });
    expect(message.sender.resolution).toMatchObject({ status: 'deferred', requirement: { reason: 'interaction' } });
  });

  it('leaves reply availability to ordered checking before and after capture', () => {
    const { references } = resolve(`interface Storage {
  public persist, confirm
  capability persist() returns Text
  capability confirm(receipt: Text) returns Nothing
}
interaction "ordered reply"() {
  participant storage: Storage
  message storage -> storage.confirm(result)
  message storage -> storage.persist() as result
  message storage -> storage.confirm(result)
}`);

    expect(references.map(reference => reference.resolution)).toEqual([
      expect.objectContaining({ status: 'deferred', requirement: expect.objectContaining({ reason: 'ordered-scope' }) }),
      expect.objectContaining({ status: 'deferred', requirement: expect.objectContaining({ reason: 'ordered-scope' }) }),
    ]);
  });

  it('reports an undeclared result at its message argument', () => {
    const { references, problems } = resolve(`interface Storage {
  public persist
  capability persist(count: Number) returns Nothing
}
interaction "missing input"() {
  participant storage: Storage
  message storage -> storage.persist(result)
}`);

    expect(references[0]!.resolution).toEqual({ status: 'invalid', problems: [problems[0]] });
    expect(problems).toEqual([expect.objectContaining({ code: 'unresolved-reference', at: references[0]!.origin })]);
  });

  it('does not import a result capture from another interaction', () => {
    const { references, problems } = resolve(`interface Storage {
  public persist, confirm
  capability persist() returns Text
  capability confirm(receipt: Text) returns Nothing
}
interaction "save"() {
  participant storage: Storage
  message storage -> storage.persist() as result
}
interaction "separate confirmation"() {
  participant storage: Storage
  message storage -> storage.confirm(result)
}`);

    expect(references[0]!.resolution).toEqual({ status: 'invalid', problems: [problems[0]] });
    expect(problems).toEqual([expect.objectContaining({ code: 'unresolved-reference', at: references[0]!.origin })]);
  });

  it('uses an earlier result parameter in an interaction input default', () => {
    const source = resolve('interaction "earlier input"(result: Number = 1, count: Number = result) {}');
    const catalog = new TypeDescriber().describe(source.resolution);
    const parameter = [...source.inspection.query('interaction')][0]!.parameters[1]!;

    expect(new ExpressionChecker(catalog).checkDefault(parameter.id)).toEqual({ problems: [], deferred: [] });
  });

  it('keeps a later result parameter unavailable to an earlier input default', () => {
    const source = resolve('interaction "later input"(count: Number = result, result: Number = 1) {}');
    const catalog = new TypeDescriber().describe(source.resolution);
    const parameter = [...source.inspection.query('interaction')][0]!.parameters[0]!;

    expect(new ExpressionChecker(catalog).checkDefault(parameter.id).problems)
      .toContainEqual(expect.objectContaining({ code: 'unavailable-value', at: source.references[0]!.origin }));
  });
});

function resolve(text: string) {
  const read = new LangiumReader().read({ sourceId: 'interactions.expec', text });
  if (read.status !== 'accepted') throw new Error(JSON.stringify(read.diagnostics));
  const resolution = new Resolver().resolve(new LangiumModel('interactions.expec', read.document), { modules: [], packages: [] });
  const inspection = new QueryInspection(resolution.model);
  return { resolution, inspection, problems: resolution.problems,
    references: [...inspection.query('name-expression')].map(node => node.reference) };
}
