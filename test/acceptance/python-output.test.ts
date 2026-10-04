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

  it('represents optional values outside records with explicit absence', async () => {
    const p = await PythonDelivery.create(); p.source('function label() returns Text?'); await p.buildContracts();
    await p.checkConsumer('from store.contracts import Absent\nv: str | Absent = Absent.value\nw: str | Absent = "Dune"'); p.expectNativeTypecheckPassed();
    await p.checkConsumer('from store.contracts import Absent\nv: str | Absent = None'); p.expectNativeTypecheckFailedAt('None');
  });

  it('keeps tuple positions and text literal restrictions in native contracts', async () => {
    const p = await PythonDelivery.create(); p.source('type Position = [Number, Number]\ntype OS = "windows" | "linux"'); await p.buildContracts();
    await p.checkConsumer('from store.contracts import Position, OS\np: Position = (1.0, 2.0)\nos: OS = "windows"'); p.expectNativeTypecheckPassed();
    await p.checkConsumer('from store.contracts import Position, OS\np: Position = (1.0, "wrong")\nos: OS = "plan9"'); p.expectNativeTypecheckFailedAt('tuple[float, str]'); p.expectNativeTypecheckFailedAt('plan9');
  });

  it('reports a floating literal type before writing a wider restriction', async () => {
    const p = await PythonDelivery.create(); p.source('type Exact = 1.5'); await p.buildContracts();
    p.expectProblemAt('unsupported-native-type', '1.5'); p.expectNoWrites();
  });

  it('does not round an unrepresentable number into a different contract', async () => {
    const p = await PythonDelivery.create(); p.source('type Exact = 9007199254740993'); await p.buildContracts();
    p.expectProblemAt('unsupported-native-number', '9007199254740993'); p.expectNoWrites();
  });

  it('retains the declared exception family and generic error details', async () => {
    const p = await PythonDelivery.create();
    p.source('type Book { title: Text }\nerror type Rejected<T> { code: "rejected"\npayload: T }\nfunction save(book: Book) returns Book fails with Rejected<Book>');
    await p.buildContracts();
    await p.checkConsumer('from store.contracts import Book, Rejected, RejectedException\nerror: Rejected[Book] = {"code": "rejected", "payload": {"title": "Dune"}}\ntry:\n    raise RejectedException(error)\nexcept RejectedException as caught:\n    print(caught.details == error)');
    p.expectNativeTypecheckPassed(); await p.runConsumer(); p.expectOutput('True');
  });
  it('keeps consumer capabilities public and internal operations conventionally private', async () => {
    const p = await PythonDelivery.create();
    p.source('class StoreGame { public save\ncapability save() returns Nothing\ncapability internal() returns Nothing }'); await p.buildContracts();
    await p.run('from store.contracts import StoreGame\nprint(hasattr(StoreGame, "save"))\nprint(hasattr(StoreGame, "_internal"))\nprint(hasattr(StoreGame, "internal"))');
    p.expectOutput('True\nTrue\nFalse');
  });
});
