import { expect, it } from 'vitest';
import { Compiler, LangiumModel, LangiumReader, SourceComposer, SpecificationIdentity } from '../../src/index.js';
import { KotlinDeclarations, kotlinOptions } from '../../src/project/kotlin/kotlin-declarations.js';

function data(source: string) {
  const read = new LangiumReader().read({ sourceId: 'main.expec', text: source });
  if (read.status !== 'accepted') throw Error(JSON.stringify(read));
  const compiled = new Compiler().compile({ resolution: new SourceComposer().compose(new LangiumModel('main', read.document), { modules: [], packages: [] }) });
  if (!compiled.value) throw Error(JSON.stringify(compiled));
  let next = 0;
  const identified = new SpecificationIdentity(() => 'test-data-' + ++next).associate(compiled.value);
  if (!identified.value) throw Error(JSON.stringify(identified));
  const current = identified.value, inspection = current.specification.inspection;
  const renderer = new KotlinDeclarations(current, kotlinOptions.parse({ directory: 'test', package: 'shopping.dsl' }));
  const annotations = [...inspection.query('fixture')].map(owner => {
    const type = current.specification.types.typeOf(owner.declaredType.id);
    if (type.status !== 'known') throw Error(JSON.stringify(type));
    return { owner, type: type.value };
  });
  return { renderer, annotations, inspection };
}

it('uses the actual selected native record identity inside a test-only union', () => {
  const example = data('type Book { title: Text }\nexamples { fixture choice: Book | Number = 1 }');
  const book = [...example.inspection.query('record-type-declaration')][0]!;
  const files = example.renderer.renderData(example.annotations, new Map(), new Map([[book.id, 'catalog.CatalogBook']]), new Map());
  expect(example.renderer.problems).toEqual([]);
  expect(files.map(file => file.path)).toEqual(['test/shopping/dsl/ExpecTestData.kt']);
  expect(files[0]!.text).toContain('data class Book(val value: catalog.CatalogBook) : ExamplesChoice');
  expect(files[0]!.artifacts).toEqual([]);
});

it('refuses conflicting anonymous group carrier names instead of assigning ordinal names', () => {
  const example = data('examples { fixture title: "Dune" = "Dune" }\nexamples { fixture title: "Foundation" = "Foundation" }');
  example.renderer.renderData(example.annotations, new Map(), new Map(), new Map());
  expect(example.renderer.problems.map(item => item.code)).toContain('native-name-conflict');
});

it('uses explicit group names for distinct carrier identities', () => {
  const example = data('examples { fixture title: "Dune" = "Dune" }\nexamples { fixture title: "Foundation" = "Foundation" }');
  const groups = [...example.inspection.query('examples')];
  const files = example.renderer.renderData(example.annotations, new Map([[groups[0]!.id, 'First'], [groups[1]!.id, 'Second']]), new Map(), new Map());
  expect(example.renderer.problems).toEqual([]);
  expect(files[0]!.text).toContain('data class FirstTitle(val value: kotlin.String)');
  expect(files[0]!.text).toContain('data class SecondTitle(val value: kotlin.String)');
});

it('keeps the application namespace separate from the test carrier namespace', () => {
  const example = data('type ExamplesTitle { text: Text }\nexamples { fixture title: "Dune" = "Dune" }');
  const applicationType = [...example.inspection.query('record-type-declaration')][0]!;
  const files = example.renderer.renderData(example.annotations, new Map(), new Map([[applicationType.id, 'application.ExamplesTitle']]), new Map());
  expect(example.renderer.problems).toEqual([]);
  expect(files[0]!.text).toContain('package shopping.dsl');
  expect(files[0]!.text).toContain('data class ExamplesTitle(val value: kotlin.String)');
});
