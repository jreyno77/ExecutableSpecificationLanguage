import { readFile, readdir, stat, unlink, utimes } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { ConfigurationReader, ProjectInitializer, Outputs, ProjectConnector, PythonContext, pythonOutput, pythonAcceptanceOutput, type Configuration, type ProjectSnapshot } from '../../src/index.js';
import { ConnectedBuildDriver } from './connected-build.js';

/** The ordinary compiled CLI, with explicit native tool paths and real starter files. */
export class PythonCliDriver extends ConnectedBuildDriver {
  static override async prepare(): Promise<void> {
    await super.prepare();
    await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../../src/python-build.mjs', import.meta.url))]);
  }
  async implementBasket(copies: number): Promise<void> {
    const source = await readFile(new URL('../resources/python/basket.py', import.meta.url), 'utf8');
    await this.write('project/src/basket.py', source.replace('COPIES_ADDED = 1', 'COPIES_ADDED = ' + copies));
    await this.write('project/test/driver/shopping_driver.py', `from basket import Basket

class ShoppingDriver:
    def __init__(self) -> None:
        self.basket = Basket()
    def bookIsAvailable(self, title: str) -> None:
        self.basket.offer(title)
    def startWithEmptyBasket(self) -> None:
        self.basket.empty()
    def addBook(self, title: str) -> None:
        self.basket.add(title)
    def bookQuantity(self, title: str) -> float:
        return float(self.basket.quantity(title))
`);
  }
  nativeSnapshot?: ProjectSnapshot;
  async captureNativeProject(): Promise<void> {
    const outputs = new Outputs(); outputs.register(pythonOutput); outputs.register(pythonAcceptanceOutput);
    const manifest = this.path('spec/expec.json');
    const configured = new ConfigurationReader(outputs.profiles).read({ sourceId: pathToFileURL(manifest).href, text: await readFile(manifest, 'utf8') });
    if (!configured.value) throw Error(JSON.stringify(configured.problems));
    const connected = await new ProjectConnector(manifest, { excludeNames: ['.git', 'node_modules', '.venv', '__pycache__', '.pytest_cache', '.mypy_cache', '.uv-cache'] }).connect(configured.value);
    if (connected.value?.status !== 'connected') throw Error(JSON.stringify(connected));
    this.nativeSnapshot = await new PythonContext(connected.value.context).readSnapshot();
  }
  cachedQuantity?: number;
  async cacheCurrentBasket(): Promise<void> {
    const file = this.path('project/src/basket.py');
    await promisify(execFile)(this.tools().python, ['-I', '-S', '-c', 'import py_compile,sys; py_compile.compile(sys.argv[1], doraise=True)', file]);
    const entries = await readdir(this.path('project/src/__pycache__'));
    if (!entries.some(name => name.startsWith('basket.') && name.endsWith('.pyc'))) throw Error('Native bytecode was not created.');
  }
  async staleBasketBytecode(copies: number): Promise<void> {
    const file = this.path('project/src/basket.py'), before = await stat(file);
    await this.cacheCurrentBasket(); await this.implementBasket(copies); await utimes(file, before.atime, before.mtime);
    const observed = await promisify(execFile)(this.tools().python, ['-I', '-S', '-c',
      'import sys; sys.path.insert(0,sys.argv[1]); from basket import Basket; b=Basket(); b.offer("Dune"); b.add("Dune"); print(b.quantity("Dune"))', this.path('project/src')]);
    this.cachedQuantity = Number(observed.stdout.trim());
  }
  async basketWritesData(path: string): Promise<void> {
    const file = 'project/src/basket.py', text = await readFile(this.path(file), 'utf8');
    await this.write(file, 'import json\nfrom pathlib import Path\n' + text.replace(
      '        self.items[title] = self.quantity(title) + COPIES_ADDED',
      '        self.items[title] = self.quantity(title) + COPIES_ADDED\n' +
      '        destination = Path(' + JSON.stringify(path) + ')\n' +
      '        destination.parent.mkdir(parents=True, exist_ok=True)\n' +
      '        destination.write_text(json.dumps(self.items), encoding="utf-8")'));
  }
  async basketChangesSource(): Promise<void> {
    const file = 'project/src/basket.py', text = await readFile(this.path(file), 'utf8');
    await this.write(file, 'from pathlib import Path\n' + text.replace(
      '        self.items[title] = self.quantity(title) + COPIES_ADDED',
      '        self.items[title] = self.quantity(title) + COPIES_ADDED\n' +
      '        source = Path(__file__)\n' +
      '        source.write_text(source.read_text(encoding="utf-8") + "\\n# Changed during the test\\n", encoding="utf-8")'));
  }
  async forgetScenarioAssociation(title: string): Promise<void> {
    const path = 'project/.expec/identity.json', ledger = JSON.parse(await readFile(this.path(path), 'utf8'));
    const selected = ledger.baseline.elements.find((item: { id: string; address: { kind: string; name: string } }) => item.address.kind === 'scenario' && item.address.name === title);
    if (!selected) throw Error('The actual confirmed scenario was unavailable: ' + title);
    const before = ledger.baseline.artifacts.length;
    ledger.baseline.artifacts = ledger.baseline.artifacts.filter((item: { specId: string; locator: { outputId: string } }) => item.specId !== selected.id || item.locator.outputId !== 'python-acceptance');
    if (before === ledger.baseline.artifacts.length) throw Error('The confirmed scenario had no artifact association to remove.');
    await this.write(path, JSON.stringify(ledger));
  }
  tools(): { python: string; uv: string } {
    const python = process.env.EXPEC_TEST_PYTHON, uv = process.env.EXPEC_TEST_UV;
    if (!python || !uv) throw Error('Provide the explicit Python and uv test executables.');
    return { python, uv };
  }
  async arrangeStarter(): Promise<void> {
    const manifest = this.path('spec/expec.json'), text = await readFile(manifest, 'utf8');
    const configuration = new ConfigurationReader([]).read({ sourceId: pathToFileURL(manifest).href, text });
    if (!configuration.value) throw Error(JSON.stringify(configuration.problems));
    const initializer = new ProjectInitializer(manifest, configuration.value);
    const plan = await initializer.prepare({ root: '../project', target: 'python', ...this.tools() });
    if (!plan.value) throw Error(JSON.stringify(plan.problems));
    const applied = await initializer.apply(plan.value, true);
    if (!applied.value) throw Error(JSON.stringify(applied.problems));
    const { sourceId: _sourceId, ...returned } = applied.value.configuration;
    this.manifest = structuredClone(returned); await this.saveManifest();
  }
  initializeThroughCli(): Promise<void> {
    const { python, uv } = this.tools();
    return this.run(['init', '--config', 'spec/expec.json', '--root', '../project', '--target', 'python', '--python', python, '--uv', uv, '--yes', '--json']);
  }
  async readonlySource(text: string): Promise<void> {
    await this.write('native-support/book_data.py', text);
    const profile = JSON.parse(await readFile(this.path('project/expec.python.json'), 'utf8'));
    profile.sourcePath = [this.path('native-support')];
    await this.write('project/expec.python.json', JSON.stringify(profile, null, 2));
  }
  async removeDistributionInventory(name: string): Promise<void> {
    const sites = 'project/.venv/' + (process.platform === 'win32' ? 'Lib/site-packages' : 'lib/python3.12/site-packages');
    for (const entry of await readdir(this.path(sites))) if (entry.endsWith('.dist-info')) {
      const metadata = await readFile(this.path(sites + '/' + entry + '/METADATA'), 'utf8');
      if (metadata.split(/\r?\n/).includes('Name: ' + name)) {
        await unlink(this.path(sites + '/' + entry + '/RECORD')); return;
      }
    }
    throw Error('The actually installed distribution was not found: ' + name);
  }
  async nativeRequirement(requirement: string): Promise<void> {
    const text = await readFile(this.path('project/pyproject.toml'), 'utf8');
    await this.write('project/pyproject.toml', text.replace('dependencies = []', 'dependencies = [' + JSON.stringify(requirement) + ']'));
  }
  async output(id: string, options: Record<string, unknown>): Promise<void> {
    const outputs = this.manifest.outputs as Configuration['outputs'];
    this.manifest.outputs = [...outputs.filter(output => output.id !== id), { id, options }]; await this.saveManifest();
  }
  async require(alias: string, name: string, version: string, phase: string): Promise<void> {
    const packages = (this.manifest.packages ?? []) as Configuration['packages'];
    this.manifest.packages = [...packages.filter(item => item.alias !== alias), { alias, name, version, phases: [phase] }]; await this.saveManifest();
  }
}
