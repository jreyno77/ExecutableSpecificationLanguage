import { describe, expect, it } from 'vitest';
import {
  ExpressionChecker, ExternalModel, LangiumReader, LangiumModel, Resolver, TypeDescriber,
  type Check, type ModuleModel, type TypeCatalog, type TypeId,
} from '../../../src/index.js';

describe('an expression checker caller retains established type meaning', () => {
  it('accepts an available value already described by a singleton literal type', () => {
    const { checker, catalog } = read('function accept(value: 1) returns Number\nfunction caller(value: 1) returns Number {\n ensures accept(value) > 0\n}');
    const caller = callable(catalog, 'caller');

    expect(checker.checkContract(caller.id)).toEqual({ problems: [], deferred: [] });
  });

  it('accepts each source union alternative through the whole destination union', () => {
    const { checker, catalog } = read('function accept(value: Number | Text) returns Number\nfunction caller(value: Number | Text) returns Number {\n ensures accept(value) > 0\n}');

    expect(checker.checkContract(callable(catalog, 'caller').id)).toEqual({ problems: [], deferred: [] });
  });

  it('rejects a written optional record alias without trying to construct it recursively', () => {
    const { checker, catalog } = read('type Settings { count: Number }\ntype MaybeSettings = Settings?\nfunction caller() {\n ensures MaybeSettings { count: 1 }.count > 0\n}');
    const record = [...catalog.inspection.query('record-expression')][0]!;

    const checked = checker.typeOf(record.id);

    expect(checked.value).toBeUndefined();
    expect(checked.problems).toContainEqual(expect.objectContaining({ code: 'invalid-record', at: record.origin }));
  });

  it('retains original upstream causes when an available receiver also has a known type', () => {
    const { checker, catalog, resolution } = read('type Record { title: Text }\ntype Broken = Missing\nfunction earlier() returns Number {\n ensures result > 0\n}\nfunction caller(record: Record) {\n ensures record.title == "saved"\n}');
    const receiver = catalog.typeOf(callable(catalog, 'caller').parameters[0]!.declaredType.id);
    if (receiver.status !== 'known') throw new Error('Expected the declared record type');
    const cause = resolution.problems[0]!, requirement = resolution.deferred[0]!;
    const member = [...catalog.inspection.query('member-expression')][0]!;

    const checked = checker.typeOf(member.id, () => ({ value: receiver.value, problems: [cause], deferred: [requirement] }));

    expect(checked.value).toBeUndefined();
    expect(checked.problems[0]).toBe(cause);
    expect(checked.deferred[0]).toBe(requirement);
  });
});

describe('an expression checker caller uses checked and independent contexts', () => {
  it('does not turn an unresolved authored name into a supplied value', () => {
    const { checker, catalog, resolution } = read('function caller() {\n requires missing > 0\n}');
    const expression = [...catalog.inspection.query('name-expression')][0]!;

    const checked = checker.typeOf(expression.id, () => known(builtin(catalog, 'Number')));

    expect(checked.value).toBeUndefined();
    expect(checked.problems[0]).toBe(resolution.problems[0]);
  });

  it('rejects a foreign type returned by a supplied value scope', () => {
    const { checker, catalog } = read('function caller(value: Number) {\n requires value > 0\n}');
    const foreign = builtin(read('type Other {}').catalog, 'Number');
    const expression = [...catalog.inspection.query('name-expression')][0]!;

    expect(() => checker.typeOf(expression.id, () => known(foreign)))
      .toThrow(expect.objectContaining({ code: 'unknown-type', typeId: foreign }));
  });

  it('rejects a foreign expected type before reporting an authored compatibility problem', () => {
    const { checker, catalog } = read('function caller(value: Number = 1)');
    const foreign = builtin(read('type Other {}').catalog, 'Number');
    const expression = callable(catalog, 'caller').parameters[0]!.defaultValue!;

    expect(() => checker.checkValue(expression.id, foreign))
      .toThrow(expect.objectContaining({ code: 'unknown-type', typeId: foreign }));
  });

  it('rejects a declaration where the caller requested an expression', () => {
    const { checker, catalog } = read('function caller()');
    const declaration = callable(catalog, 'caller');

    expect(() => checker.typeOf(declaration.id))
      .toThrow(expect.objectContaining({ code: 'unexpected-kind', nodeId: declaration.id }));
  });

  it('checks new availability without changing an earlier answer or captured model facts', () => {
    const { checker, catalog } = read('function caller(value: Number) {\n requires value > 0\n}');
    const expression = [...catalog.inspection.query('name-expression')][0]!;
    const binding = expression.reference.resolution, number = builtin(catalog, 'Number');
    const description = catalog.describe(number), problems = [...catalog.problems], deferred = [...catalog.deferred];

    const available = checker.typeOf(expression.id, () => known(number));
    const unavailable = checker.typeOf(expression.id);

    expect(available).toEqual(known(number));
    expect(unavailable.value).toBeUndefined();
    expect(unavailable.problems).toContainEqual(expect.objectContaining({ code: 'unavailable-value', at: expression.reference.origin }));
    expect(expression.reference.resolution).toBe(binding);
    expect(catalog.describe(number)).toBe(description);
    expect(catalog.problems).toEqual(problems);
    expect(catalog.deferred).toEqual(deferred);
  });
});

