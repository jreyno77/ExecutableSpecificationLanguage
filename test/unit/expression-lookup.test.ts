import { describe, expect, it } from 'vitest';
import { LangiumReader, LangiumModel, Resolver, TypeDescriber, ExternalModel, type ModuleModel, type TypeCatalog } from '../../src/index.js';
import { ExpressionLookup } from '../../src/compiler/expression-lookup.js';

describe('expression lookup respects actual availability and the resolved source', () => {
  it('keeps missing members incomplete when source composition can add them', () => {
    const { catalog, lookup } = read('include "more"\ntype Settings { count: Number }\nfunction consume(settings: Settings) {\n requires settings.extra > 0\n}');
    const owner = [...catalog.inspection.query('record-type-declaration')][0]!, at = [...catalog.inspection.query('member-expression')][0]!.member;
    const selected = lookup.member(owner, 'extra', at, catalog.declaredType(owner.id));
    expect(selected.problems).toEqual([]);
    expect(selected.deferred).toEqual([expect.objectContaining({ reason: 'composition', origin: at.origin })]);
  });

  it('respects a local field wrapper in an external record', () => {
    const dependency = new ExternalModel('external', [{ kind: 'record-type', name: 'Settings', fields: [
      { kind: 'field', name: 'secret', type: { kind: 'builtin', name: 'Number' }, local: true },
      { kind: 'field', name: 'count', type: { kind: 'builtin', name: 'Number' } },
    ] }]);
    const { catalog, lookup } = read('use Settings from "external"\nfunction consume(settings: Settings) {\n requires settings.secret > 0\n}', [dependency]);
    const owner = [...catalog.inspection.query('record-type-declaration')][0]!, at = [...catalog.inspection.query('member-expression')][0]!.member;
    const receiver = catalog.declaredType(owner.id);
    expect(lookup.member(owner, 'secret', at, receiver).problems.map(problem => problem.code)).toEqual(['invalid-member']);
    expect(lookup.member(owner, 'count', at, receiver).value?.type).toBe(builtin(catalog, 'Number'));
  });

  it('preserves composition requirements instead of satisfying them through a value scope', () => {
    const { catalog, lookup, references } = read('include "later"\nfunction count() {\n requires pending > 0\n}');
    const reference = references[0]!;
    if (reference.resolution.status !== 'deferred') throw new Error('Expected pending composition');
    const checked = lookup.value(reference, () => ({ value: builtin(catalog, 'Number'), problems: [], deferred: [] }));
    expect(checked.value).toBeUndefined();
    expect(checked.deferred[0]).toBe(reference.resolution.requirement);
  });

  it('does not introduce contextual result in a precondition through a value scope', () => {
    const { catalog, lookup, references } = read('function count() returns Number {\n requires result > 0\n}');
    const checked = lookup.value(references[0]!, () => ({ value: builtin(catalog, 'Number'), problems: [], deferred: [] }));
    expect(checked.value).toBeUndefined();
    expect(checked.problems.map(problem => problem.code)).toEqual(['unavailable-value']);
  });

  it('retains an ordinary parameter named result in a precondition', () => {
    const { catalog, lookup, references } = read('function count(result: Number) {\n requires result > 0\n}');
    const callable = [...catalog.inspection.query('function')][0]!;
    expect(lookup.value(references[0]!, lookup.parameters(callable)).value).toBe(builtin(catalog, 'Number'));
  });

  it('resolves an ordinary fixture named result before asking for its available value', () => {
    const { catalog, lookup, references } = read(`examples {
  fixture result: Number = 2
  fixture total: Number = result + 1
}`);
    const fixture = [...catalog.inspection.query('fixture')].find(node => node.name === 'result')!, reference = references[0]!;

    expect(reference.resolution).toEqual({ status: 'bound', target: fixture.id });
    expect(lookup.value(reference, use => use.resolution.status === 'bound' && use.resolution.target === fixture.id
      ? { value: builtin(catalog, 'Number'), problems: [], deferred: [] } : undefined))
      .toEqual({ value: builtin(catalog, 'Number'), problems: [], deferred: [] });
  });

  it('does not borrow a fixture named result from another examples block', () => {
    const { catalog, lookup, resolution, references } = read(`examples { fixture result: Number = 2 }
examples { fixture total: Number = result + 1 }`);

    expect(references[0]!.resolution.status).toBe('invalid');
    expect(lookup.value(references[0]!, () => ({ value: builtin(catalog, 'Number'), problems: [], deferred: [] })))
      .toEqual({ problems: [resolution.problems[0]], deferred: [] });
    expect(resolution.problems[0]).toMatchObject({ code: 'unresolved-reference', at: references[0]!.origin });
  });

  it('does not grant a later parameter named result to an earlier default', () => {
    const { catalog, lookup, references } = read('function count(first: Number = result, result: Number = 1)');
    expect(lookup.value(references[0]!, () => ({ value: builtin(catalog, 'Number'), problems: [], deferred: [] })).problems)
      .toContainEqual(expect.objectContaining({ code: 'unavailable-value', at: references[0]!.origin }));
  });

  it('keeps an unspecified contextual result incomplete', () => {
    const { lookup, references } = read('function count() {\n ensures result > 0\n}');
    const checked = lookup.value(references[0]!);
    expect(checked.value).toBeUndefined();
    expect(checked.problems).toEqual([]);
    expect(checked.deferred).toEqual([expect.objectContaining({ reason: 'declared-result', origin: references[0]!.origin })]);
  });

  it('rejects contextual result when the declared output aliases Nothing', () => {
    const { lookup, references } = read('type Void = Nothing\nfunction count() returns Void {\n ensures result > 0\n}');
    expect(lookup.value(references[0]!).problems.map(problem => problem.code)).toEqual(['unavailable-value']);
  });

  it('does not grant a sibling field to a default through a value scope', () => {
    const { catalog, lookup, references } = read('type Settings {\n count: Number\n brightness: Number = count\n}');
    expect(lookup.value(references[0]!, () => ({ value: builtin(catalog, 'Number'), problems: [], deferred: [] })).problems.map(problem => problem.code))
      .toEqual(['unavailable-value']);
  });

  it('makes only earlier parameters available to a default', () => {
    const { catalog, lookup, references } = read('function count(first: Number, second: Number = first)');
    const callable = [...catalog.inspection.query('function')][0]!;
    expect(lookup.value(references[0]!, lookup.parameters(callable, callable.parameters[1]!.id)).value).toBe(builtin(catalog, 'Number'));
  });

  it('keeps capabilities private unless the owner lists them as public', () => {
    const { catalog, lookup } = read('concept Store {\n public save\n capability save()\n capability hidden()\n}\nfunction consume(store: Store) {\n requires store.hidden()\n}');
    const owner = [...catalog.inspection.query('concept')][0]!, at = [...catalog.inspection.query('member-expression')][0]!.member;
    expect(lookup.member(owner, 'hidden', at).problems.map(problem => problem.code)).toEqual(['invalid-member']);
    expect(lookup.member(owner, 'save', at).value?.declaration.kind).toBe('capability');
  });

  it('allows a same-module attached example to inspect its subjects private capability', () => {
    const { catalog, lookup } = read('concept Store {\n capability hidden()\n}\nexamples for Store {\n check allowed(store: Store) {\n assert store.hidden()\n}\n}');
    const owner = [...catalog.inspection.query('concept')][0]!, at = [...catalog.inspection.query('member-expression')][0]!.member;
    expect(lookup.member(owner, 'hidden', at).value?.declaration.kind).toBe('capability');
  });

  it('locates record field selection at a real entry without inventing a reference', () => {
    const { catalog, lookup } = read('type Settings { count: Number }\nfunction consume() {\n requires Settings { count: 1 }.count > 0\n}');
    const owner = [...catalog.inspection.query('record-type-declaration')][0]!, entry = [...catalog.inspection.query('record-entry')][0]!;
    expect(lookup.member(owner, 'count', { id: entry.id, origin: entry.nameOrigin }, catalog.declaredType(owner.id)).value?.type).toBe(builtin(catalog, 'Number'));
    expect(lookup.member(owner, 'count', entry).problems.map(problem => problem.code)).toEqual(['invalid-member']);
  });

  it('retains the original unresolved-reference problem even when a scope supplies a value', () => {
    const { catalog, lookup, resolution, references } = read('function count() {\n requires missing > 0\n}');
    const reference = references[0]!, number = builtin(catalog, 'Number');
    expect(lookup.value(reference, () => ({ value: number, problems: [], deferred: [] })).problems[0]).toBe(resolution.problems[0]);
  });

  it('gets an available parameter type from the callable scope', () => {
    const { catalog, lookup, references } = read('function count(amount: Number) {\n requires amount > 0\n}');
    const callable = [...catalog.inspection.query('function')][0]!;
    expect(lookup.value(references[0]!, lookup.parameters(callable))).toEqual({ value: builtin(catalog, 'Number'), problems: [], deferred: [] });
  });

  it('does not make a resolved parameter available without a value scope', () => {
    const { lookup, references } = read('function count(amount: Number) {\n requires amount > 0\n}');
    expect(lookup.value(references[0]!).problems).toContainEqual(expect.objectContaining({ code: 'unavailable-value', at: references[0]!.origin }));
  });

  it('gets contextual result only from an ensures with a declared output', () => {
    const { catalog, lookup, references } = read('function count() returns Number {\n ensures result > 0\n}');
    expect(lookup.value(references[0]!)).toEqual({ value: builtin(catalog, 'Number'), problems: [], deferred: [] });
  });

  it('does not grant a later parameter to an earlier default through a supplied scope', () => {
    const { catalog, lookup, references } = read('function count(first: Number = later, later: Number = 1)');
    expect(lookup.value(references[0]!, () => ({ value: builtin(catalog, 'Number'), problems: [], deferred: [] })).problems)
      .toContainEqual(expect.objectContaining({ code: 'unavailable-value', at: references[0]!.origin }));
  });

  it('reads a receiver field using its substituted generic type', () => {
    const { catalog, lookup } = read('type Box<T> { value: T }\nfunction read(box: Box<Number>) {\n requires box.value > 0\n}');
    const owner = [...catalog.inspection.query('record-type-declaration')][0]!;
    const parameter = [...catalog.inspection.query('parameter')][0]!, fieldUse = [...catalog.inspection.query('member-expression')][0]!.member;
    const receiver = catalog.typeOf(parameter.declaredType.id);
    if (receiver.status !== 'known') throw new Error('Expected Box<Number>');
    const selected = lookup.member(owner, 'value', fieldUse, receiver.value);
    expect(selected.value?.declaration.id).toBe(owner.fields[0]!.id);
    expect(selected.value?.type).toBe(builtin(catalog, 'Number'));
    expect(selected.problems).toEqual([]);
  });
});

function read(text: string, modules: ModuleModel[] = []) {
  const parsed = new LangiumReader().read({ sourceId: 'lookup.expec', text });
  if (parsed.status !== 'accepted') throw new Error(JSON.stringify(parsed.diagnostics));
  const resolution = new Resolver().resolve(new LangiumModel('lookup.expec', parsed.document), { modules, packages: [] });
  const catalog = new TypeDescriber().describe(resolution);
  return { catalog, resolution, lookup: new ExpressionLookup(catalog), references: [...catalog.inspection.query('name-expression')].map(node => node.reference) };
}
function builtin(catalog: TypeCatalog, name: string) {
  return catalog.declaredType([...catalog.inspection.query('builtin-type')].find(type => type.name === name)!.id);
}
