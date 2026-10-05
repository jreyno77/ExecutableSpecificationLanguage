import { describe, expect, it } from 'vitest';
import { Compiler, LangiumModel, LangiumReader, SourceComposer, SpecificationIdentity } from '../../src/index.js';
import { PythonDeclarations, pythonOptions } from '../../src/project/python/python-declarations.js';

function contracts(source: string, names: Record<string, string> = {}) {
    const read = new LangiumReader().read({ sourceId: 'game.expec', text: source });
    if (read.status !== 'accepted') throw Error(JSON.stringify(read));
    const compiled = new Compiler().compile({ resolution: new SourceComposer().compose(new LangiumModel('game', read.document), { modules: [], packages: [] }) });
    if (!compiled.value) throw Error(JSON.stringify(compiled));
    let next = 0;
    const identified = new SpecificationIdentity(() => 'construction-' + ++next).associate(compiled.value);
    if (!identified.value) throw Error(JSON.stringify(identified));
    const mappings = Object.entries(names).map(([authored, name]) => {
      const found = identified.value!.baseline.elements.filter(item => item.address.name === authored);
      if (found.length !== 1) throw Error('Expected one authored declaration: ' + authored);
      return { id: found[0]!.id, name };
    });
    const declarations = new PythonDeclarations(identified.value, pythonOptions.parse({ module: 'store.contracts', names: mappings }));
    return { current: identified.value, rendered: declarations.render(), problems: declarations.problems, obligations: declarations.obligations };
}
describe('Python declaration associations', () => {
  it('refuses mapped record fields that replace one another', () => {
    const source = 'type Book { title: Text\ncopies: Number }';
    const result = contracts(source, { copies: 'title' });
    expect(result.problems).toContainEqual(expect.objectContaining({ code: 'native-name-conflict',
      at: expect.objectContaining({ kind: 'source', range: expect.objectContaining({ start: expect.objectContaining({ offset: source.indexOf('copies: Number') }) }) }) }));
  });
  it('keeps equal method names in different classes distinct', () => {
    const result = contracts('class Store { public save\ncapability save() returns Nothing }\nclass Shelf { public save\ncapability save() returns Nothing }');
    expect(result.problems).toEqual([]);
    expect(result.rendered.artifacts.filter(item => (item.locator.value as { declaration: { name: string }[] }).declaration.at(-1)?.name === 'save')).toHaveLength(2);
  });
  it('locates a construction parameter in the actual native initializer', () => {
    const result = contracts('class StoreGame { construction(title: Text) }'); expect(result.problems).toEqual([]);
    const parameter = [...result.current.specification.inspection.query('parameter')].find(item => item.name === 'title')!;
    expect(result.rendered.artifacts.find(item => item.specId === result.current.id(parameter.id))?.locator.value).toEqual({
      file: 'src/store/contracts.py', declaration: [{ kind: 'class', name: 'StoreGame' }, { kind: 'method', name: '__init__' }, { kind: 'parameter', name: 'title' }],
    });
  });
  it('refuses an input that would replace the native instance receiver', () => {
    const result = contracts('class StoreGame { construction(self: Text) }');
    expect(result.problems).toContainEqual(expect.objectContaining({ code: 'native-name-conflict', message: expect.stringContaining('self') }));
  });
  it('allows the same input name on a standalone function without an implicit receiver', () => {
    const result = contracts('function title(self: Text) returns Text');
    expect(result.problems).toEqual([]); expect(result.rendered.text).toContain('def title(self: str) -> str:');
  });
});

it('retains declared generic failure verification at the authored failure type', () => {
  const source = 'type Book { title: Text }\nerror type Rejected<T> { code: "rejected"\npayload: T }\nfunction save(book: Book) returns Book fails with Rejected<Book>';
  const result = contracts(source);
  expect(result.problems).toEqual([]);
  expect(result.rendered.text).toContain('def save(book: Book) -> Book:');
  expect(result.obligations).toContainEqual(expect.objectContaining({
    code: 'failure-verification-required', message: expect.stringMatching(/Rejected<Book>.*save/),
    at: expect.objectContaining({ kind: 'source', range: expect.objectContaining({
      sourceId: 'game.expec', start: expect.objectContaining({ offset: source.indexOf('Rejected<Book>') }),
    }) }),
  }));
});

it('does not invent a declared failure for an ordinary callable', () => {
  const result = contracts('function save(title: Text) returns Text');
  expect(result.problems).toEqual([]);
  expect(result.obligations).toEqual([]);
});
