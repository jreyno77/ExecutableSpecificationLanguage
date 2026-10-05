import { expect, it } from 'vitest';
import { Compiler, LangiumModel, LangiumReader, SourceComposer, SpecificationIdentity } from '../../src/index.js';
import { KotlinExamples } from '../../src/project/kotlin/acceptance/kotlin-examples.js';

function generated(source: string) {
  const read = new LangiumReader().read({ sourceId: 'main', text: source });
  if (read.status !== 'accepted') throw Error(JSON.stringify(read));
  const compiled = new Compiler().compile({ resolution: new SourceComposer().compose(new LangiumModel('main', read.document), { modules: [], packages: [] }) });
  if (!compiled.value) throw Error(JSON.stringify(compiled));
  let next = 0;
  const associated = new SpecificationIdentity(() => 'comparison-' + ++next).associate(compiled.value);
  if (!associated.value) throw Error(JSON.stringify(associated));
  const current = associated.value, groups = [...current.specification.inspection.query('examples')];
  const output = new KotlinExamples(current, { testRoot: 'test', package: 'shopping', domain: 'books', names: groups.map(group => ({
    id: current.id(group.id), name: group.members.some(member => member.kind === 'example' && member.title.value === 'Dune') ? 'Books' : 'Other',
  })) }, new Map());
  const files = output.files(); expect(output.problems).toEqual([]);
  return files.find(file => file.path === 'test/shopping/acceptance/Books.kt')!.text;
}

it('keeps a retained scenario unchanged when an earlier group is removed', () => {
  const retained = 'examples { observation quantity() returns Number\nexample "Dune": quantity() => 1 }';
  const before = generated('examples { example "one": 1 => 1 }\n' + retained);
  expect(generated(retained)).toBe(before);
});

it('keeps a retained scenario unchanged when unrelated comparison types are reordered', () => {
  const retained = 'examples { observation title() returns Text\nexample "Dune": title() => "Dune" }';
  const other = 'examples { example "one": 1 => 1 }';
  expect(generated(retained + '\n' + other)).toBe(generated(other + '\n' + retained));
});
