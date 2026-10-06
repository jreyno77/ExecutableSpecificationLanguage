import { describe, expect, it } from 'vitest';
import { LangiumModel, LangiumReader, QueryInspection, Resolver } from '../../../src/index.js';

describe('example references use ordinary declaration and capture scope', () => {
  it('binds a fixture named result in a short example', () => {
    const { inspection, references } = resolve(`examples {
  fixture result: Number = 64
  example "ordinary fixture": result => result
}`);
    const fixture = [...inspection.query('fixture')][0]!;

    expect(references.map(reference => reference.resolution)).toEqual([
      { status: 'bound', target: fixture.id }, { status: 'bound', target: fixture.id },
    ]);
  });

  it('binds a fixture named result in scenario arguments and expectations', () => {
    const { inspection, references } = resolve(`examples {
  fixture result: Number = 1
  action addCopies(count: Number) returns Nothing
  scenario "ordinary fixture" {
    when addCopies(result)
    then result == 1
  }
}`);
    const fixture = [...inspection.query('fixture')][0]!;

    expect(references.filter(reference => reference.segments[0] === 'result').map(reference => reference.resolution)).toEqual([
      { status: 'bound', target: fixture.id }, { status: 'bound', target: fixture.id },
    ]);
  });

  it('leaves a capture named result to ordered scenario checking', () => {
    const { references } = resolve(`examples {
  action quantity() returns Number
  scenario "ordinary capture" {
    when result = quantity()
    then result == 1
  }
}`);

    expect(references.find(reference => reference.segments[0] === 'result')!.resolution)
      .toMatchObject({ status: 'deferred', requirement: { reason: 'ordered-scope' } });
  });

  it('does not bind an outer result when a later capture owns that name', () => {
    const { references } = resolve(`examples {
  fixture result: Number = 1
  action quantity() returns Number
  action useCount(count: Number) returns Nothing
  scenario "use before capture" {
    when useCount(result)
    when result = quantity()
    then result == 1
  }
}`);

    expect(references.filter(reference => reference.segments[0] === 'result').map(reference => reference.resolution)).toEqual([
      expect.objectContaining({ status: 'deferred', requirement: expect.objectContaining({ reason: 'ordered-scope' }) }),
      expect.objectContaining({ status: 'deferred', requirement: expect.objectContaining({ reason: 'ordered-scope' }) }),
    ]);
  });

  it('reports an undeclared result in a short example', () => {
    const { references, problems } = resolve('examples { example "missing value": result => 1 }');

    expect(references[0]!.resolution).toEqual({ status: 'invalid', problems: [problems[0]] });
    expect(problems).toEqual([expect.objectContaining({ code: 'unresolved-reference', at: references[0]!.origin })]);
  });

  it('does not import a result capture from another scenario', () => {
    const { references, problems } = resolve(`examples {
  action quantity() returns Number
  action useCount(count: Number) returns Nothing
  scenario "first" {
    when result = quantity()
    then true
  }
  scenario "second" {
    when useCount(result)
    then true
  }
}`);
    const reference = references.find(reference => reference.segments[0] === 'result')!;

    expect(reference.resolution).toEqual({ status: 'invalid', problems: [problems[0]] });
    expect(problems).toEqual([expect.objectContaining({ code: 'unresolved-reference', at: reference.origin })]);
  });
});

function resolve(text: string) {
  const read = new LangiumReader().read({ sourceId: 'scenarios.expec', text });
  if (read.status !== 'accepted') throw new Error(JSON.stringify(read.diagnostics));
  const resolution = new Resolver().resolve(new LangiumModel('scenarios.expec', read.document), { modules: [], packages: [] });
  const inspection = new QueryInspection(resolution.model);
  return { ...resolution, inspection, references: [...inspection.query('name-expression')].map(node => node.reference) };
}
