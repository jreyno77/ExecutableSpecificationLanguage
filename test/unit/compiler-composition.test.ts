import { mkdtempSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Compiler, LangiumModel, LangiumReader, type Compilation, type ProblemLocation, type ResolutionDependencies } from '../../src/index.js';

describe('compiler coverage', () => {
  it('accepts an explicitly empty Nothing action body', () => {
    const result = compile('examples { action save() returns Nothing {} }');
    expectChecked(result);
  });

  it('does not let a checked postcondition discharge a different unchecked result reference', () => {
    const result = compile(`function quantity() returns Number { ensures result >= 0 }
examples {
  observation storedQuantity() returns Number { return result }
}`);
    expect(result.value).toBeUndefined();
    expect(result.syntax).toEqual([]);
    expect(result.problems.map(problem => [problem.code, line(problem.at)])).toEqual([['unresolved-reference', 3]]);
    expect(result.deferred).toEqual([]);
    expect(result.deferred.some(requirement => line(requirement.origin) === 1)).toBe(false);
  });

  it('checks ordered references in an authored assertion body', () => {
    const result = compile(`examples {
  check quantityIsCorrect() {
    let actual = 1
    assert actual == 1
  }
}`);
    expectChecked(result);
  });

  it('retains composition needed by an otherwise covered fixture initializer', () => {
    const result = compile(`include "extra.expec"
examples { fixture copies: Number = suppliedCopies }`);
    expect(result.value).toBeUndefined();
    expect(result.syntax).toEqual([]);
    expect(result.problems.map(problem => problem.code)).toEqual(['composition-required']);
    expect(result.deferred.map(requirement => [requirement.reason, line(requirement.origin)])).toEqual(
      expect.arrayContaining([['composition', 1], ['composition', 2]]));
  });

  it('reports extension and attached-example composition at their own directives', () => {
    const result = compile(`concept Store {}
extend Store { public save }
examples for Store from "saving.expec"`);
    expect(result.value).toBeUndefined();
    expect(result.syntax).toEqual([]);
    expect(result.problems.map(problem => [problem.code, line(problem.at)])).toEqual([
      ['composition-required', 2], ['composition-required', 3],
    ]);
    expect(result.deferred.map(requirement => [requirement.reason, line(requirement.origin)])).toEqual(
      expect.arrayContaining([['composition', 2], ['composition', 3]]));
  });

  it('checks receiver members in defaults and result conditions without stale requirements', () => {
    const result = compile(`type Seed { copies: Number }
function quantity(seed: Seed, copies: Number = seed.copies) returns Number {
  ensures result >= copies
}`);
    expectChecked(result);
    expect([...result.value!.inspection.query('function')].map(operation => operation.name)).toEqual(['quantity']);
  });

  it('checks a capture named result and a bodyless check through their scenario scope', () => {
    const result = compile(`examples {
  action quantity() returns Number
  check hasQuantity(actual: Number)
  scenario "captured quantity" {
    when result = quantity()
    then hasQuantity(result)
  }
}`);
    expectChecked(result);
    expect([...result.value!.inspection.query('scenario')].map(scenario => scenario.title.value)).toEqual(['captured quantity']);
  });

  it('preserves a bad fixture initializer when the fixture supplies a parameter default', () => {
    const result = compile(`examples {
  fixture defaultCount: Number = "many"
  action addCopies(count: Number = defaultCount) returns Nothing
}`);
    expect(result.value).toBeUndefined();
    expect(result.syntax).toEqual([]);
    expect(result.deferred).toEqual([]);
    expect(result.problems.map(problem => [problem.code, line(problem.at)])).toEqual([['incompatible-type', 2]]);
  });

  it('checks interaction defaults with earlier parameter values', () => {
    const result = compile(`type Seed { copies: Number }
interaction "defaults"(seed: Seed, copies: Number = seed.copies) {}`);
    expectChecked(result);
  });

  it('rejects an interaction default reading a later parameter', () => {
    const result = compile('interaction "defaults"(copies: Number = later, later: Number = 1) {}');
    expect(result.value).toBeUndefined();
    expect(result.syntax).toEqual([]);
    expect(result.deferred).toEqual([]);
    expect(result.problems.map(problem => problem.code)).toEqual(['unavailable-value']);
  });
});

describe('compiler findings', () => {
  it('reports one original fixture failure while preserving both dependent uses', () => {
    const result = compile(`examples {
  fixture invalid: Number = "many"
  fixture first: Number = invalid
  fixture second: Number = invalid
}`);
    expect(result.syntax).toEqual([]);
    expect(result.deferred).toEqual([]);
    expect(result.value).toBeUndefined();
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toMatchObject({ code: 'incompatible-type' });
    expect(line(result.problems[0]!.at)).toBe(2);
    expect(result.problems[0]!.related.map(line).sort()).toEqual([3, 4]);
  });

  it('retains separate unresolved occurrences with the same name and code', () => {
    const result = compile(`type MissingTypes {
  first: Missing
  second: Missing
}`);
    expect(result.value).toBeUndefined();
    expect(result.syntax).toEqual([]);
    expect(result.deferred).toEqual([]);
    expect(result.problems.map(problem => [problem.code, line(problem.at)])).toEqual([
      ['unresolved-reference', 2], ['unresolved-reference', 3],
    ]);
  });

  it('rejects duplicate locators even when neither supplied module is imported', () => {
    const result = compile('type Book {}', { modules: [module('unused', 'type First {}', 'first.expec'),
      module('unused', 'type Second {}', 'second.expec')], packages: [] });
    expect(result.value).toBeUndefined();
    expect(result.syntax).toEqual([]);
    expect(result.problems).toEqual([expect.objectContaining({
      code: 'invalid-dependency-input', at: { kind: 'dependency', path: ['modules', 1, 'locator'] },
      related: [{ kind: 'dependency', path: ['modules', 0, 'locator'] }],
    })]);
  });
});

