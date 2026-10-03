import { afterEach, describe, it } from 'vitest';
import { PythonDelivery } from '../dsl/python-output.js';

afterEach(() => PythonDelivery.dispose());

describe('Python contracts a real caller can use', { timeout: 30_000 }, () => {
  it('generates StoreGame and reusable snapshot data', async () => {
    const p = await PythonDelivery.create();
    p.source(`type Pair<T> = [T, T]
type Cart { itemsCount: Number }
type Snapshot { position: Pair<Number>\ncart: Cart }
class StoreGame { depends on Snapshot\npublic save\ncapability save(snapshot: Snapshot) returns Nothing }`);
    await p.buildContracts({ module: 'store.contracts' });
    await p.checkConsumer('from store.contracts import StoreGame, Snapshot\ns: Snapshot = {"position": (0.0, 0.0), "cart": {"itemsCount": 0.0}}\nStoreGame().save(s)');
    p.expectNativeTypecheckPassed();
    await p.runConsumer(); p.expectRaised('NotImplementedError', 'save');
  });

  it('keeps interfaces and generic data usable by a native caller', async () => {
    const p = await PythonDelivery.create();
    p.source('interface Catalog { public title\ncapability title() returns Text }\ntype Envelope<T> { value: T }');
    await p.buildContracts();
    await p.checkConsumer('from store.contracts import Catalog, Envelope\nclass Books:\n    def title(self) -> str: return "Dune"\nc: Catalog = Books()\ne: Envelope[str] = {"value": c.title()}');
    p.expectNativeTypecheckPassed();
  });

  it('keeps an optional record key absent instead of None', async () => {
    const p = await PythonDelivery.create(); p.source('type Book { title: Text\nnote: Text? }');
    await p.buildContracts();
    await p.checkConsumer('from store.contracts import Book\nb: Book = {"title": "Dune"}'); p.expectNativeTypecheckPassed();
    await p.checkConsumer('from store.contracts import Book\nb: Book = {"title": "Dune", "note": None}'); p.expectNativeTypecheckFailedAt('None');
  });
});
