import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { runPython } from '../../src/python-process.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function preserve(before: string, current: string, after: string, added: string[] = []) {
  const python = process.env.EXPEC_TEST_PYTHON, sites = process.env.EXPEC_TEST_PYTHON_SITE;
  if (!python || !sites) throw new Error('Provide explicitly provisioned Python and pinned LibCST.');
  const root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'expec-python-preservation-')); roots.push(root);
  await fs.writeFile(join(root, 'game.py'), current);
  const association = (id: string) => ({ specId: id, locator: { outputId: 'python', format: 'python-symbol-1', value: { file: 'game.py',
    declaration: [{ kind: 'class', name: 'StoreGame' }, ...id === 'StoreGame' ? [] : [{ kind: 'method', name: id }]] } } });
  const request = { before, after, previous: ['StoreGame', 'save'].map(association), next: ['StoreGame', 'save', ...added].map(association) };
  await fs.writeFile(join(root, 'request.json'), JSON.stringify(request));
  const run = await runPython(python, ['-c', 'import sys,json,pathlib,importlib.util; sys.path.insert(0,sys.argv[1]); spec=importlib.util.spec_from_file_location("expec_preservation",pathlib.Path(sys.argv[2])/"preservation.py"); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); root=pathlib.Path(sys.argv[3]); print(json.dumps(module.preserve(json.loads((root/"request.json").read_text()),root)))',
    sites, dirname(fileURLToPath(new URL('../../src/python/preservation.py', import.meta.url))), root], root);
  expect(run.code, run.error).toBe(0);
  const [files, problems] = JSON.parse(run.text) as [{ file: string; text: string }[], { code: string }[]]; return { files, problems };
}
const before = 'class StoreGame:\n    def save(self, title: str) -> None:\n        raise NotImplementedError()\n';
describe('native Python declaration edits', () => {
  it('keeps an existing implementation while inserting a new method', async () => {
    const current = before.replace('raise NotImplementedError()', 'self.saved = title  # Keep me.');
    const result = await preserve(before, current, before + '\n    def reset(self) -> None:\n        raise NotImplementedError()\n', ['reset']);
    expect(result.problems).toEqual([]); expect(result.files[0]?.text).toContain('self.saved = title  # Keep me.'); expect(result.files[0]?.text).toContain('def reset(self) -> None:');
  });
  it('refuses ambiguous native class definitions instead of editing the last one', async () => {
    const result = await preserve(before, before + '\n' + before, before + '\n    def reset(self) -> None:\n        raise NotImplementedError()\n', ['reset']);
    expect(result.problems.map(problem => problem.code)).toContain('python-definition-unavailable'); expect(result.files).toEqual([]);
  });
});
