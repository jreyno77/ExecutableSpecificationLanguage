import { describe, expect, it } from 'vitest';
import { ExpressionChecker, FixtureChecker, LangiumModel, LangiumReader, Resolver, TypeDescriber } from '../../src/index.js';

describe('fixture data restrictions compose with contextual types', () => {
  it('requires explicit data inside an instantiated generic record', () => {
    const fixtures = read(`type Entry { count: Number = 1 }
type Box<T> { value: T }
examples { fixture box: Box<Entry> = { value: {} } }`);

    expect(fixtures.check('box').problems).toContainEqual(expect.objectContaining({ code: 'missing-fixture-data' }));
    expect(fixtures.check('box').value).toBeUndefined();
  });

  it('requires explicit data inside a tuple element', () => {
    const fixtures = read(`type Entry { count: Number = 1 }
examples { fixture pair: [Entry, Number] = [{}, 1] }`);

    expect(fixtures.check('pair').problems).toContainEqual(expect.objectContaining({ code: 'missing-fixture-data' }));
  });

  it('requires explicit data through an optional alias', () => {
    const fixtures = read(`type Entry { count: Number = 1 }
type MaybeEntry = Entry?
examples { fixture entry: MaybeEntry = {} }`);

    expect(fixtures.check('entry').problems).toContainEqual(expect.objectContaining({ code: 'missing-fixture-data' }));
  });

  it('retains record ambiguity even when only one choice supplies all its fields', () => {
    const fixtures = read(`type Defaulted { count: Number = 1 }
type Empty {}
examples { fixture entry: Defaulted | Empty = {} }`);

    expect(fixtures.check('entry').problems).toContainEqual(expect.objectContaining({ code: 'ambiguous-record' }));
    expect(fixtures.check('entry').value).toBeUndefined();
  });

  it('uses an admissible collection alternative without borrowing defaults', () => {
    const fixtures = read(`type Defaulted { count: Number = 1 }
type Empty {}
examples { fixture entries: List<Defaulted> | List<Empty> = [{}] }`);

    expect(fixtures.check('entries')).toEqual({ value: fixtures.declaredType('entries'), problems: [], deferred: [] });
  });

  it('rejects defaults when every compatible collection alternative needs them', () => {
    const fixtures = read(`type First { count: Number = 1 }
type Second { title: Text = "Dune" }
examples { fixture entries: List<First> | List<Second> = [{}] }`);

    expect(fixtures.check('entries').problems).toContainEqual(expect.objectContaining({ code: 'missing-fixture-data' }));
    expect(fixtures.check('entries').value).toBeUndefined();
  });

  it('rejects calls even inside a record whose destination is unresolved', () => {
    const fixtures = read(`function load() returns Number
examples { fixture entry: Missing = { count: load() } }`);

    expect(fixtures.check('entry').problems.map(problem => problem.code)).toEqual(expect.arrayContaining(['unresolved-reference', 'runtime-call']));
  });
});

describe('fixture dependencies retain their actual causes', () => {
  it('reports a direct initialization cycle at its reference', () => {
    const fixtures = read('examples { fixture count: Number = count }');
    const reference = [...fixtures.catalog.inspection.query('name-expression')][0]!.reference;

    expect(fixtures.check('count').problems).toContainEqual(expect.objectContaining({
      code: 'fixture-cycle', at: reference.origin, message: expect.stringContaining('count → count'),
    }));
  });

  it('retains the original invalid initializer and the dependent reference', () => {
    const fixtures = read(`examples {
  fixture broken: Number = "many"
  fixture dependent: Number = broken
}`);
    const initializer = fixtures.fixture('broken').value;
    const reference = [...fixtures.catalog.inspection.query('name-expression')][0]!.reference;

    expect(fixtures.check('dependent').problems).toContainEqual(expect.objectContaining({
      code: 'incompatible-type', at: initializer.origin, related: expect.arrayContaining([reference.origin]),
    }));
  });

  it('does not change a cycle report after checking a different entry into that cycle', () => {
    const fixtures = read(`examples {
  fixture first: Number = second
  fixture second: Number = first
}`);
    const first = fixtures.check('first');
    const snapshot = structuredClone(first);

    fixtures.check('second');

    expect(fixtures.check('first')).toEqual(snapshot);
    expect(first).toEqual(snapshot);
    expect(first.problems).toContainEqual(expect.objectContaining({ code: 'fixture-cycle' }));
  });

  it('does not add dependency locations to an already returned invalid report', () => {
    const fixtures = read(`examples {
  fixture broken: Number = "many"
  fixture dependent: Number = broken
}`);
    const broken = fixtures.check('broken');
    const snapshot = structuredClone(broken);

    const dependent = fixtures.check('dependent');

    expect(broken).toEqual(snapshot);
    expect(dependent.problems[0]!.at).toEqual(broken.problems[0]!.at);
    expect(dependent.problems[0]!.related).not.toEqual(broken.problems[0]!.related);
  });
});

function read(text: string) {
  const parsed = new LangiumReader().read({ sourceId: 'fixtures.expec', text });
  if (parsed.status !== 'accepted') throw new Error(JSON.stringify(parsed.diagnostics));
  const catalog = new TypeDescriber().describe(new Resolver().resolve(new LangiumModel('fixtures.expec', parsed.document), { modules: [], packages: [] }));
  const checker = new FixtureChecker(catalog, new ExpressionChecker(catalog));
  const fixture = (name: string) => {
    const node = [...catalog.inspection.query('fixture')].find(node => node.name === name);
    if (!node) throw new Error(`Expected fixture ${name}`);
    return node;
  };
  return { catalog, fixture, check: (name: string) => checker.check(fixture(name).id), declaredType: (name: string) => {
    const type = catalog.typeOf(fixture(name).declaredType.id);
    if (type.status !== 'known') throw new Error(`Expected a known type for ${name}`);
    return type.value;
  } };
}