describe('an expression checker uses context without hiding independent failures', () => {
  it('uses a fitting List alternative to check literal elements', () => {
    const { checker, catalog } = read('type Choice = List<1> | List<2>\nfunction caller(value: Choice = [1])');
    const parameter = callable(catalog, 'caller').parameters[0]!;

    expect(checker.checkDefault(parameter.id)).toEqual({ problems: [], deferred: [] });
  });

  it('uses a fitting tuple alternative to check ordered elements', () => {
    const { checker, catalog } = read('type Choice = [Number, Text] | [Text, Number]\nfunction caller(value: Choice = [1, "saved"])');
    const parameter = callable(catalog, 'caller').parameters[0]!;

    expect(checker.checkDefault(parameter.id)).toEqual({ problems: [], deferred: [] });
  });

  it('rejects an empty list when the known destination is Number', () => {
    const { checker, catalog } = read('function caller(value: Number = [])');
    const parameter = callable(catalog, 'caller').parameters[0]!;

    const checked = checker.checkDefault(parameter.id);

    expect(checked.problems).toContainEqual(expect.objectContaining({ code: 'incompatible-type', at: parameter.defaultValue!.origin }));
  });

  it('retains a declared-type error beside an unavailable external default body', () => {
    const library = new ExternalModel('library', [{ kind: 'function', name: 'save', parameters: [
      { name: 'value', type: { kind: 'named', path: ['Missing'] }, hasDefault: true },
    ] }]);
    const { checker, catalog, resolution } = read('use save from "library"', [library]);
    const parameter = callable(catalog, 'save').parameters[0]!;

    const checked = checker.checkDefault(parameter.id);

    expect(checked.problems[0]).toBe(resolution.problems[0]);
    expect(checked.deferred).toContainEqual(expect.objectContaining({ reason: 'default-body', origin: parameter.origin }));
  });

  it('retains an omitted defaulted field declared-type error when constructing its record', () => {
    const { checker, catalog, resolution } = read('type Settings { count: Missing = 1 }\nfunction caller() {\n ensures Settings {} == Settings {}\n}');
    const record = [...catalog.inspection.query('record-expression')][0]!;

    const checked = checker.typeOf(record.id);

    expect(checked.value).toBeUndefined();
    expect(checked.problems[0]).toBe(resolution.problems[0]);
  });

  it('does not accept a condition when its supplied scope gives neither a type nor a cause', () => {
    const { checker, catalog } = read('function caller(flag: Boolean) {\n requires flag\n}');
    const expression = [...catalog.inspection.query('name-expression')][0]!;

    const checked = checker.checkCondition(expression.id, () => ({ problems: [], deferred: [] }));

    expect(checked.problems).toContainEqual(expect.objectContaining({ code: 'unavailable-value', at: expression.reference.origin }));
  });
});

