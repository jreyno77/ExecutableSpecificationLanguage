import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { PythonAcceptanceDriver } from './python-acceptance.js';

export type RuntimeValueEvent = { event: string; value?: unknown; title?: string; id?: number; basket?: number; live?: number[] };

/** Actual application values and identities observed while native generated pytest cases run. */
export class PythonRuntimeValuesDriver extends PythonAcceptanceDriver {
  events: RuntimeValueEvent[] = [];
  private get trace(): string { return join(this.root, 'runtime-values.jsonl'); }
  private observer(): string {
    return 'import json\nfrom pathlib import Path\n\ndef observe(event: str, **values: object) -> None:\n'
      + '    with Path(' + JSON.stringify(this.trace) + ').open("a", encoding="utf8") as stream:\n'
      + '        stream.write(json.dumps({"event": event, **values}) + "\\n")\n\n';
  }
  private async basket(): Promise<void> {
    await this.file('src/basket.py', await fs.readFile(new URL('../resources/python/basket.py', import.meta.url), 'utf8'));
  }
  async receipt(copies: number): Promise<void> {
    await this.basket();
    await this.file('test/driver/shopping_driver.py', this.observer() + `from basket import Basket
from store.contracts import Receipt

class ShoppingDriver:
    def __init__(self) -> None:
        self.basket = Basket()
    def available(self, title: str) -> None:
        self.basket.offer(title)
    def add(self, title: str) -> Receipt:
        self.basket.add(title)
        receipt: Receipt = {"copies": ${copies}}
        observe("returned", value=receipt)
        return receipt
    def receiptCopies(self, receipt: Receipt) -> float:
        observe("captured", value=receipt)
        return receipt["copies"]
    def quantity(self, title: str) -> float:
        actual = self.basket.quantity(title)
        observe("quantity", title=title, value=actual)
        return actual
`);
  }
  async number(expression: string): Promise<void> {
    await this.file('test/driver/shopping_driver.py', this.observer() + `class HookedNumber(float):
    def __float__(self) -> float:
        observe("conversion-hook")
        raise RuntimeError("Conversion hook ran")
    def __eq__(self, other: object) -> bool:
        observe("equality-hook")
        raise RuntimeError("Equality hook ran")

class HookedInteger(int):
    def __float__(self) -> float:
        observe("conversion-hook")
        raise RuntimeError("Conversion hook ran")

class ShoppingDriver:
    def current(self) -> float:
        value = ${expression}
        observe("number-type", value=type(value).__name__)
        return value
`);
  }
  async verifyConversionCanary(nativeType = 'HookedNumber'): Promise<void> {
    await fs.writeFile(this.trace, '');
    const result = await this.python('import sys; sys.path.insert(0, sys.argv[1]); from driver import shopping_driver; float(getattr(shopping_driver, sys.argv[2])(1))', [join(this.root, 'test'), nativeType]);
    await this.readEvents();
    if (result.code === 0 || !result.text.includes('Conversion hook ran') || !this.events.some(item => item.event === 'conversion-hook'))
      throw Error('The actual numeric conversion canary did not execute: ' + result.text);
    await fs.writeFile(this.trace, ''); this.events = [];
  }
  async isolatedBaskets(): Promise<void> {
    await this.basket();
    await this.file('test/driver/shopping_driver.py', this.observer() + `from basket import Basket

_live: list[object] = []

class ShoppingDriver:
    def __init__(self) -> None:
        self.basket = Basket()
        _live.append(self)
        observe("driver", id=id(self), basket=id(self.basket), live=[id(value) for value in _live])
    def available(self, title: str) -> None:
        observe("initial", id=id(self), title=title, value=self.basket.quantity(title))
        self.basket.offer(title)
    def add(self, title: str) -> None:
        self.basket.add(title)
    def quantity(self, title: str) -> float:
        actual = self.basket.quantity(title)
        observe("quantity", id=id(self), title=title, value=actual)
        return actual
`);
  }
  async run(): Promise<void> {
    await fs.writeFile(this.trace, '');
    await this.runGeneratedTests();
    await this.readEvents();
  }
  private async readEvents(): Promise<void> {
    this.events = (await fs.readFile(this.trace, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line) as RuntimeValueEvent);
  }
}
