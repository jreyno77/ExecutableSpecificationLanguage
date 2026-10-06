import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { Compiler, LangiumModel, LangiumReader, SourceComposer, SpecificationIdentity } from '../../../../src/index.js';
import { PythonExamples } from '../../../../src/project/python/python-examples.js';
import { runPython } from '../../../../src/project/python/python-process.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
function generated(fixtureName = 'provide_numbers') {
  const read = new LangiumReader().read({ sourceId: 'numbers.expec', text: 'examples { check verify() { assert false }\nexample "one": 1 => 1 }' });
  if (read.status !== 'accepted') throw Error(JSON.stringify(read));
  const compiled = new Compiler().compile({ resolution: new SourceComposer().compose(new LangiumModel('numbers', read.document), { modules: [], packages: [] }) });
  if (!compiled.value) throw Error(JSON.stringify(compiled));
  let next = 0;
  const identified = new SpecificationIdentity(() => 'number-' + ++next).associate(compiled.value);
  if (!identified.value) throw Error(JSON.stringify(identified));
  const output = new PythonExamples(identified.value, { domain: 'numbers', testRoot: 'test', names: [], imports: [] }, undefined, undefined, undefined,
    { file: 'test/driver/resources.py', module: 'driver.resources', name: fixtureName, parameter: 'numbers', generator: false });
  return { files: output.files(), problems: output.problems };
}
async function observe(code: string) {
  const python = process.env.EXPEC_TEST_PYTHON;
  if (!python) throw Error('Provide the explicit Python interpreter.');
  const root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'expec-fixture-admission-')); roots.push(root);
  const output = generated(); expect(output.problems).toEqual([]);
  for (const file of output.files) { const path = join(root, file.path); await fs.mkdir(join(path, '..'), { recursive: true }); await fs.writeFile(path, file.text); }
  await fs.copyFile(new URL('../../../../src/project/python/resources/comparison.py', import.meta.url), join(root, 'test/dsl/comparison.py'));
  return runPython(python, ['-c', 'import sys\nsys.path.insert(0, sys.argv[1])\nfrom dsl.numbers import Numbers, _expec_fixture\nfrom driver.numbers_driver import NumbersDriver\nreceiver = Numbers(NumbersDriver())\n' + code, join(root, 'test')], root);
}
describe('admitting the actual generated fixture receiver', () => {
  it('allows ordinary driver and data fields without executing the authored check', async () => {
    const result = await observe('receiver.driver = NumbersDriver()\nreceiver.note = "Dune"\n_expec_fixture(receiver)\nprint(receiver.note)');
    expect(result.code, result.text).toBe(0); expect(result.text.trim()).toBe('Dune');
  });
  it('detects replaced code on the same generated function object', async () => {
    const result = await observe('def no_check(self): pass\nNumbers.verify.__code__ = no_check.__code__\n_expec_fixture(receiver)');
    expect(result.code).not.toBe(0); expect(result.error).toContain('The generated fixture operation changed: verify');
  });
  it('refuses a changed lookup protocol without invoking that hook', async () => {
    const result = await observe('calls = []\ndef lookup(self, name):\n    calls.append(name)\n    return object.__getattribute__(self, name)\nNumbers.__getattribute__ = lookup\ntry:\n    _expec_fixture(receiver)\nexcept AssertionError as failure:\n    print(str(failure))\nprint(len(calls))');
    expect(result.code, result.text).toBe(0);
    expect(result.text.trim().split(/\r?\n/)).toEqual(['The generated fixture access protocol changed.', '0']);
  });
  it('refuses a selected fixture that would hide its generated admission function', () => {
    expect(generated('_expec_fixture').problems).toMatchObject([{ code: 'invalid-native-fixture' }]);
  });
  it('refuses a selected fixture that would hide the comparison module', () => {
    expect(generated('_expec').problems).toMatchObject([{ code: 'invalid-native-fixture' }]);
  });
});
