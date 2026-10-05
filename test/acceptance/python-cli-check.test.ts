import { afterEach, beforeAll, describe, it } from 'vitest';
import { PythonDelivery } from '../dsl/python-cli.js';

beforeAll(() => PythonDelivery.prepare(), 90_000);
afterEach(() => PythonDelivery.dispose());
describe('the Python CLI checks actual native availability', { timeout: 360_000 }, () => {
  it('accepts the actual two-part Python version through the ordinary checked build entry', async () => {
    const p = await PythonDelivery.initialized();
    await p.requirePackage('packaging', 'pypi:packaging', '26.0', 'runtime');
    await p.install(); p.expectRequestedSelectedInstalled('packaging', '26.0', '26.0', '26.0');
    await p.check(); p.expectChecked();
  });
  it('rejects native ranges and keeps a nearby installed tooling release unavailable', async () => {
    const p = await PythonDelivery.initialized();
    await p.requirePackage('packaging', 'pypi:packaging', '^26.0.0', 'runtime');
    await p.rememberNativeAndProjectFiles(); await p.install();
    p.expectProblem('unsupported-package-version'); await p.expectNativeAndProjectFilesUnchanged();
    await p.expectNoEnvironmentInstalled();

    await p.requirePackage('packaging', 'pypi:packaging', '26.0', 'runtime');
    await p.install(); p.expectInstalled(); await p.expectNativePackageVersion('pytest', '9.1.1');
    await p.requirePackage('pytest', 'pypi:pytest', '9.1', 'test');
    await p.rememberNativeAndProjectFiles(); await p.check();
    p.expectProblem('python-tooling-required'); await p.expectNativeAndProjectFilesUnchanged();
    await p.expectNativePackageVersion('pytest', '9.1.1');
  });

  it('stops build and test after a requirement changes without syncing the environment', async () => {
    const p = await PythonDelivery.initialized();
    await p.requirePackage('packaging', 'pypi:packaging', '26.0', 'runtime'); await p.install();
    p.expectRequestedSelectedInstalled('packaging', '26.0', '26.0', '26.0'); await p.rememberInstalledEnvironment();
    await p.requirePackage('packaging', 'pypi:packaging', '25.0', 'runtime');
    await p.build(); await p.expectInstallRequiredWithoutEffects();
    await p.test(); await p.expectInstallRequiredWithoutEffects();
  });
});
