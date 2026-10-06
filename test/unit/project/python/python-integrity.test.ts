import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runPython } from '../../../../src/project/python/python-process.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function changed(before: string, current: string, driver = false): Promise<boolean> {
  const python = process.env.EXPEC_TEST_PYTHON, sites = process.env.EXPEC_TEST_PYTHON_SITE;
  if (!python || !sites) throw Error('Provide the explicit Python interpreter and pinned LibCST.');
  const root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'expec-python-integrity-')); roots.push(root);
  await fs.writeFile(join(root, 'case.py'), current);
  await fs.writeFile(join(root, 'request.json'), JSON.stringify([{ file: 'case.py', text: before, driver }]));
  const result = await runPython(python, ['-c', 'import sys,pathlib,json,importlib.util; sys.path.insert(0,sys.argv[1]); spec=importlib.util.spec_from_file_location("integrity",sys.argv[2]); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); root=pathlib.Path(sys.argv[3]); print(json.dumps(module.check(json.loads((root/"request.json").read_text()),root)))',
    sites, fileURLToPath(new URL('../../../../src/project/python/resources/integrity.py', import.meta.url)), root], root);
  expect(result.code, result.error ?? result.text).toBe(0);
  const problems = JSON.parse(result.text) as { code: string }[];
  expect(problems.every(problem => problem.code === 'generated-tests-changed')).toBe(true);
  return !!problems.length;
}
const before = 'from checks import expect_data as check\n\ndef quantity(actual: float, expected: float = 1.0) -> None:\n    check(actual, expected)\n';
describe('owned Python acceptance meaning', () => {
  it('retains comments, spacing, equivalent resolved imports and an unrelated neighbor', async () => {
    const current = '# Keep my explanation.\n' + before.replace('as check', 'as compare').replace('    check(actual, expected)', '    compare( actual, expected )  # one copy')
      + '\ndef neighbor() -> str:\n    return "human code"\n';
    expect(await changed(before, current)).toBe(false);
  });
  it('detects an erased assertion', async () => { expect(await changed(before, before.replace('check(actual, expected)', 'pass'))).toBe(true); });
  it('detects a changed expected value', async () => { expect(await changed(before, before.replace('check(actual, expected)', 'check(actual, 2.0)'))).toBe(true); });
  it('does not confuse a shadowed import with its native comparison target', async () => {
    expect(await changed(before, before.replace('    check(actual, expected)', '    check = lambda *_: None\n    check(actual, expected)'))).toBe(true);
  });
  it('protects authored defaults and decorators', async () => {
    expect(await changed(before, before.replace('expected: float = 1.0', 'expected: float = 2.0'))).toBe(true);
    expect(await changed(before, before.replace('def quantity', '@skip\ndef quantity'))).toBe(true);
  });
  it('protects class lifecycle headers and module setup', async () => {
    const source = 'class Shopping:\n    def ready(self) -> None:\n        pass\n';
    expect(await changed(source, source.replace('class Shopping:', 'class Shopping(Shared):'))).toBe(true);
    expect(await changed(source, source + '\nShopping.ready = lambda self: None\n')).toBe(true);
  });
  it('allows a real driver implementation while retaining its declared signature', async () => {
    const stub = 'class Driver:\n    def count(self, title: str) -> float:\n        raise NotImplementedError()\n';
    expect(await changed(stub, stub.replace('raise NotImplementedError()', 'return float(len(title))'), true)).toBe(false);
    expect(await changed(stub, stub.replace('title: str', 'title: bool'), true)).toBe(true);
  });
  it('does not grant a handwritten exemption to an ordinary owned body', async () => {
    expect(await changed(before, before.replace('check(actual, expected)', 'return None'))).toBe(true);
  });
  it('detects a duplicate declaration and an added native lookup protocol', async () => {
    expect(await changed(before, before + before)).toBe(true);
    const source = 'class Shopping:\n    def ready(self) -> None:\n        pass\n';
    expect(await changed(source, source + '    def __getattribute__(self, name: str):\n        return lambda: None\n')).toBe(true);
  });
});
