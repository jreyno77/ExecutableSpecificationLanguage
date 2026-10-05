import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runPython } from '../../src/project/python/python-process.js';

async function conflicts(change: 'same' | 'lost' | 'kind'): Promise<string[]> {
  const python = process.env.EXPEC_TEST_PYTHON, sites = process.env.EXPEC_TEST_PYTHON_SITE;
  if (!python || !sites) throw Error('Provide the explicit Python interpreter and pinned LibCST.');
  const result = await runPython(python, [fileURLToPath(new URL('../resources/python/check_bindings.py', import.meta.url)), sites,
    fileURLToPath(new URL('../../src/project/python/runtime/bindings.py', import.meta.url)), change], process.cwd());
  expect(result.code, result.error ?? result.text).toBe(0);
  return (JSON.parse(result.text) as { code: string }[]).map(problem => problem.code);
}
describe('surviving Python reference targets', () => {
  it('retains the same two possible local declarations without inventing certainty', async () => { expect(await conflicts('same')).toEqual([]); });
  it('refuses an edit that loses a possible native declaration', async () => { expect(await conflicts('lost')).toEqual(['native-binding-conflict']); });
  it('refuses an edit that changes the kind of a native declaration', async () => { expect(await conflicts('kind')).toEqual(['native-binding-conflict']); });
});
