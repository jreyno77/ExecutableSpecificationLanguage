import { afterEach, beforeAll, describe, it } from 'vitest';
import { PythonDelivery } from '../../../dsl/project/python/python-cli.js';

beforeAll(() => PythonDelivery.prepare(), 90_000);
afterEach(() => PythonDelivery.dispose(), 30_000);
describe('explicit Python installation through the CLI', { timeout: 240_000 }, () => {
  it('installs exact native requirements and retains a compatible lock offline', async () => {
    const p = await PythonDelivery.initialized();
    await p.requirePackage('packaging', 'pypi:packaging', '26.0', 'runtime');
    await p.install(); p.expectRequestedSelectedInstalled('packaging', '26.0', '26.0', '26.0');
    await p.expectNativeToolVersions({ uv: '0.12.23', pytest: '9.1.1', mypy: '2.4.0', jedi: '0.20.0', libcst: '1.9.0' });
    await p.rememberLock(); await p.installOffline(); await p.expectLockUnchanged();
  });
  it('refuses a conflicting handwritten requirement before native configuration changes', async () => {
    const p = await PythonDelivery.initialized();
    await p.nativeRequirement('packaging==25.0');
    await p.requirePackage('packaging', 'pypi:packaging', '26.0', 'runtime');
    await p.rememberNativeAndProjectFiles(); await p.install();
    p.expectProblem('native-dependency-conflict'); await p.expectNativeAndProjectFilesUnchanged();
  });
  it('reports actual partial effects without successful native availability', async () => {
    const p = await PythonDelivery.initialized();
    await p.requirePackage('missing', 'pypi:expec-absent-distribution-028452991', '1.0', 'runtime');
    await p.install(); await p.expectFailedInstallationWithActualEffects();
  });
});
