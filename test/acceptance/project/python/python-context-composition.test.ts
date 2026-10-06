import { afterEach, describe, it } from 'vitest';
import { PythonInspection } from '../../../dsl/project/python/python-project.js';

afterEach(() => PythonInspection.dispose(), 30_000);
describe('Python composes with another project context', { timeout: 120_000 }, () => {
  it('retains upstream evidence without treating it as Python source', async () => {
    const p = await PythonInspection.connect(); await p.upstreamFile();
    await p.file('src/game.py', 'class StoreGame:\n    def save(self, title: str) -> None:\n        pass\n');
    p.mapMethod('save', 'src/game.py', 'StoreGame', 'save');
    await p.capture(); p.expectUpstreamFingerprintRetained();
    await p.search('save'); p.expectDefinition('src/game.py', 'StoreGame', 'save'); p.expectInspectedFiles(['src/game.py']);
  });
  it('refuses two different versions of the same selected native file', async () => {
    const p = await PythonInspection.connect(); await p.upstreamFile(true);
    await p.capture(); p.expectConflictingFingerprint();
  });
});
