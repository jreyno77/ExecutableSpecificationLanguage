import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { PythonProjectDriver } from './python-project.js';
import { FileProjectWriter, pythonAcceptanceOutput, type ProjectRead, type ProjectFile, type SpecDiff } from '../../src/index.js';

export class PythonAcceptanceDriver extends PythonProjectDriver {
  scenario = '';
  remembered: readonly ProjectFile[] = [];
  scenarioRead!: ProjectRead;
  protected acceptanceOptions: Record<string, unknown> = {};
  private selectedDriver = '';
  catalogDsl = '';
  private diff!: SpecDiff;
  async initializeAcceptance(): Promise<void> { await this.initialize(); await this.installFixture(); this.outputs.register(pythonAcceptanceOutput); }
  authorShopping(title: string, expected: number): void {
    this.source(`examples {
  setup bookIsAvailable(title: Text) returns Nothing
  setup startWithEmptyBasket() returns Nothing
  action addBook(title: Text) returns Nothing
  observation bookQuantity(title: Text) returns Number
  check expectBookQuantity(title: Text, expected: Number) {
    let actual = bookQuantity(title)
    assert actual == expected
  }
  scenario "a shopper can add an available book" {
    given bookIsAvailable(${JSON.stringify(title)})
    given startWithEmptyBasket()
    when addBook(${JSON.stringify(title)})
    then expectBookQuantity(${JSON.stringify(title)}, ${expected})
  }
}`);
  }
  async generate(): Promise<void> {
    const output = this.outputs.open('python-acceptance', { domain: 'shopping', ...this.acceptanceOptions }, this.context, new FileProjectWriter(this.context));
    this.written = output.value ? await output.value.create(this.current) : { problems: output.problems };
    if (!this.written.problems.length) this.scenario = await fs.readFile(join(this.root, 'test/acceptance/test_shopping.py'), 'utf8');
  }
  reviseExpectedQuantity(title: string, expected: number): void {
    const previous = this.current.baseline; this.authorShopping(title, expected);
    const identified = this.identity.associate(this.current.specification, previous);
    if (!identified.value) throw Error(JSON.stringify(identified)); this.current = identified.value;
    const compared = this.identity.compare(previous, this.current);
    if (!compared.value) throw Error(JSON.stringify(compared)); this.diff = compared.value;
  }
  async updateTests(): Promise<void> {
    const output = this.outputs.open('python-acceptance', { domain: 'shopping', ...this.acceptanceOptions }, this.context, new FileProjectWriter(this.context));
    this.written = output.value ? await output.value.update(this.diff, this.current) : { problems: output.problems };
  }
  async changeGeneratedQuantity(value: number): Promise<void> {
    const path = 'test/acceptance/test_shopping.py', source = await fs.readFile(join(this.root, path), 'utf8');
    if (!source.includes('shopping.expectBookQuantity("Dune", 1.0)')) throw Error('Actual generated quantity step is missing.');
    await this.file(path, source.replace('shopping.expectBookQuantity("Dune", 1.0)', 'shopping.expectBookQuantity("Dune", ' + value + '.0)'));
  }
  async changeScenarioExecution(kind: 'empty' | 'skip'): Promise<void> {
    const changed = await this.python(`import ast, pathlib, sys
file = pathlib.Path(sys.argv[1])
text = file.read_text(encoding="utf-8")
functions = [node for node in ast.parse(text).body if isinstance(node, ast.FunctionDef) and node.name.startswith("test_")]
if len(functions) != 1:
    raise RuntimeError("The actual generated scenario is not unique.")
function = functions[0]
lines = text.splitlines(keepends=True)
if sys.argv[2] == "empty":
    lines[function.body[0].lineno - 1:function.end_lineno] = ["    pass\\n"]
else:
    lines.insert(function.lineno - 1, '@_test_pytest.mark.skip(reason="The current verification was disabled")\\n')
    lines.insert(0, "import pytest as _test_pytest\\n")
changed = "".join(lines)
ast.parse(changed)
file.write_text(changed, encoding="utf-8")
`, [join(this.root, 'test/acceptance/test_shopping.py'), kind]);
    if (changed.code) throw Error(changed.text);
  }
  scenarioText(): Promise<string> { return fs.readFile(join(this.root, 'test/acceptance/test_shopping.py'), 'utf8'); }
  async rememberGeneratedFiles(): Promise<void> { this.remembered = (await this.context.readSnapshot()).files.filter(file => file.path.startsWith('test/') || file.path === 'src/basket.py'); }
  async rememberedFiles(): Promise<{ path: string; bytes: Uint8Array }[]> {
    return Promise.all(this.remembered.map(async file => ({ path: file.path, bytes: await fs.readFile(join(this.root, file.path)) })));
  }
  async addReadableNativeEdits(): Promise<void> {
    const path = 'test/dsl/shopping.py', source = await fs.readFile(join(this.root, path), 'utf8');
    await this.file(path, '# Keep the human explanation.\n' + source.replace('comparison as _expec', 'comparison as comparison')
      .replace(/\b_expec\b/g, 'comparison')
      + '\ndef neighbor() -> str:\n    return "unchanged human code"\n');
    const test = 'test/acceptance/test_shopping.py', scenario = await this.scenarioText();
    await this.file(test, scenario.replace('shopping.expectBookQuantity(', '# Keep the quantity explanation.\n    shopping.expectBookQuantity('));
  }
  async removeExpectedQuantity(): Promise<void> {
    const path = 'test/dsl/shopping.py', source = await fs.readFile(join(this.root, path), 'utf8');
    if (!source.includes('        _expec.expect_data(actual, expected)')) throw Error('The actual generated quantity assertion was not found.');
    await this.file(path, source.replace('        _expec.expect_data(actual, expected)', '        pass  # This lost the promised assertion.'));
  }
  async addDriverNamedNeighbor(): Promise<void> {
    const path = 'test/dsl/shopping.py';
    await this.file(path, await fs.readFile(join(this.root, path), 'utf8') + '\ndef neighbor(_ExpecDriver: str) -> str:\n    return _ExpecDriver\n');
  }
  async readScenario(): Promise<void> {
    const scenario = [...this.current.specification.inspection.query('scenario')][0]!;
    const output = this.outputs.open('python-acceptance', { domain: 'shopping', ...this.acceptanceOptions }, this.context, new FileProjectWriter(this.context));
    if (!output.value) throw Error(JSON.stringify(output)); this.scenarioRead = await output.value.read(this.current.id(scenario.id));
  }
  authorBook(): void {
    this.source(`type Book { title: Text\ncopies: Number\nnote: Text? }
examples {
  observation book() returns Book
  example "a book retains its data": book() => { title: "Dune", copies: 1 }
}`);
  }
  authorNumberComparison(): void {
    this.source(`examples {
  observation left() returns Number
  observation right() returns Number
  example "numbers retain their declared meaning": left() => right()
}`);
  }
  async observeTextAsNumbers(): Promise<void> {
    await this.file('test/driver/shopping_driver.py', 'class ShoppingDriver:\n    def left(self) -> float:\n        return "Dune"\n    def right(self) -> float:\n        return "Dune"\n');
    await this.runGeneratedTests();
  }
  async generateBookContract(): Promise<void> {
    await this.build();
    if (this.written.problems.length || !this.written.artifacts) throw Error(JSON.stringify(this.written));
    const associated = this.identity.withArtifacts(this.current, this.written.artifacts);
    if (!associated.value) throw Error(JSON.stringify(associated)); this.current = associated.value;
  }
  async observeBook(expression: string): Promise<void> {
    await this.file('test/driver/shopping_driver.py', 'from store.contracts import Book\n\nclass ShoppingDriver:\n    def book(self) -> Book:\n        return ' + expression + '\n');
    await this.runGeneratedTests();
  }
  async implementTakingOneCopy(): Promise<void> {
    await this.file('test/driver/shopping_driver.py', 'from store.contracts import Book\n\nclass ShoppingDriver:\n    def take(self, book: Book) -> float:\n        book["copies"] += 1\n        return book["copies"]\n');
  }
  async observePosition(expression: string): Promise<void> {
    await this.file('test/driver/shopping_driver.py', 'class ShoppingDriver:\n    def current(self) -> tuple[float, float]:\n        return ' + expression + '\n');
    await this.runGeneratedTests();
  }
  async checkGeneratedTypes(): Promise<void> {
    const sites = join(this.root, '.venv', ...(process.platform === 'win32' ? ['Lib', 'site-packages'] : ['lib', 'python3.12', 'site-packages']));
    this.native = await this.python('import sys, os; sys.path.insert(0, sys.argv[1]); os.environ["MYPYPATH"] = os.pathsep.join(sys.argv[2:4]); from mypy import api; out, err, status = api.run(["--strict", "--no-incremental", "--follow-imports=normal", "-m", "dsl.shopping"]); print(out + err); sys.exit(status)', [sites, join(this.root, 'src'), join(this.root, 'test')]);
  }
  async implementBasket(copies: number): Promise<void> {
    const source = await fs.readFile(new URL('../resources/python/basket.py', import.meta.url), 'utf8');
    await this.file('src/basket.py', source.replace('COPIES_ADDED = 1', 'COPIES_ADDED = ' + copies));
    await this.file('test/driver/shopping_driver.py', `from basket import Basket

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
  async useExistingBasketDriver(options: { copies?: number; parameter?: string; returns?: 'str' | 'Any' | 'bool'; requiredConstructorArgument?: boolean }): Promise<void> {
    await this.implementBasket(options.copies ?? 1);
    const generated = 'test/driver/shopping_driver.py';
    let source = (await fs.readFile(join(this.root, generated), 'utf8')).replace('class ShoppingDriver:', 'class HandwrittenShopping:');
    if (options.parameter) source = source.replaceAll('title', options.parameter);
    if (options.requiredConstructorArgument) source = source.replace('def __init__(self)', 'def __init__(self, configuration: str)');
    if (options.returns) {
      source = source.replace('-> float:', '-> ' + options.returns + ':');
      if (options.returns === 'Any') source = 'from typing import Any\n' + source;
      if (options.returns === 'str') source = source.replace('return float(self.basket.quantity(title))', 'return "one"');
      if (options.returns === 'bool') source = source.replace('return float(self.basket.quantity(title))', 'return True');
    }
    this.selectedDriver = '# Existing application adapter.\n' + source;
    await this.file('test/driver/existing.py', this.selectedDriver); await fs.unlink(join(this.root, generated));
    this.acceptanceOptions = { driver: { outputId: 'python-acceptance', format: 'python-symbol-1', value: {
      file: 'test/driver/existing.py', declaration: [{ kind: 'class', name: 'HandwrittenShopping' }],
    } } };
  }
  async useExistingBookDriver(options: { copiesType: 'float' | 'Any'; unrelatedAnyHelper?: boolean }): Promise<void> {
    this.selectedDriver = 'from typing import Any, NotRequired, TypedDict\n\nclass ObservedBook(TypedDict):\n    title: str\n    copies: ' + options.copiesType
      + '\n    note: NotRequired[str]\n\nclass HandwrittenShopping:\n    def book(self) -> ObservedBook:\n        return {"title": "Dune", "copies": 1.0}\n'
      + (options.unrelatedAnyHelper ? '\n    def unrelated(self, input: Any) -> Any:\n        return input\n' : '');
    await this.file('test/driver/existing.py', this.selectedDriver);
    this.acceptanceOptions = { driver: { outputId: 'python-acceptance', format: 'python-symbol-1', value: {
      file: 'test/driver/existing.py', declaration: [{ kind: 'class', name: 'HandwrittenShopping' }],
    } } };
  }
  async shadowSelectedDriver(): Promise<void> {
    await this.file('src/driver/__init__.py', ''); await this.file('test/driver/__init__.py', '');
    await this.file('src/driver/existing.py', this.selectedDriver.replace('return float(self.basket.quantity(title))', 'return 99.0'));
  }
  async useInheritedBasketDriver(): Promise<void> {
    await this.useExistingBasketDriver({ copies: 1 });
    await this.file('test/driver/base.py', this.selectedDriver.replace('HandwrittenShopping', 'BasketBase'));
    this.selectedDriver = 'from driver.base import BasketBase\n\nclass HandwrittenShopping(BasketBase):\n    pass\n';
    await this.file('test/driver/existing.py', this.selectedDriver);
  }
  async supplyDriverNumberType(options: { typed: boolean; startupCanary?: boolean }): Promise<void> {
    const sites = join(this.root, '.venv', ...(process.platform === 'win32' ? ['Lib', 'site-packages'] : ['lib', 'python3.12', 'site-packages']));
    await fs.mkdir(join(sites, 'expec_count'), { recursive: true });
    await fs.writeFile(join(sites, 'expec_count', '__init__.py'), 'from typing import TypeAlias\nCount: TypeAlias = float\n');
    if (options.typed) await fs.writeFile(join(sites, 'expec_count', 'py.typed'), '');
    if (options.startupCanary) {
      await fs.writeFile(join(sites, 'expec_startup.pth'), 'import pathlib; pathlib.Path(' + JSON.stringify(join(this.root, 'startup-ran')) + ').write_text("unexpected startup")\n');
      const control = await this.python('import site, sys; site.addsitedir(sys.argv[1])', [sites]);
      if (control.code || !await this.startupRan()) throw Error('The fixture startup canary is not executable: ' + control.text);
      await fs.unlink(join(this.root, 'startup-ran'));
    }
    this.selectedDriver = 'from expec_count import Count\n' + this.selectedDriver.replace('-> float:', '-> Count:');
    await this.file('test/driver/existing.py', this.selectedDriver);
  }
  async startupRan(): Promise<boolean> { return fs.stat(join(this.root, 'startup-ran')).then(() => true, () => false); }
  async readOperation(name: string): Promise<void> {
    const operation = [...this.current.specification.inspection.query('observation')].find(item => item.name === name);
    if (!operation) throw Error('No authored observation named ' + name);
    const output = this.outputs.open('python-acceptance', { domain: 'shopping', ...this.acceptanceOptions }, this.context, new FileProjectWriter(this.context));
    if (!output.value) throw Error(JSON.stringify(output)); this.scenarioRead = await output.value.read(this.current.id(operation.id));
  }
  async keepExistingCatalogDsl(title: string): Promise<void> {
    this.catalogDsl = '# Handwritten catalog DSL.\ndef available_title() -> str:\n    return ' + JSON.stringify(title) + '\n';
    await this.file('test/dsl/catalog.py', this.catalogDsl);
  }
  catalogDslText(): Promise<string> { return fs.readFile(join(this.root, 'test/dsl/catalog.py'), 'utf8'); }
  async selectedDriverFiles(): Promise<{ expected: string; actual: string; duplicate: boolean }> {
    return { expected: this.selectedDriver, actual: await fs.readFile(join(this.root, 'test/driver/existing.py'), 'utf8'),
      duplicate: await fs.stat(join(this.root, 'test/driver/shopping_driver.py')).then(() => true, () => false) };
  }
  async acceptanceFiles(): Promise<string[]> {
    return (await this.context.readSnapshot()).files.filter(file => file.path.startsWith('test/acceptance/') || file.path.startsWith('test/dsl/')).map(file => file.path);
  }
  async runGeneratedTests(): Promise<void> {
    const sites = join(this.root, '.venv', ...(process.platform === 'win32' ? ['Lib', 'site-packages'] : ['lib', 'python3.12', 'site-packages']));
    this.runtime = await this.python('import sys, os; sys.path[:0] = sys.argv[1:4]; os.environ["PYTEST_DISABLE_PLUGIN_AUTOLOAD"]="1"; os.environ.pop("PYTEST_ADDOPTS", None); os.environ.pop("PYTEST_PLUGINS", None); import pytest; sys.exit(pytest.main(["-q", "-p", "no:cacheprovider", "--rootdir", sys.argv[4], sys.argv[5]]))',
      [sites, join(this.root, 'src'), join(this.root, 'test'), this.root, join(this.root, 'test/acceptance/test_shopping.py')]);
  }
}
