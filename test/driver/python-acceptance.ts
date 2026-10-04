import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { PythonProjectDriver } from './python-project.js';
import { FileProjectWriter, pythonAcceptanceOutput } from '../../src/index.js';

export class PythonAcceptanceDriver extends PythonProjectDriver {
  scenario = '';
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
    const output = this.outputs.open('python-acceptance', { domain: 'shopping' }, this.context, new FileProjectWriter(this.context));
    this.written = output.value ? await output.value.create(this.current) : { problems: output.problems };
    if (!this.written.problems.length) this.scenario = await fs.readFile(join(this.root, 'test/acceptance/test_shopping.py'), 'utf8');
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
  async runGeneratedTests(): Promise<void> {
    const sites = join(this.root, '.venv', ...(process.platform === 'win32' ? ['Lib', 'site-packages'] : ['lib', 'python3.12', 'site-packages']));
    this.runtime = await this.python('import sys, os; sys.path[:0] = sys.argv[1:4]; os.environ["PYTEST_DISABLE_PLUGIN_AUTOLOAD"]="1"; os.environ.pop("PYTEST_ADDOPTS", None); os.environ.pop("PYTEST_PLUGINS", None); import pytest; sys.exit(pytest.main(["-q", "-p", "no:cacheprovider", "--rootdir", sys.argv[4], sys.argv[5]]))',
      [sites, join(this.root, 'src'), join(this.root, 'test'), this.root, join(this.root, 'test/acceptance/test_shopping.py')]);
  }
}
