import { describe, expect, it } from 'vitest';
import { ExpressionChecker, InteractionChecker, LangiumModel, LangiumReader, Resolver, TypeDescriber } from '../../../src/index.js';

describe('interaction participants and scope', () => {
  it('retains a private result type error when checking a complete message', () => {
    const interaction = read(`component Storage {
  local type Receipt {}
  public persist
  capability persist(count: Number) returns Receipt
}
interaction "private result"() {
  participant storage: Storage
  message storage -> storage.persist(1)
}`);
    const checked = interaction.message(1);
    expect(checked.value).toBeUndefined();
    expect(checked.problems.map(problem => problem.code)).toContain('private-type-exposure');
  });

  it('rejects a record as a participant contract', () => {
    const interaction = read(`type Address { street: Text }
interaction "record participant"() {
  participant address: Address
}`);
    expect(interaction.check().problems.map(problem => problem.code)).toEqual(['invalid-participant']);
  });

  it('requires a single nonoptional participant contract', () => {
    const interaction = read(`interface Storage {}
interaction "optional participant"() {
  participant storage: Storage?
}`);
    expect(interaction.check().problems.map(problem => problem.code)).toEqual(['invalid-participant']);
  });

  it('retains an invalid argument when the sender is unavailable', () => {
    const interaction = read(`interface Storage {
  public persist
  capability persist(count: Number) returns Nothing
}
interaction "independent failures"() {
  participant storage: Storage
  message missing -> storage.persist("many")
}`);
    const result = interaction.message(1);
    expect(result.value).toBeUndefined();
    expect(result.problems.map(problem => problem.code)).toEqual(expect.arrayContaining(['invalid-participant', 'incompatible-type']));
  });

  it('does not promote a captured contract value into a participant', () => {
    const interaction = read(`interface Storage {
  public copy, persist
  capability copy() returns Storage
  capability persist() returns Nothing
}
interaction "reply is not a participant"() {
  participant storage: Storage
  message storage -> storage.copy() as copy
  message storage -> copy.persist()
}`);
    expect(interaction.message(2).problems.map(problem => problem.code)).toContain('invalid-participant');
  });

  it('finds a participant colliding with an input even without a message', () => {
    const interaction = read(`interface Storage {}
interaction "duplicate input"(storage: Storage) {
  participant storage: Storage
}`);
    expect(interaction.check().problems.map(problem => problem.code)).toContain('duplicate-declaration');
  });

  it('keeps a reply collision invalid when the participant appears later', () => {
    const interaction = read(`interface Storage {
  public copy
  capability copy() returns Storage
}
interaction "later participant collision"() {
  participant storage: Storage
  message storage -> storage.copy() as duplicate
  participant duplicate: Storage
}`);
    const result = interaction.message(1);
    expect(result.value).toBeUndefined();
    expect(result.problems.map(problem => problem.code)).toContain('duplicate-capture');
  });

  it('keeps a missing participant type as its original resolution problem', () => {
    const interaction = read(`interaction "missing contract"() {
  participant storage: MissingStorage
}`);
    expect(interaction.check().problems).toEqual(interaction.resolution.problems);
  });

  it('propagates a deferred producer to later reply uses', () => {
    const interaction = read(`interface Storage {
  public persist, confirm
  capability persist()
  capability confirm(receipt: Text) returns Nothing
}
interaction "unknown receipt"() {
  participant storage: Storage
  message storage -> storage.persist() as receipt
  message storage -> storage.confirm(receipt)
}`);
    const result = interaction.message(2);
    expect(result.value).toBeUndefined();
    expect(result.problems).toEqual([]);
    expect(result.deferred.map(requirement => requirement.reason)).toContain('declared-result');
  });

  it('leaves an invalid producer report unchanged when its reply is checked later', () => {
    const interaction = read(`interface Storage {
  public persist, confirm
  capability persist(count: Number) returns Text
  capability confirm(receipt: Text) returns Nothing
}
interaction "retained failure"() {
  participant storage: Storage
  message storage -> storage.persist("many") as receipt
  message storage -> storage.confirm(receipt)
}`);
    const producer = interaction.message(1), before = structuredClone(producer);
    expect(producer.problems.map(problem => problem.code)).toEqual(['incompatible-type']);

    const dependent = interaction.message(2);

    expect(producer).toEqual(before);
    expect(dependent.problems[0]?.code).toBe('incompatible-type');
    expect(dependent.problems[0]?.related).not.toEqual(producer.problems[0]?.related);
  });
});

function read(text: string) {
  const parsed = new LangiumReader().read({ sourceId: 'interaction.expec', text });
  if (parsed.status !== 'accepted') throw new Error(JSON.stringify(parsed.diagnostics));
  const resolution = new Resolver().resolve(new LangiumModel('interaction.expec', parsed.document), { modules: [], packages: [] });
  const types = new TypeDescriber().describe(resolution);
  const checker = new InteractionChecker(types, new ExpressionChecker(types));
  const interaction = [...types.inspection.query('interaction')][0]!;
  return {
    resolution,
    check: () => checker.check(interaction.id),
    message: (index: number) => checker.message(interaction.members.filter(member => member.kind === 'message')[index - 1]!.id),
  };
}
