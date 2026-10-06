import { describe, expect, it } from 'vitest';
import { Compiler, LangiumModel, LangiumReader, SourceComposer, SpecificationIdentity, kotlinOutput } from '../../../../src/index.js';
import { KotlinDeclarations, kotlinOptions } from '../../../../src/project/kotlin/kotlin-declarations.js';

function declarations(source: string, options: object = {}, providers: Record<string, string> = {}) {
  const model = (module: string, text: string) => {
    const read = new LangiumReader().read({ sourceId: module, text });
    if (read.status !== 'accepted') throw new Error(JSON.stringify(read)); return new LangiumModel(module, read.document);
  };
  const specification = new Compiler().compile({ resolution: new SourceComposer().compose(model('main', source), {
    modules: Object.entries(providers).map(([module, text]) => model(module, text)), packages: [],
  }) });
  if (!specification.value) throw new Error(JSON.stringify(specification));
  let next = 0;
  const current = new SpecificationIdentity(() => 'mapping-' + ++next).associate(specification.value);
  if (!current.value) throw new Error(JSON.stringify(current));
  const renderer = new KotlinDeclarations(current.value, kotlinOptions.parse({ package: 'store', ...options }));
  const files = renderer.render(); return { files, problems: renderer.problems };
}

describe('Kotlin declaration mapping boundaries', () => {
  it('requires exactly one selector form', () => {
    expect(kotlinOutput.validate({ package: 'store', names: [{ id: 'one', declaration: ['Book'], name: 'Novel' }] })).not.toEqual([]);
    expect(kotlinOutput.validate({ package: 'store', names: [{ id: 'one', module: 'catalog', name: 'Novel' }] })).not.toEqual([]);
  });

  it('does not accept Kotlin source templates or wildcard imports', () => {
    expect(kotlinOutput.validate({ package: 'store', imports: [{ id: 'one', name: 'catalog.*' }] })).not.toEqual([]);
    expect(kotlinOutput.validate({ package: 'store', names: [{ id: 'one', name: 'Book() {}' }] })).not.toEqual([]);
  });

  it('locates an unknown mapping instead of ignoring the authored option', () => {
    const result = declarations('class StoreGame {}', { names: [{ declaration: ['Missing'], name: 'SavedGame' }] });
    expect(result.problems).toContainEqual(expect.objectContaining({ code: 'invalid-native-mapping', at: { kind: 'dependency', path: ['outputs', 'kotlin', 'Missing'] } }));
  });

  it('refuses two aliases for one source declaration', () => {
    const result = declarations('class StoreGame {}', { names: [{ declaration: ['StoreGame'], name: 'Game' }, { declaration: ['StoreGame'], name: 'SavedGame' }] });
    expect(result.problems.map(problem => problem.code)).toContain('invalid-native-mapping');
  });

  it('does not turn a generated type into an import through a mapping', () => {
    const result = declarations('type Book { title: Text }', { imports: [{ declaration: ['Book'], name: 'catalog.Book' }] });
    expect(result.problems.map(problem => problem.code)).toContain('invalid-native-mapping');
  });

  it('accepts an explicitly mapped opaque type without generating a replacement', () => {
    const result = declarations('opaque type Book\nfunction save(book: Book) returns Nothing', { imports: [{ declaration: ['Book'], name: 'catalog.Book' }] });
    expect(result.problems).toEqual([]);
    expect(result.files.map(file => file.path)).toEqual(['src/main/kotlin/store/save.kt']);
    expect(result.files[0]!.text).toContain('import catalog.Book');
    expect(result.files[0]!.text).toContain('fun save(book: Book): Unit');
  });

  it('refuses an import alias that would be hidden by a generic type parameter', () => {
    const result = declarations('use Book from "catalog"\ntype Shelf<CatalogBook> { book: Book }',
      { imports: [{ declaration: ['Book'], module: 'catalog', name: 'catalog.Book', as: 'CatalogBook' }] }, { catalog: 'type Book { title: Text }' });
    expect(result.problems.map(problem => problem.code)).toContain('native-name-conflict');
  });
  it('does not validate a mapped external author label as an emitted native identifier', () => {
    const result = declarations('use `Library book` from "catalog"\ntype Shelf { book: `Library book`\ntitle: Text }',
      { imports: [{ declaration: ['Library book'], module: 'catalog', name: 'catalog.Book' }] }, { catalog: 'type `Library book` { title: Text }' });
    expect(result.problems).toEqual([]);
    expect(result.files[0]!.text).toContain('var title: String');
  });
});
