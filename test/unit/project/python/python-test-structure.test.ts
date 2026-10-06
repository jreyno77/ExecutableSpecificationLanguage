import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runPython } from '../../../../src/project/python/python-process.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
const association = (id: string, name: string, owner?: string) => ({ specId: id, locator: { outputId: 'python-acceptance', format: 'python-symbol-1',
  value: { file: 'case.py', declaration: [...owner ? [{ kind: 'class', name: owner }] : [], { kind: owner ? 'method' : 'function', name }] } } });
async function reconcile(before: string, desired: string | undefined, current: string,
  previous: ReturnType<typeof association>[], next: ReturnType<typeof association>[], driver = false, facts?: unknown) {
  const python = process.env.EXPEC_TEST_PYTHON, sites = process.env.EXPEC_TEST_PYTHON_SITE;
  if (!python || !sites) throw Error('Provide the explicit Python interpreter and pinned LibCST.');
  const root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'expec-test-structure-')); roots.push(root);
  await fs.writeFile(join(root, 'case.py'), current);
  await fs.writeFile(join(root, 'request.json'), JSON.stringify({ before, desired, driver, identities: { previous, next }, facts }));
  const result = await runPython(python, [fileURLToPath(new URL('../../../resources/python/preserve_acceptance.py', import.meta.url)),
    sites, fileURLToPath(new URL('../../../../src/project/python/resources/integrity.py', import.meta.url)), root], root);
  expect(result.code, result.error ?? result.text).toBe(0);
  return JSON.parse(result.text) as { rewritten: { file: string; text: string }[]; problems: { code: string }[]; renamed: { before: string; after: string; survives: boolean }[] };
}
const first = 'def test_one() -> None:\n    assert 1 == 1\n';
const second = '\ndef test_two() -> None:\n    assert 2 == 2\n';
describe('identity-backed Python test structure', () => {
  it('retains renamed body references for the subsequent native binding comparison', async () => {
    const before = 'def original() -> int:\n    return 1\n\ndef caller() -> int:\n    return original()\n';
    const target = { file: 'case.py', line: 1, column: 4 };
    const facts = { declarations: [{ file: 'case.py', declaration: [{ kind: 'function', name: 'original' }], target }],
      uses: [{ file: 'case.py', owner: [{ kind: 'function', name: 'caller' }], name: 'original', start: 69, targets: [target] }] };
    expect(before.slice(69, 77)).toBe('original');
    const result = await reconcile(before, before.replaceAll('original', 'renamed'), before,
      [association('operation', 'original'), association('caller', 'caller')],
      [association('operation', 'renamed'), association('caller', 'caller')], false, facts);
    expect(result.problems).toEqual([]);
    expect(result.renamed).toEqual([{ before: 'original', after: 'renamed', survives: true }, { before: 'original', after: 'renamed', survives: true }]);
  });
  it('adds an identified function while retaining an unowned neighboring definition', async () => {
    const current = first + '\ndef neighbor():\n    return "human code"\n';
    const result = await reconcile(first, first + second, current, [association('one', 'test_one')], [association('one', 'test_one'), association('two', 'test_two')]);
    expect(result.problems).toEqual([]); expect(result.rewritten[0]?.text).toContain(current); expect(result.rewritten[0]?.text).toContain(second);
  });
  it('renames the same identity while retaining its handwritten explanation', async () => {
    const current = first.replace('    assert', '    # Keep this explanation.\n    assert');
    const result = await reconcile(first, first.replace('test_one', 'test_new'), current, [association('one', 'test_one')], [association('one', 'test_new')]);
    expect(result.problems).toEqual([]); expect(result.rewritten[0]?.text).toBe(current.replace('test_one', 'test_new'));
  });
  it('refuses an addition that would hide an imported native name', async () => {
    const before = 'from elsewhere import test_two\n\n' + first;
    const result = await reconcile(before, before + second, before, [association('one', 'test_one')], [association('one', 'test_one'), association('two', 'test_two')]);
    expect(result.problems.map(item => item.code)).toContain('native-name-conflict'); expect(result.rewritten).toEqual([]);
  });
  it('retains the handwritten driver body while adding an explicit operation stub', async () => {
    const before = 'class Driver:\n    def add(self) -> None:\n        raise NotImplementedError()\n';
    const current = before.replace('raise NotImplementedError()', '# Real operation.\n        print("add")');
    const desired = before + '\n    def price(self) -> float:\n        raise NotImplementedError("price")\n';
    const result = await reconcile(before, desired, current, [association('add', 'add', 'Driver')], [association('add', 'add', 'Driver'), association('price', 'price', 'Driver')], true);
    expect(result.problems).toEqual([]); expect(result.rewritten[0]?.text).toContain(current); expect(result.rewritten[0]?.text).toContain('raise NotImplementedError("price")');
  });
  it('adds the first driver operation to its existing empty class', async () => {
    const before = 'class Driver:\n    pass\n', desired = 'class Driver:\n    def price(self) -> float:\n        raise NotImplementedError("price")\n';
    const result = await reconcile(before, desired, before, [], [association('price', 'price', 'Driver')], true);
    expect(result.problems).toEqual([]); expect(result.rewritten[0]?.text).toContain('def price(self) -> float:');
  });
  it('refuses a whole-file retirement that would discard a handwritten neighbor', async () => {
    const current = first + '\ndef neighbor():\n    return "human code"\n';
    const result = await reconcile(first, undefined, current, [association('one', 'test_one')], []);
    expect(result.problems.map(item => item.code)).toContain('handwritten-removal'); expect(result.rewritten).toEqual([]);
  });
  it('keeps a different identity distinct even when its function has the same spelling', async () => {
    const current = first.replace('    assert', '    # Authored for the original case.\n    assert');
    const result = await reconcile(first, first, current, [association('one', 'test_one')], [association('replacement', 'test_one')]);
    expect(result.problems.map(item => item.code)).toContain('handwritten-removal'); expect(result.rewritten).toEqual([]);
  });
});
