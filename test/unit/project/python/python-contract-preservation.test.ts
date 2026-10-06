import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runPython } from '../../../../src/project/python/python-process.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); }, 30_000);
const association = (id: string, name: string, member?: string) => ({ specId: id, locator: { outputId: 'python', format: 'python-symbol-1',
  value: { file: 'src/store.py', declaration: [{ kind: 'class', name }, ...member ? [{ kind: 'method', name: member }] : []] } } });
const game = 'class StoreGame:\n    def save(self, title: str) -> None:\n        raise NotImplementedError()\n';
const receipt = '\nclass Receipt:\n    pass\n';
const exports = (names: string[]) => '\n__all__ = ' + JSON.stringify(names) + '\n';
async function reconcile(before: string, after: string | undefined, current: string,
  previous: ReturnType<typeof association>[], next: ReturnType<typeof association>[], caller?: string,
  move?: { from: string; to: string; old: string; next: string }) {
  const python = process.env.EXPEC_TEST_PYTHON, sites = process.env.EXPEC_TEST_PYTHON_SITE;
  if (!python || !sites) throw Error('Provide the explicit Python interpreter and pinned Jedi/LibCST.');
  const temporary = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'expec-contract-unit-')); roots.push(temporary);
  const root = join(temporary, 'source'); await fs.mkdir(join(root, 'src'), { recursive: true });
  await fs.writeFile(join(root, 'src/store.py'), current);
  if (caller) await fs.writeFile(join(root, 'src/caller.py'), caller);
  await fs.writeFile(join(temporary, 'request.json'), JSON.stringify({ files: ['src/store.py', ...caller ? ['src/caller.py'] : []], rewrite: { before, after, previous, next, move } }));
  const result = await runPython(python, [fileURLToPath(new URL('../../../resources/python/preserve_contract.py', import.meta.url)), sites, root,
    fileURLToPath(new URL('../../../../src/project/python/resources/inspect.py', import.meta.url))], temporary);
  expect(result.code, result.error ?? result.text).toBe(0);
  return JSON.parse(result.text) as { generated?: string; rewritten: { file: string; text: string }[]; problems: { code: string; file: string; start?: number }[] };
}
describe('native Python contract preservation', () => {
  it('renames the class through actual aliases while retaining its implemented method', async () => {
    const before = game + exports(['StoreGame']), current = before.replace('raise NotImplementedError()', 'self.saved = title');
    const caller = 'from store import StoreGame as Game\ngame = Game()\ngame.save("Dune")\n';
    const result = await reconcile(before, before.replaceAll('StoreGame', 'StoreFront'), current,
      [association('game', 'StoreGame'), association('save', 'StoreGame', 'save')],
      [association('game', 'StoreFront'), association('save', 'StoreFront', 'save')], caller);
    expect(result.problems).toEqual([]);
    expect(result.rewritten.find(file => file.file === 'src/store.py')?.text).toBe(current.replaceAll('StoreGame', 'StoreFront'));
    expect(result.rewritten.find(file => file.file === 'src/caller.py')?.text).toBe(caller.replace('import StoreGame', 'import StoreFront'));
  });
  it('adds a top-level class and its required native import without rewriting a neighbor', async () => {
    const before = game + exports(['StoreGame']), neighbor = '\ndef neighbor():\n    return "keep"\n';
    const wanted = 'from typing import TypedDict\n\n' + game + '\nclass Receipt(TypedDict):\n    title: str\n' + exports(['StoreGame', 'Receipt']);
    const result = await reconcile(before, wanted, before + neighbor, [association('game', 'StoreGame')],
      [association('game', 'StoreGame'), association('receipt', 'Receipt')]);
    expect(result.problems).toEqual([]);
    const text = result.rewritten.find(file => file.file === 'src/store.py')?.text;
    expect(text).toContain('from typing import TypedDict'); expect(text).toContain('class Receipt(TypedDict):'); expect(text).toContain(neighbor);
  });
  it('retires an unused class and returns the remaining generated baseline', async () => {
    const before = game + receipt + exports(['StoreGame', 'Receipt']), neighbor = '\ndef neighbor():\n    return "keep"\n';
    const result = await reconcile(before, undefined, before + neighbor,
      [association('game', 'StoreGame'), association('receipt', 'Receipt')], [association('game', 'StoreGame')]);
    expect(result.problems).toEqual([]); expect(result.generated).not.toContain('class Receipt');
    expect(result.generated).toContain('__all__ = ["StoreGame"]');
    expect(result.rewritten.find(file => file.file === 'src/store.py')?.text).toContain(neighbor);
  });
  it('locates a use of a removed member rather than only its class import', async () => {
    const caller = 'from store import StoreGame\ncallback = StoreGame.save\n';
    const result = await reconcile(game, '', game, [association('game', 'StoreGame'), association('save', 'StoreGame', 'save')], [], caller);
    expect(result.problems).toContainEqual(expect.objectContaining({ code: 'native-reference-conflict', file: 'src/caller.py', start: caller.indexOf('save') }));
  });
  it('refuses a competing handwritten export list', async () => {
    const before = game + exports(['StoreGame']);
    const result = await reconcile(before, before.replaceAll('StoreGame', 'StoreFront'), before.replace('["StoreGame"]', '["StoreGame", "private"]'),
      [association('game', 'StoreGame')], [association('game', 'StoreFront')]);
    expect(result.problems.map(problem => problem.code)).toContain('output-conflict');
  });
  it('declares a new generic class after its actual runtime type variable', async () => {
    const before = game + exports(['StoreGame']);
    const wanted = 'from typing import Generic, TypeVar\n\n_Value = TypeVar("_Value")\n\n' + game
      + '\nclass Receipt(Generic[_Value]):\n    pass\n' + exports(['StoreGame', 'Receipt']);
    const result = await reconcile(before, wanted, before, [association('game', 'StoreGame')],
      [association('game', 'StoreGame'), association('receipt', 'Receipt')]);
    expect(result.problems).toEqual([]);
    const text = result.rewritten.find(file => file.file === 'src/store.py')!.text;
    const root = roots.at(-1)!; await fs.writeFile(join(root, 'generated.py'), text + '\nprint(type(Receipt()).__name__)\n');
    const executed = await runPython(process.env.EXPEC_TEST_PYTHON!, [join(root, 'generated.py')], root);
    expect(executed.code, executed.error).toBe(0); expect(executed.text.trim()).toBe('Receipt');
  });
  it('retires an unused parameter as part of the actual callable signature', async () => {
    const parameter = { ...association('title', 'StoreGame', 'save'), locator: { ...association('title', 'StoreGame', 'save').locator,
      value: { file: 'src/store.py', declaration: [{ kind: 'class', name: 'StoreGame' }, { kind: 'method', name: 'save' }, { kind: 'parameter', name: 'title' }] } } };
    const kept = [association('game', 'StoreGame'), association('save', 'StoreGame', 'save')];
    const result = await reconcile(game, undefined, game, [...kept, parameter], kept);
    expect(result.problems).toEqual([]);
    for (const text of [result.generated, result.rewritten.find(file => file.file === 'src/store.py')?.text]) {
      expect(text).toBeTypeOf('string');
      const root = roots.at(-1)!; await fs.writeFile(join(root, 'generated.py'), text + '\nimport inspect\nprint(list(inspect.signature(StoreGame.save).parameters))\n');
      const executed = await runPython(process.env.EXPEC_TEST_PYTHON!, [join(root, 'generated.py')], root);
      expect(executed.code, executed.error).toBe(0); expect(executed.text.trim()).toBe("['self']");
    }
  });
  it('keeps native module relocation valid while reconciling its own support', async () => {
    const before = game + exports(['StoreGame']), original = association('game', 'StoreGame');
    const next = { ...original, locator: { ...original.locator, value: { ...original.locator.value, file: 'src/moved.py' } } };
    const result = await reconcile(before, before, before, [original], [next], 'from store import StoreGame\ngame = StoreGame()\n',
      { from: 'src/store.py', to: 'src/moved.py', old: 'store', next: 'moved' });
    expect(result.problems).toEqual([]);
    expect(result.rewritten.find(file => file.file === 'src/moved.py')?.text).toBe(before);
    expect(result.rewritten.find(file => file.file === 'src/caller.py')?.text).toBe('from moved import StoreGame\ngame = StoreGame()\n');
  });
});
