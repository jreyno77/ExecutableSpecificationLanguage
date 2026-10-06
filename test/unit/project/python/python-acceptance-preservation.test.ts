import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runPython } from '../../../../src/project/python/python-process.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); }, 30_000);
async function preserve(before: string, desired: string, current: string, driver = false) {
  const python = process.env.EXPEC_TEST_PYTHON, sites = process.env.EXPEC_TEST_PYTHON_SITE;
  if (!python || !sites) throw Error('Provide the explicit Python interpreter and pinned LibCST.');
  const root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'expec-python-preservation-')); roots.push(root);
  await fs.writeFile(join(root, 'case.py'), current);
  await fs.writeFile(join(root, 'request.json'), JSON.stringify({ before, desired, driver }));
  const result = await runPython(python, [fileURLToPath(new URL('../../../resources/python/preserve_acceptance.py', import.meta.url)),
    sites, fileURLToPath(new URL('../../../../src/project/python/resources/integrity.py', import.meta.url)), root], root);
  expect(result.code, result.error ?? result.text).toBe(0);
  return JSON.parse(result.text) as { rewritten: { file: string; text: string }[]; problems: { code: string; message: string }[] };
}
const before = 'from checks import expect_data as check\n\ndef quantity(actual: float) -> None:\n    check(actual, 1.0)\n';
describe('preserving changes to owned Python examples', () => {
  it('changes the expected value while retaining the actual import alias, spacing and comments', async () => {
    const current = before.replace('as check', 'as compare').replace('    check(actual, 1.0)', '    # One copy.\n    compare( actual, 1.0 ) # quantity')
      + '\ndef neighbor() -> str:\n    return "human code"\n';
    const result = await preserve(before, before.replace('1.0', '2.0'), current);
    expect(result.problems).toEqual([]);
    expect(result.rewritten).toEqual([{ file: 'case.py', text: current.replace('1.0', '2.0') }]);
  });
  it('refuses existing drift even when desired output now contains that altered assertion', async () => {
    const after = before.replace('1.0', '2.0'), result = await preserve(before, after, after);
    expect(result.rewritten).toEqual([]); expect(result.problems.map(problem => problem.code)).toEqual(['generated-tests-changed']);
  });
  it('preserves a driver body while updating only its declared argument type', async () => {
    const before = 'class Driver:\n    def count(self, title: str) -> float:\n        raise NotImplementedError()\n';
    const current = before.replace('raise NotImplementedError()', '# Human implementation.\n        return float(len(title))');
    const result = await preserve(before, before.replace('title: str', 'title: float'), current, true);
    expect(result.problems).toEqual([]); expect(result.rewritten[0]?.text).toBe(current.replace('title: str', 'title: float'));
  });
  it('returns no partial edits for a structural addition that has no preserving strategy yet', async () => {
    const result = await preserve(before, before + '\ndef extra() -> None:\n    pass\n', before);
    expect(result.rewritten).toEqual([]); expect(result.problems.map(problem => problem.code)).toEqual(['unsupported-python-change']);
  });
});
