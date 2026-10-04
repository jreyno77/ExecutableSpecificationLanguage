import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { runPython } from '../../src/python-process.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function preserve(before: string, current: string, after: string, { added = [], retired = [], authored = [], caller = false }: {
  added?: string[]; retired?: string[]; authored?: string[]; caller?: boolean;
} = {}) {
  const python = process.env.EXPEC_TEST_PYTHON, sites = process.env.EXPEC_TEST_PYTHON_SITE;
  if (!python || !sites) throw new Error('Provide explicitly provisioned Python and pinned LibCST.');
  const root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'expec-python-preservation-')); roots.push(root);
  await fs.writeFile(join(root, 'game.py'), current);
  if (caller) await fs.writeFile(join(root, 'caller.py'), 'from game import StoreGame\nStoreGame().save("Dune")\n');
  const association = (id: string) => ({ specId: id, locator: { outputId: 'python', format: 'python-symbol-1', value: { file: 'game.py',
    declaration: [{ kind: 'class', name: 'StoreGame' }, ...id === 'StoreGame' ? [] : [{ kind: 'method', name: id }]] } } });
  const target = { file: 'game.py', line: 2, column: 8, name: 'save', builtin: false };
  const facts = { files: ['game.py', ...caller ? ['caller.py'] : []], declarations: [{ ...association('save').locator.value, target }],
    uses: caller ? [{ file: 'caller.py', name: 'save', start: 39, end: 43, member: true, targets: [target] }] : [] };
  const request = { before, after, authored, previous: ['StoreGame', 'save'].map(association), next: ['StoreGame', 'save', ...added].filter(id => !retired.includes(id)).map(association), facts };
  await fs.writeFile(join(root, 'request.json'), JSON.stringify(request));
  const run = await runPython(python, ['-c', 'import sys,json,pathlib,importlib.util; sys.path.insert(0,sys.argv[1]); spec=importlib.util.spec_from_file_location("expec_preservation",pathlib.Path(sys.argv[2])/"preservation.py"); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); root=pathlib.Path(sys.argv[3]); request=json.loads((root/"request.json").read_text()); print(json.dumps(module.preserve(request,root,request["facts"])))',
    sites, dirname(fileURLToPath(new URL('../../src/python/preservation.py', import.meta.url))), root], root);
  expect(run.code, run.error).toBe(0);
  const [files, problems] = JSON.parse(run.text) as [{ file: string; text: string }[], { code: string }[]]; return { files, problems };
}
const before = 'class StoreGame:\n    def save(self, title: str) -> None:\n        raise NotImplementedError()\n';
describe('native Python declaration edits', () => {
  it('refuses removing a parameter that carries a handwritten comment', async () => {
    const generated = 'class StoreGame:\n    def save(self, title: str, copies: float) -> None:\n        raise NotImplementedError()\n';
    const current = 'class StoreGame:\n    def save(\n        self,\n        title: str,\n        copies: float,  # Keep this copy rationale.\n    ) -> None:\n        raise NotImplementedError()\n';
    const result = await preserve(generated, current, before);
    expect(result.problems.map(problem => problem.code)).toContain('output-conflict'); expect(result.files).toEqual([]);
  });
  it('removes only an unreferenced unchanged generated method', async () => {
    const result = await preserve(before, before, 'class StoreGame:\n    pass\n', { retired: ['save'] });
    expect(result.problems).toEqual([]); expect(result.files[0]?.text).not.toContain('def save'); expect(result.files[0]?.text).toContain('class StoreGame:');
  });
  it('retains an implemented method instead of retiring it', async () => {
    const result = await preserve(before, before.replace('raise NotImplementedError()', 'self.saved = title'), 'class StoreGame:\n    pass\n', { retired: ['save'] });
    expect(result.problems.map(problem => problem.code)).toContain('output-conflict'); expect(result.files).toEqual([]);
  });
  it('retains an adopted method even when its body looks like a generated stub', async () => {
    const result = await preserve(before, before, 'class StoreGame:\n    pass\n', { retired: ['save'], authored: ['save'] });
    expect(result.problems.map(problem => problem.code)).toContain('output-conflict'); expect(result.files).toEqual([]);
  });
  it('retains a generated method used by an unowned native caller', async () => {
    const result = await preserve(before, before, 'class StoreGame:\n    pass\n', { retired: ['save'], caller: true });
    expect(result.problems.map(problem => problem.code)).toContain('native-reference-conflict'); expect(result.files).toEqual([]);
  });
  it('retains handwritten comments when a generated stub is retired', async () => {
    const result = await preserve(before, before.replace('raise NotImplementedError()', '# Keep my design note.\n        raise NotImplementedError()'), 'class StoreGame:\n    pass\n', { retired: ['save'] });
    expect(result.problems.map(problem => problem.code)).toContain('output-conflict'); expect(result.files).toEqual([]);
  });
  it('keeps an existing implementation while inserting a new method', async () => {
    const current = before.replace('raise NotImplementedError()', 'self.saved = title  # Keep me.');
    const result = await preserve(before, current, before + '\n    def reset(self) -> None:\n        raise NotImplementedError()\n', { added: ['reset'] });
    expect(result.problems).toEqual([]); expect(result.files[0]?.text).toContain('self.saved = title  # Keep me.'); expect(result.files[0]?.text).toContain('def reset(self) -> None:');
  });
  it('refuses ambiguous native class definitions instead of editing the last one', async () => {
    const result = await preserve(before, before + '\n' + before, before + '\n    def reset(self) -> None:\n        raise NotImplementedError()\n', { added: ['reset'] });
    expect(result.problems.map(problem => problem.code)).toContain('python-definition-unavailable'); expect(result.files).toEqual([]);
  });
  it('retains the UTF-8 BOM and CRLF when adding a member', async () => {
    const current = '\uFEFF# 🛒 keep the source encoding\r\n' + before.replaceAll('\n', '\r\n').replace('raise NotImplementedError()', 'self.saved = title  # Keep me.');
    const result = await preserve(before, current, before + '\n    def reset(self) -> None:\n        raise NotImplementedError()\n', { added: ['reset'] });
    expect(result.problems).toEqual([]); expect(result.files[0]?.text.startsWith('\uFEFF# 🛒 keep the source encoding\r\n')).toBe(true);
    expect(result.files[0]?.text).not.toMatch(/(?<!\r)\n/); expect(result.files[0]?.text).toContain('self.saved = title  # Keep me.\r\n');
  });
  it('keeps a handwritten default and parameter comment while changing its declared type', async () => {
    const generated = 'class StoreGame:\n    def save(self, title: str = None) -> None:\n        raise NotImplementedError()\n';
    const current = 'class StoreGame:\n    def save(\n        self,\n        title: str = choose_title(),  # Keep the author\'s default.\n    ) -> None:\n        self.saved = title\n';
    const result = await preserve(generated, current, generated.replace('title: str', 'title: float'));
    expect(result.problems).toEqual([]); expect(result.files[0]?.text).toBe(current.replace('title: str', 'title: float'));
  });
});
