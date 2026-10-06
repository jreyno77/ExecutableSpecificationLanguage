import { afterEach, beforeAll, describe, it } from 'vitest';
import { PythonDelivery } from '../../../dsl/project/python/python-cli.js';

beforeAll(() => PythonDelivery.prepare(), 90_000);
afterEach(() => PythonDelivery.dispose());
describe('the connected Python CLI', () => {
  it('initializes ordinary files and connects the original manifest without installing', async () => {
    const p = await PythonDelivery.emptyDestination();
    await p.init(); await p.expectConnectedStarterWithoutInstallation();
  });
  it('does not call an empty Python package request a usable installation', async () => {
    const p = await PythonDelivery.initialized();
    await p.removePackageRequirements(); await p.rememberNativeAndProjectFiles();
    await p.install(); p.expectProblem('python-tooling-required'); await p.expectNativeAndProjectFilesUnchanged();
  });
  it('does not apply Python offline acquisition to a documentation-only profile', async () => {
    const p = await PythonDelivery.emptyDestination();
    await p.rememberNativeAndProjectFiles(); await p.installOffline();
    p.expectProblem('unsupported-install-option'); await p.expectNativeAndProjectFilesUnchanged();
  });
  it('requires an explicit Python profile for pypi acquisition', async () => {
    const p = await PythonDelivery.initialized();
    await p.outputs([]); await p.rememberNativeAndProjectFiles();
    await p.install(); p.expectProblem('unsupported-native-profile');
    await p.expectNativeAndProjectFilesUnchanged();
  });
  it('does not guess between Python and TypeScript acquisition', async () => {
    const p = await PythonDelivery.initialized();
    await p.output('typescript', { directory: 'generated-typescript' });
    await p.rememberNativeAndProjectFiles(); await p.install();
    p.expectProblem('conflicting-native-profile'); await p.expectNativeAndProjectFilesUnchanged();
  });
  it('does not send an npm requirement to the Python manager', async () => {
    const p = await PythonDelivery.initialized();
    await p.requirePackage('tool', 'npm:typescript', '5.9.3', 'build');
    await p.rememberNativeAndProjectFiles(); await p.install();
    p.expectProblem('unsupported-package-ecosystem'); await p.expectNativeAndProjectFilesUnchanged();
  });
  it('requires both Python outputs to select the same native configuration', async () => {
    const p = await PythonDelivery.initialized();
    await p.output('python-acceptance', { domain: 'shopping', configFile: 'different.python.json' });
    await p.rememberNativeAndProjectFiles(); await p.install();
    p.expectProblem('conflicting-native-profile'); await p.expectNativeAndProjectFilesUnchanged();
  });
});