describe('compiled query boundaries', () => {
  it('rejects a non-message handle instead of returning an empty communication', () => {
    const result = compile('concept Store {}');
    expectChecked(result);
    const store = [...result.value!.inspection.query('concept')][0]!;
    expect(() => result.value!.message(store.id)).toThrow(expect.objectContaining({ code: 'unexpected-kind', nodeId: store.id }));
  });

  it('rejects a message from a different compilation of the same text', () => {
    const text = `concept Store {
  public save
  capability save() returns Nothing
}
interaction "save"() {
  participant store: Store
  message store -> store.save()
}`;
    const first = compile(text), second = compile(text);
    expectChecked(first);
    expectChecked(second);
    const message = [...first.value!.inspection.query('message')][0]!;
    expect(() => second.value!.message(message.id)).toThrow(expect.objectContaining({ code: 'foreign-node', nodeId: message.id }));
    expect(first.value!.message(message.id).value).toBeDefined();
  });

  it('keeps a supplied but unreachable message explicitly not analyzed', () => {
    const unused = module('unused', `concept Store {
  public save
  capability save() returns Nothing
}
interaction "save"() {
  participant store: Store
  message store -> store.save()
}`);
    const result = compile('type Book {}', { modules: [unused], packages: [] });
    expectChecked(result);
    const message = unused.nodes('message')[0]!;
    expect(() => result.value!.message(message.id)).toThrow(expect.objectContaining({ code: 'not-analyzed', nodeId: message.id }));
  });
});

describe('compiler supplied inputs and effects', () => {
  it('observes a removed package without changing an earlier checked result', () => {
    const compiler = new Compiler(), source = { sourceId: 'store.expec', text: 'concept Store { requires package "vite" for build }' };
    const packages: { alias: string; phases: ('build' | 'runtime' | 'test')[] }[] = [{ alias: 'vite', phases: ['build'] }];
    const input = { source, locator: 'store', dependencies: { modules: [], packages } };
    const first = compiler.compile(input);
    expectChecked(first);
    const requirements = [...first.value!.inspection.query('requires-package')].map(requirement => ({
      id: requirement.id, package: requirement.locator.value, phase: requirement.phase,
    }));

    packages.splice(0);
    const removed = compiler.compile(input);

    expect(removed.value).toBeUndefined();
    expect(removed.problems.map(problem => problem.code)).toEqual(['unavailable-package']);
    expectChecked(first);
    expect([...first.value!.inspection.query('requires-package')].map(requirement => ({
      id: requirement.id, package: requirement.locator.value, phase: requirement.phase,
    }))).toEqual(requirements);
  });

  it('does not discover an unprovided file or change the nearby project files', () => {
    const directory = mkdtempSync(join(tmpdir(), 'expec-compiler-'));
    const nearby = join(directory, 'receipt.expec'), entry = join(directory, 'store.expec');
    const text = `use Receipt from "${nearby.replaceAll('\\', '/')}"\nfunction save() returns Receipt`;
    writeFileSync(nearby, 'type Receipt { saved: Boolean }');
    writeFileSync(entry, text);
    const before = files(directory);
    try {
      const result = new Compiler().compile({ source: { sourceId: entry, text }, locator: entry,
        dependencies: { modules: [], packages: [] } });

      expect(result.value).toBeUndefined();
      expect(result.syntax).toEqual([]);
      expect(result.problems.map(problem => problem.code)).toContain('unavailable-module');
      expect(files(directory)).toEqual(before);
    } finally {
      unlinkSync(entry);
      unlinkSync(nearby);
      rmdirSync(directory);
    }
  });
});

function compile(text: string, dependencies: ResolutionDependencies = { modules: [], packages: [] }): Compilation {
  return new Compiler().compile({ source: { sourceId: 'entry.expec', text }, locator: 'entry', dependencies });
}
function module(locator: string, text: string, sourceId = locator + '.expec') {
  const read = new LangiumReader().read({ sourceId, text });
  if (read.status !== 'accepted') throw new Error(JSON.stringify(read.diagnostics));
  return new LangiumModel(locator, read.document);
}
function expectChecked(result: Compilation): void {
  expect(result).toMatchObject({ syntax: [], problems: [], deferred: [], value: expect.any(Object) });
}
function line(origin: ProblemLocation): number | undefined {
  return origin.kind === 'source' ? origin.range.start.line : undefined;
}
function files(directory: string) {
  return readdirSync(directory).sort().map(name => [name, readFileSync(join(directory, name), 'utf8')]);
}
