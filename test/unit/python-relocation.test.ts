import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { runPython } from '../../src/python-process.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function move(source: string, from = 'store.contracts', to = 'store.api'): Promise<string> {
  const python = process.env.EXPEC_TEST_PYTHON, sites = process.env.EXPEC_TEST_PYTHON_SITE;
  if (!python || !sites) throw new Error('Provide explicitly provisioned Python and LibCST.');
  const root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'expec-python-relocation-')); roots.push(root);
  await fs.writeFile(join(root, 'source.py'), source);
  const run = await runPython(python, ['-c', 'import sys,pathlib,importlib.util; sys.path.insert(0,sys.argv[1]); import libcst; spec=importlib.util.spec_from_file_location("relocation",pathlib.Path(sys.argv[2])/"relocation.py"); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m); source=libcst.parse_module(pathlib.Path(sys.argv[3]).read_bytes()); sys.stdout.buffer.write(m.relocate(source,sys.argv[4],sys.argv[5],"store").bytes)', sites,
    dirname(fileURLToPath(new URL('../../src/python/relocation.py', import.meta.url))), join(root, 'source.py'), from, to], root);
  expect(run.code, run.error).toBe(0); return run.text;
}
describe('Python module import relocation', () => {
  it('keeps an explicit symbol alias and source bytes around its changed module', async () => {
    const source = '\uFEFF# 🛒 keep me\r\nfrom store.contracts import StoreGame as Game\r\ngame = Game()\r\n';
    expect(await move(source)).toBe(source.replace('store.contracts', 'store.api'));
  });
  it('keeps the local module alias used by its consumer', async () => {
    const source = 'import store.contracts as original\ngame = original.StoreGame()\n';
    expect(await move(source)).toBe('import store.api as original\ngame = original.StoreGame()\n');
  });
  it('updates the qualified use of an import without an alias', async () => {
    const source = 'import store.contracts\ngame = store.contracts.StoreGame()\n';
    expect(await move(source)).toBe('import store.api\ngame = store.api.StoreGame()\n');
  });
  it('keeps a relative import relative inside the same package', async () => {
    expect(await move('from .contracts import StoreGame\ngame = StoreGame()\n')).toBe('from .api import StoreGame\ngame = StoreGame()\n');
  });
  it('retains local shadowing while updating the outer module reference', async () => {
    const source = 'import store.contracts\ndef local(store):\n    return store.contracts.StoreGame()\ngame = store.contracts.StoreGame()\n';
    expect(await move(source)).toBe('import store.api\ndef local(store):\n    return store.contracts.StoreGame()\ngame = store.api.StoreGame()\n');
  });
  it('keeps a from-imported module available under its existing local name', async () => {
    expect(await move('from store import contracts\ngame = contracts.StoreGame()\n')).toBe('from store import api as contracts\ngame = contracts.StoreGame()\n');
  });
});
