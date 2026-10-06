import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { runPython } from '../../../../src/project/python/python-process.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function preserve(before: string, current: string, after: string, { added = [], retired = [], authored = [], caller = false, topLevel = false }: {
  added?: string[]; retired?: string[]; authored?: string[]; caller?: boolean; topLevel?: boolean;
} = {}) {
  const python = process.env.EXPEC_TEST_PYTHON, sites = process.env.EXPEC_TEST_PYTHON_SITE;
  if (!python || !sites) throw new Error('Provide explicitly provisioned Python and pinned LibCST.');
  const root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'expec-python-preservation-')); roots.push(root);
  await fs.writeFile(join(root, 'game.py'), current);
  if (caller) await fs.writeFile(join(root, 'caller.py'), 'from game import StoreGame\nStoreGame().save("Dune")\n');
  const association = (id: string) => ({ specId: id, locator: { outputId: 'python', format: 'python-symbol-1', value: { file: 'game.py',
    declaration: topLevel ? [{ kind: 'function', name: id }] : [{ kind: 'class', name: 'StoreGame' }, ...id === 'StoreGame' ? [] : [{ kind: 'method', name: id }]] } } });
  const target = { file: 'game.py', line: 2, column: 8, name: 'save', builtin: false };
  const facts = { files: ['game.py', ...caller ? ['caller.py'] : []], declarations: [{ ...association('save').locator.value, target }],
    uses: caller ? [{ file: 'caller.py', name: 'save', start: 39, end: 43, member: true, targets: [target] }] : [] };
  const owners = topLevel ? ['save'] : ['StoreGame', 'save'];
  const request = { before, after, authored, previous: owners.map(association), next: [...owners, ...added].filter(id => !retired.includes(id)).map(association), facts };
  await fs.writeFile(join(root, 'request.json'), JSON.stringify(request));
  const run = await runPython(python, ['-c', 'import sys,json,pathlib,importlib.util; sys.path.insert(0,sys.argv[1]); spec=importlib.util.spec_from_file_location("expec_preservation",pathlib.Path(sys.argv[2])/"preservation.py"); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); root=pathlib.Path(sys.argv[3]); request=json.loads((root/"request.json").read_text()); print(json.dumps(module.preserve(request,root,request["facts"])))',
    sites, dirname(fileURLToPath(new URL('../../../../src/project/python/resources/preservation.py', import.meta.url))), root], root);
  expect(run.code, run.error).toBe(0);
  const [files, problems] = JSON.parse(run.text) as [{ file: string; text: string }[], { code: string }[]]; return { files, problems };
}
const before = 'class StoreGame:\n    def save(self, title: str) -> None:\n        raise NotImplementedError()\n';
describe('native Python declaration edits', () => {
  it('updates contract comments after a supported decorator in place', async () => {
    const old = '    # Expec contract: promises "Saved to disk."\n', next = '    # Expec contract: promises "Persist using Supabase."\n';
    const generated = before.replace('    def save', old + '    def save');
    const current = generated.replace(old, '    # Keep this explanation.\n    @classmethod\n' + old).replace('raise NotImplementedError()', 'self.saved = title');
    const result = await preserve(generated, current, generated.replace(old, next), { authored: ['save'] });
    expect(result.problems).toEqual([]); expect(result.files[0]?.text).toBe(current.replace(old, next));
  });
  it('updates contract comments between recorded native decorators in place', async () => {
    const old = '    # Expec contract: ensures true\n', next = '    # Expec contract: requires true\n';
    const generated = before.replace('    def save', old + '    def save');
    const current = generated.replace(old, '    @classmethod\n' + old + '    @staticmethod\n').replace('raise NotImplementedError()', 'self.saved = title');
    const result = await preserve(generated, current, generated.replace(old, next), { authored: ['save'] });
    expect(result.problems).toEqual([]); expect(result.files[0]?.text).toBe(current.replace(old, next));
  });
  it('refuses an altered contract comment after a supported decorator', async () => {
    const old = '    # Expec contract: ensures true\n';
    const generated = before.replace('    def save', old + '    def save');
    const current = generated.replace(old, '    @classmethod\n' + old.replace('ensures true', 'ensures false'));
    const result = await preserve(generated, current, generated.replace('ensures true', 'requires true'), { authored: ['save'] });
    expect(result.problems.map(problem => problem.code)).toContain('output-conflict'); expect(result.files).toEqual([]);
  });
  it('refuses a duplicated contract block across decorator regions', async () => {
    const old = '    # Expec contract: ensures true\n';
    const generated = before.replace('    def save', old + '    def save');
    const result = await preserve(generated, generated.replace(old, old + '    @classmethod\n' + old), generated.replace('ensures true', 'requires true'), { authored: ['save'] });
    expect(result.problems.map(problem => problem.code)).toContain('output-conflict'); expect(result.files).toEqual([]);
  });
  it('refuses a contract block split across decorator regions', async () => {
    const first = '    # Expec contract: requires true\n', second = '    # Expec contract: ensures true\n';
    const generated = before.replace('    def save', first + second + '    def save');
    const result = await preserve(generated, generated.replace(first + second, first + '    @classmethod\n' + second), generated.replace('ensures true', 'ensures false'), { authored: ['save'] });
    expect(result.problems.map(problem => problem.code)).toContain('output-conflict'); expect(result.files).toEqual([]);
  });
  it('updates a first top-level callable without moving its shebang, license or imports', async () => {
    const old = '# Expec contract: promises "Saved to disk."\n', next = '# Expec contract: promises "Persist using Supabase."\n';
    const callable = 'def save(title: str) -> None:\n    saved = title  # Keep implementation.\n';
    const generated = 'from __future__ import annotations\n\n' + old + callable;
    const current = '#!/usr/bin/env python3\n# Copyright the author.\n\n' + old + callable + '\nimport math  # Keep import.\n';
    const result = await preserve(generated, current, generated.replace(old, next), { topLevel: true, authored: ['save'] });
    expect(result.problems).toEqual([]); expect(result.files[0]?.text).toBe(current.replace(old, next));
  });
  it('refuses an altered contract block in an adopted first top-level callable header', async () => {
    const old = '# Expec contract: promises "Saved to disk."\n';
    const callable = 'def save(title: str) -> None:\n    saved = title\n';
    const generated = 'from __future__ import annotations\n\n' + old + callable;
    const current = '# Keep header.\n' + old.replace('Saved to disk.', 'Handwritten replacement.') + callable;
    const result = await preserve(generated, current, generated.replace('Saved to disk.', 'Persist using Supabase.'), { topLevel: true, authored: ['save'] });
    expect(result.problems.map(problem => problem.code)).toContain('output-conflict'); expect(result.files).toEqual([]);
  });
  it('refuses duplicated contract comments in a first top-level callable header', async () => {
    const old = '# Expec contract: ensures true\n', callable = 'def save(title: str) -> None:\n    saved = title\n';
    const generated = 'from __future__ import annotations\n\n' + old + callable;
    const result = await preserve(generated, old + old + callable, generated.replace('ensures true', 'requires true'), { topLevel: true, authored: ['save'] });
    expect(result.problems.map(problem => problem.code)).toContain('output-conflict'); expect(result.files).toEqual([]);
  });
  it('updates a first top-level generated contract when both baselines store it in the header', async () => {
    const generated = '# Expec contract: ensures true\ndef save(title: str) -> None:\n    raise NotImplementedError()\n';
    const desired = generated.replace('ensures true', 'requires true');
    const result = await preserve(generated, generated, desired, { topLevel: true });
    expect(result.problems).toEqual([]); expect(result.files[0]?.text).toBe(desired);
  });
  it('updates only recorded contract comments while retaining handwritten prose and body', async () => {
    const old = '    # Expec contract: promises "Saved to disk."\n';
    const next = '    # Expec contract: promises "Persist using Supabase."\n';
    const generated = before.replace('    def save', old + '    def save');
    const current = generated.replace(old, '    # Keep this design note.\n' + old)
      .replace('raise NotImplementedError()', '"""Keep the handwritten docstring."""\n        self.saved = title  # Keep the actual implementation.');
    const result = await preserve(generated, current, generated.replace(old, next));
    expect(result.problems).toEqual([]); expect(result.files[0]?.text).toBe(current.replace(old, next));
  });
  it('adds an authored contract comment without replacing handwritten leading prose', async () => {
    const next = '    # Expec contract: ensures true\n';
    const current = before.replace('    def save', '    # Handwritten explanation.\n    def save');
    const result = await preserve(before, current, before.replace('    def save', next + '    def save'));
    expect(result.problems).toEqual([]); expect(result.files[0]?.text).toBe(current.replace('    def save', next + '    def save'));
  });
  it('removes a retired contract comment without discarding a neighboring handwritten note', async () => {
    const old = '    # Expec contract: ensures true\n';
    const generated = before.replace('    def save', old + '    def save');
    const current = generated.replace(old, '    # Keep this note.\n' + old);
    const result = await preserve(generated, current, before);
    expect(result.problems).toEqual([]); expect(result.files[0]?.text).toBe(current.replace(old, ''));
  });
  it('refuses overwriting an edited generated contract comment', async () => {
    const old = '    # Expec contract: promises "Saved to disk."\n';
    const generated = before.replace('    def save', old + '    def save');
    const result = await preserve(generated, generated.replace('Saved to disk.', 'Save elsewhere.'), generated.replace('Saved to disk.', 'Persist using Supabase.'));
    expect(result.problems.map(problem => problem.code)).toContain('output-conflict'); expect(result.files).toEqual([]);
  });
  it('refuses ambiguous duplicated generated contract comments', async () => {
    const old = '    # Expec contract: ensures true\n';
    const generated = before.replace('    def save', old + '    def save');
    const result = await preserve(generated, generated.replace(old, old + old), generated.replace('ensures true', 'requires true'));
    expect(result.problems.map(problem => problem.code)).toContain('output-conflict'); expect(result.files).toEqual([]);
  });
  it('can add first owned documentation on an explicitly adopted declaration update', async () => {
    const old = '    # Expec contract: promises "Saved to disk."\n';
    const next = '    # Expec contract: promises "Persist using Supabase."\n';
    const generated = before.replace('    def save', old + '    def save');
    const current = before.replace('raise NotImplementedError()', 'self.saved = title');
    const result = await preserve(generated, current, generated.replace(old, next), { authored: ['save'] });
    expect(result.problems).toEqual([]); expect(result.files[0]?.text).toBe(current.replace('    def save', next + '    def save'));
  });
  it('does not treat removed owned documentation as initial adoption', async () => {
    const old = '    # Expec contract: promises "Saved to disk."\n';
    const generated = before.replace('    def save', old + '    def save');
    const result = await preserve(generated, before, generated.replace('Saved to disk.', 'Persist using Supabase.'));
    expect(result.problems.map(problem => problem.code)).toContain('output-conflict'); expect(result.files).toEqual([]);
  });

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
