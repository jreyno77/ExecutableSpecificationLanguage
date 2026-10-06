import { describe, expect, it } from 'vitest';
import { ExpressionChecker, FixtureChecker, LangiumModel, LangiumReader, Resolver, ScenarioChecker, TypeDescriber } from '../../../src/index.js';

describe('scenario capture availability', () => {
  it('does not make a wrong-role producer valid through its result annotation', () => {
    const examples = read(`examples {
  observation quantity() returns Number
  action useCount(count: Number) returns Nothing
  scenario "wrong producer" {
    when count = quantity()
    when useCount(count)
    then true
  }
}`);

    const checked = examples.check('wrong producer');

    expect(checked.problems).toContainEqual(expect.objectContaining({
      code: 'invalid-step-role', related: expect.arrayContaining([examples.reference('count').origin]),
    }));
  });

  it('does not replace the first capture after a duplicate', () => {
    const examples = read(`examples {
  action quantity() returns Number
  action title() returns Text
  action useCount(count: Number) returns Nothing
  scenario "duplicate" {
    when count = quantity()
    when count = title()
    when useCount(count)
    then true
  }
}`);

    expect(examples.check('duplicate').problems.map(problem => problem.code)).toEqual(['duplicate-capture']);
  });

  it('does not let a capture supply its own initializer', () => {
    const examples = read(`examples {
  fixture count: Number = 1
  action next(previous: Number) returns Number
  scenario "self use" {
    when count = next(count)
    then true
  }
}`);

    expect(examples.check('self use').problems).toContainEqual(expect.objectContaining({
      code: 'unavailable-value', at: examples.reference('count').origin,
    }));
  });
});

describe('short example checking', () => {
  it('retains an independent invalid expectation when its actual value is invalid', () => {
    const examples = read(`examples { example "two typos": actualTypo => expectedTypo }`);

    expect(examples.check('two typos').problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unresolved-reference', at: examples.reference('actualTypo').origin }),
      expect.objectContaining({ code: 'unresolved-reference', at: examples.reference('expectedTypo').origin }),
    ]));
  });

  it('accepts a grouped effect with an explicit prose expectation', () => {
    const examples = read(`function save() returns Nothing
examples { example "save": (save()) => satisfies "The save survives a restart" }`);

    expect(examples.check('save')).toEqual({ problems: [], deferred: [] });
  });
});

function read(text: string) {
  const parsed = new LangiumReader().read({ sourceId: 'scenario.expec', text });
  if (parsed.status !== 'accepted') throw new Error(JSON.stringify(parsed.diagnostics));
  const catalog = new TypeDescriber().describe(new Resolver().resolve(new LangiumModel('scenario.expec', parsed.document), { modules: [], packages: [] }));
  const expressions = new ExpressionChecker(catalog);
  const checker = new ScenarioChecker(catalog.inspection, expressions, new FixtureChecker(catalog, expressions));
  return {
    check: (title: string) => {
      const example = [...catalog.inspection.query('example'), ...catalog.inspection.query('scenario')].find(node => node.title.value === title);
      if (!example) throw new Error(`Expected example ${title}`);
      return checker.check(example.id);
    },
    reference: (name: string) => {
      const reference = [...catalog.inspection.query('reference')].find(node => node.segments.join('.') === name);
      if (!reference) throw new Error(`Expected reference ${name}`);
      return reference;
    },
  };
}
