import { describe, expect, it } from 'vitest';
import { Compiler, LangiumModel, LangiumReader, SourceComposer, SpecificationIdentity } from '../../src/index.js';
import { PythonDeclarations, pythonOptions } from '../../src/python-declarations.js';

function contracts(source: string) {
    const read = new LangiumReader().read({ sourceId: 'game.expec', text: source });
    if (read.status !== 'accepted') throw Error(JSON.stringify(read));
    const compiled = new Compiler().compile({ resolution: new SourceComposer().compose(new LangiumModel('game', read.document), { modules: [], packages: [] }) });
    if (!compiled.value) throw Error(JSON.stringify(compiled));
    let next = 0;
    const identified = new SpecificationIdentity(() => 'construction-' + ++next).associate(compiled.value);
    if (!identified.value) throw Error(JSON.stringify(identified));
    const declarations = new PythonDeclarations(identified.value, pythonOptions.parse({ module: 'store.contracts' }));
    return { current: identified.value, rendered: declarations.render(), problems: declarations.problems };
}
describe('Python declaration associations', () => {
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
