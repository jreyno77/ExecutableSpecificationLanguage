import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { PythonAcceptanceDriver } from './python-acceptance.js';

export class PythonFixtureDriver extends PythonAcceptanceDriver {
  private fixture = '';
  reports: { phase: string; outcome: string; detail: string }[] = [];
  async useFixture(options: { copies?: number; finalizer?: boolean; setupFails?: boolean; cleanupFails?: boolean; async?: boolean; requiredConstructor?: boolean; name?: string; scope?: string; result?: 'str' | 'Any' } = {}): Promise<void> {
    await this.useExistingBasketDriver({ copies: options.copies ?? 1, requiredConstructorArgument: options.requiredConstructor ?? false });
    const name = options.name ?? 'shopping', construct = 'Shopping(HandwrittenShopping(' + (options.requiredConstructor ? '"local configuration"' : '') + '))';
    const release = 'server.close()\nPath("socket-closed").write_text(str(server.fileno()))' + (options.cleanupFails ? '\nraise RuntimeError("cleanup failed")' : '');
    const body = 'server = socket.socket()\nserver.bind(("127.0.0.1", 0))\nserver.listen()\nPath("socket.json").write_text(json.dumps(server.getsockname()))\n'
      + (options.finalizer ? 'def close() -> None:\n' + release.split('\n').map(line => '    ' + line).join('\n') + '\nrequest.addfinalizer(close)\n'
        + (options.setupFails ? 'raise RuntimeError("setup failed")' : 'return ' + construct)
        : 'try:\n    yield ' + construct + '\nfinally:\n' + release.split('\n').map(line => '    ' + line).join('\n'));
    this.fixture = 'from collections.abc import Iterator\nfrom typing import Any\nimport json\nimport socket\nfrom pathlib import Path\nimport pytest\nfrom pytest import fixture as native_fixture\nfrom dsl.shopping import Shopping\nfrom driver.existing import HandwrittenShopping\n\n'
      + '@native_fixture(' + (options.name ? 'name=' + JSON.stringify(name) : '') + (options.scope ? (options.name ? ', ' : '') + 'scope=' + JSON.stringify(options.scope) : '') + ')\n'
      + (options.async ? 'async ' : '') + 'def provide_shopping(' + (options.finalizer ? 'request: pytest.FixtureRequest' : '') + ') -> '
      + (options.result ?? (options.finalizer ? 'Shopping' : 'Iterator[Shopping]')) + ':\n'
      + (options.result ? '    return "wrong fixture"' : body.split('\n').map(line => '    ' + line).join('\n')) + '\n';
    await this.file('test/driver/resources.py', this.fixture); await this.file('test/conftest.py', '# Existing pytest settings stay here.\n');
    this.acceptanceOptions = { ...this.acceptanceOptions, fixture: { outputId: 'python-acceptance', format: 'python-symbol-1', value: {
      file: 'test/driver/resources.py', declaration: [{ kind: 'function', name: 'provide_shopping' }],
    } } };
  }
  async runFixture(): Promise<void> {
    const sites = join(this.root, '.venv', ...(process.platform === 'win32' ? ['Lib', 'site-packages'] : ['lib', 'python3.12', 'site-packages']));
    this.runtime = await this.python(`import sys, os, json
from pathlib import Path
sys.path[:0] = sys.argv[1:4]
os.environ['PYTEST_DISABLE_PLUGIN_AUTOLOAD'] = '1'
os.environ.pop('PYTEST_ADDOPTS', None)
os.environ.pop('PYTEST_PLUGINS', None)
import pytest
reports = []
class Observations:
    def pytest_runtest_logreport(self, report):
        reports.append({'phase': report.when, 'outcome': report.outcome, 'detail': str(report.longrepr) if report.failed else ''})
status = pytest.main(['-q', '-p', 'no:cacheprovider', '--rootdir', sys.argv[4], sys.argv[5]], plugins=[Observations()])
Path('native-phases.json').write_text(json.dumps(reports))
sys.exit(status)`, [sites, join(this.root, 'src'), join(this.root, 'test'), this.root, join(this.root, 'test/acceptance/test_shopping.py')]);
    this.reports = JSON.parse(await fs.readFile(join(this.root, 'native-phases.json'), 'utf8')) as typeof this.reports;
  }
  async shadowDsl(): Promise<void> {
    await this.file('src/dsl/__init__.py', '');
    await this.file('src/dsl/comparison.py', 'unused = True\n');
    await this.file('src/dsl/shopping.py', 'def _expec_fixture(value: object) -> None: pass\n\nclass Shopping:\n    def __init__(self, driver: object) -> None: pass\n'
      + '    def bookIsAvailable(self, title: str) -> None: pass\n    def startWithEmptyBasket(self) -> None: pass\n'
      + '    def addBook(self, title: str) -> None: pass\n    def expectBookQuantity(self, title: str, expected: float) -> None: pass\n');
  }
  async replaceFixtureDecorator(): Promise<void> {
    this.fixture = this.fixture.replace('from pytest import fixture as native_fixture', 'from typing import Callable\ndef native_fixture() -> Callable[[object], object]:\n    return lambda function: function');
    await this.file('test/driver/resources.py', this.fixture);
  }
  private async suppliedReceiver(body: string, declaration = ''): Promise<void> {
    const original = '        yield Shopping(HandwrittenShopping())';
    if (!this.fixture.includes(original)) throw Error('Arrange the ordinary yielded Shopping fixture first.');
    this.fixture = this.fixture.replace(original, body.split('\n').map(line => '        ' + line).join('\n'))
      .replace('@native_fixture(', declaration + '@native_fixture(');
    await this.file('test/driver/resources.py', this.fixture);
  }
  returnDerivedDslWithEmptyQuantityCheck(): Promise<void> {
    return this.suppliedReceiver('yield EmptyChecks(HandwrittenShopping())',
      'class EmptyChecks(Shopping):\n    def expectBookQuantity(self, title: str, expected: float) -> None:\n        pass\n\n');
  }
  replaceQuantityCheckOnReturnedInstance(): Promise<void> {
    return this.suppliedReceiver('receiver = Shopping(HandwrittenShopping())\nreceiver.expectBookQuantity = lambda title, expected: None\nyield receiver');
  }
  replaceQuantityCheckOnGeneratedClassDuringSetup(): Promise<void> {
    return this.suppliedReceiver('def empty_quantity_check(self: Shopping, title: str, expected: float) -> None:\n    pass\nShopping.expectBookQuantity = empty_quantity_check\nyield Shopping(HandwrittenShopping())');
  }
  async retainedFixture(): Promise<boolean> {
    return await fs.readFile(join(this.root, 'test/driver/resources.py'), 'utf8') === this.fixture
      && await fs.readFile(join(this.root, 'test/conftest.py'), 'utf8') === '# Existing pytest settings stay here.\n';
  }
  async closedSocket(): Promise<void> {
    if (await fs.readFile(join(this.root, 'socket-closed'), 'utf8') !== '-1') throw Error('The actual fixture did not close its socket.');
    const [host, port] = JSON.parse(await fs.readFile(join(this.root, 'socket.json'), 'utf8')) as [string, number];
    const server = createServer();
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen({ host, port, exclusive: true }, () => server.close(error => error ? reject(error) : resolve())); });
  }
}
