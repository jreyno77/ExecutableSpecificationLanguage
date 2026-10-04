import { describe, expect, it } from 'vitest';
import { Compiler, LangiumModel, LangiumReader, SourceComposer, SpecificationIdentity } from '../../src/index.js';
import { PythonExamples } from '../../src/python-examples.js';

function examples(source: string, domain = 'numbers') {
  const read = new LangiumReader().read({ sourceId: 'numbers.expec', text: source });
  if (read.status !== 'accepted') throw Error(JSON.stringify(read));
  const compiled = new Compiler().compile({ resolution: new SourceComposer().compose(new LangiumModel('numbers', read.document), { modules: [], packages: [] }) });
  if (!compiled.value) throw Error(JSON.stringify(compiled));
  let next = 0;
  const identified = new SpecificationIdentity(() => 'number-' + ++next).associate(compiled.value);
  if (!identified.value) throw Error(JSON.stringify(identified));
  const result = new PythonExamples(identified.value, { domain, testRoot: 'test', names: [], imports: [] });
  return { files: result.files(), problems: result.problems };
}
describe('readable Python operation names remain valid native declarations', () => {
  it('refuses a parameter that collides with the native self receiver', () => {
    const result = examples('examples { observation quantity(self: Number) returns Number }');
    expect(result.problems).toMatchObject([{ code: 'native-name-conflict', message: expect.stringContaining('self') }]);
  });
  it('refuses a domain that would overwrite its own comparison runtime', () => {
    const result = examples('examples { example "one": 1 => 1 }', 'comparison');
    expect(result.problems).toMatchObject([{ code: 'native-name-conflict', message: expect.stringContaining('comparison') }]);
  });
  it('refuses an authored local that shadows the generated receiver', () => {
    const result = examples('examples { observation quantity() returns Number { let self = 1\nreturn self } }');
    expect(result.problems).toMatchObject([{ code: 'native-name-conflict', message: expect.stringContaining('self') }]);
  });
  it('refuses an authored local that shadows comparison admission', () => {
    const result = examples('examples { observation quantity() returns Number { let _expec = 1\nreturn _expec } }');
    expect(result.problems).toMatchObject([{ code: 'native-name-conflict', message: expect.stringContaining('_expec') }]);
  });
});
