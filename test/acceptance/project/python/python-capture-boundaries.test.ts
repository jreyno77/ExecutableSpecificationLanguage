import { afterEach, describe, it } from 'vitest';
import { PythonCaptureBoundaries } from '../../../dsl/project/python/python-capture-boundaries.js';

afterEach(() => PythonCaptureBoundaries.dispose());
describe('Python capture distinguishes caches from omitted source', { timeout: 240_000 }, () => {
  it('ignores unrelated cache churn while capturing the actual native library', async () => {
    const p = await PythonCaptureBoundaries.connect(); await p.installCatalog();
    await p.file('.pytest_cache/noise', 'old'); await p.planRenameToShop();
    await p.file('.pytest_cache/noise', 'new'); await p.applyPlan();
    await p.expectRenamedWithLibraryCaptured();
  });
  it('refuses excluded selected source instead of treating it as missing', async () => {
    const p = await PythonCaptureBoundaries.connect();
    await p.file('src/store/__pycache__/hidden.py', 'class Hidden: pass\n');
    await p.buildContracts();
    await p.expectExcludedSourceRefused('src/store/__pycache__', 'class Hidden: pass\n');
  });
});
