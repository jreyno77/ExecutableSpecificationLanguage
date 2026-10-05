import { afterEach, beforeAll, describe, it } from 'vitest';
import { PythonDelivery } from '../dsl/python-cli.js';

beforeAll(() => PythonDelivery.prepare(), 90_000);
afterEach(() => PythonDelivery.dispose());
describe('the Python CLI keeps native package phases explicit', () => {
  it('refuses a main source importing the actual test-only pytest distribution', async () => {
    const p = await PythonDelivery.initialized(); await p.install();
    await p.file('src/consumer.py', 'import pytest\n');
    await p.rememberInstalledEnvironment(); await p.check();
    await p.expectPhaseProblemAt('inaccessible-native-dependency', 'src/consumer.py', 'pytest');
  }, 360_000);
  it('uses the resolved local module rather than guessing package ownership from its name', async () => {
    const p = await PythonDelivery.initialized(); await p.install();
    await p.file('src/pytest.py', 'def local_value() -> str:\n    return "local"\n');
    await p.file('src/consumer.py', 'from pytest import local_value\n');
    await p.check(); p.expectChecked();
  }, 360_000);
  it('does not invent ownership when the resolved installed distribution has no file inventory', async () => {
    const p = await PythonDelivery.initialized(); await p.install();
    await p.removeDistributionInventory('pytest');
    await p.file('src/consumer.py', 'import pytest\n'); await p.check();
    await p.expectPhaseProblemAt('unknown-native-dependency', 'src/consumer.py', 'pytest');
  }, 360_000);
  it('does not let a test-only import escape through a standard-library reexport', async () => {
    const p = await PythonDelivery.initialized();
    await p.requirePackage('annotations', 'pypi:typing-extensions', '4.16.0', 'test'); await p.install(); p.expectInstalled();
    await p.file('src/consumer.py', 'from typing_extensions import Any\n'); await p.check();
    await p.expectPhaseProblemAt('inaccessible-native-dependency', 'src/consumer.py', 'typing_extensions');
  }, 360_000);
  it('admits explicitly supplied readonly source without inventing a distribution phase', async () => {
    const p = await PythonDelivery.initialized();
    await p.readonlySource('class Book:\n    title: str\n'); await p.install(); p.expectInstalled();
    await p.file('src/consumer.py', 'from book_data import Book\n'); await p.check(); p.expectChecked();
  }, 360_000);
  it('keeps ordinary native dependencies usable when no Expec phase was declared for them', async () => {
    const p = await PythonDelivery.initialized(); await p.install(); p.expectInstalled();
    await p.file('src/consumer.py', 'from packaging.version import Version\n'); await p.check(); p.expectChecked();
  }, 360_000);
});