describe('an expression checker reports independent prerequisites and related contract locations', () => {
  it('retains the missing result declaration beside an incompatible argument in the same value call', () => {
    const { checker, catalog } = read('function save(count: Number)\nfunction caller() {\n ensures save("bad") > 0\n}');
    const call = [...catalog.inspection.query('call-expression')][0]!;

    const checked = checker.typeOf(call.id);

    expect(checked.value).toBeUndefined();
    expect(checked.problems).toContainEqual(expect.objectContaining({ code: 'incompatible-type', at: call.arguments[0]!.origin }));
    expect(checked.deferred).toContainEqual(expect.objectContaining({ reason: 'declared-result', origin: call.origin }));
  });

  it('relates a conflicting result parameter to its callable and the ensures condition', () => {
    const { checker, catalog } = read('function count(result: Number) returns Number {\n ensures result > 0\n}');
    const declaration = callable(catalog, 'count');
    const condition = [...catalog.inspection.query('ensures')][0]!.content;

    const checked = checker.checkContract(declaration.id);

    expect(checked.problems).toContainEqual(expect.objectContaining({
      code: 'result-conflict', at: declaration.parameters[0]!.origin,
      related: expect.arrayContaining([declaration.origin, condition.origin]),
    }));
  });
});
describe('an expression checker rejects known Nothing value shapes supplied by its caller', () => {
  it('rejects Nothing inside an expected union even when another alternative accepts the value', () => {
    const { checker, catalog } = read('function caller(value: Number = 1)');
    const value = callable(catalog, 'caller').parameters[0]!.defaultValue!;
    const expected = catalog.types.unionOf([builtin(catalog, 'Number'), builtin(catalog, 'Nothing')]);

    expect(checker.checkValue(value.id, expected).problems).not.toEqual([]);
  });

  it('rejects Nothing as the type of an available ordinary value', () => {
    const { checker, catalog } = read('function caller(value: Number) {\n requires value > 0\n}');
    const expression = [...catalog.inspection.query('name-expression')][0]!;
    const nothing = builtin(catalog, 'Nothing');

    const checked = checker.typeOf(expression.id, () => known(nothing));

    expect(checked.value).toBeUndefined();
    expect(checked.problems).not.toEqual([]);
  });

  it('rejects an alias to Nothing as the type of an available ordinary value', () => {
    const { checker, catalog } = read('type NoResult = Nothing\nfunction caller(value: Number) {\n requires value > 0\n}');
    const expression = [...catalog.inspection.query('name-expression')][0]!;
    const alias = [...catalog.inspection.query('alias-type-declaration')][0]!;

    const checked = checker.typeOf(expression.id, () => known(catalog.declaredType(alias.id)));

    expect(checked.value).toBeUndefined();
    expect(checked.problems).not.toEqual([]);
  });

  it('rejects Nothing nested in a supplied List type shape', () => {
    const { checker, catalog } = read('function caller(values: List<Number>) {\n requires values == values\n}');
    const expression = [...catalog.inspection.query('name-expression')][0]!;
    const list = [...catalog.inspection.query('builtin-type')].find(type => type.name === 'List')!;
    const invalidList = catalog.types.intern({ kind: 'builtin', declaration: list.id, arguments: [builtin(catalog, 'Nothing')] });

    const checked = checker.typeOf(expression.id, () => known(invalidList));

    expect(checked.value).toBeUndefined();
    expect(checked.problems).not.toEqual([]);
  });
});
function read(text: string, modules: readonly ModuleModel[] = []) {
  const parsed = new LangiumReader().read({ sourceId: 'expressions.expec', text });
  if (parsed.status !== 'accepted') throw new Error(JSON.stringify(parsed.diagnostics));
  const resolution = new Resolver().resolve(new LangiumModel('expressions', parsed.document), { modules, packages: [] });
  const catalog = new TypeDescriber().describe(resolution);
  return { resolution, catalog, checker: new ExpressionChecker(catalog) };
}
function callable(catalog: TypeCatalog, name: string) {
  const declaration = [...catalog.inspection.query('function')].find(node => node.name === name);
  if (!declaration) throw new Error('Expected function ' + name);
  return declaration;
}
function builtin(catalog: TypeCatalog, name: string) {
  return catalog.declaredType([...catalog.inspection.query('builtin-type')].find(node => node.name === name)!.id);
}
function known(value: TypeId): Check<TypeId> { return { value, problems: [], deferred: [] }; }
