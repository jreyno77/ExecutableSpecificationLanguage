import { describe, expect, it } from 'vitest';
import {
  readSyntax,
  readAcceptedSource,
  expectRejectedSyntax,
  nodesOfKind,
  nodeFor,
  expectNavigableSourceForest,
} from '../support/syntax-reading.js';

describe('authoring software declarations and examples', () => {
  it("reads Store Game contracts with public capabilities and dependencies", () => {
    readAcceptedSource(`use SystemConfig from "./models/system-config.expec"
use PlayerStateSnapshot from "./models/player-state.expec"

concept StoreGame {
  depends on SystemConfig, PlayerStateSnapshot
  requires package "vite" for build
  requires package "supabase" for runtime
  public startup, saveGame, delete, newGame, shutDown

  construction(configurations: SystemConfig)
  capability startup(configurations: SystemConfig) returns Nothing {
    promises "Build and start the server with the main starting page."
  }
  capability saveGame(snapshot: PlayerStateSnapshot) returns Nothing {
    promises "Save the snapshot to the configured Supabase database."
  }
  capability delete() returns Nothing
  capability newGame() returns PlayerStateSnapshot
  capability shutDown() returns Nothing

  local type SessionState {
    running: Boolean = false
    snapshot: PlayerStateSnapshot?
  }
}
`);
  });

  it("reads the declaration categories and available type forms", () => {
    readAcceptedSource(`use Mode as OperatingMode from "./support/shared.expec"
include "./support/shared.expec"
opaque type Token
opaque type Handle<T>
type Pair<T> = [T, T]
type Selection = "small" | "large" | 0 | -1 | true | false
type Settings {
  mode: OperatingMode = "preview"
  values: List<Number> = [1, 2, 3]
  pair: Pair<Number> = [0, 0]
  label: (Text | Number)?
  enabled: Boolean = true
}
class Worker {
  construction(settings: Settings, tag: Text = "worker")
  capability start() returns Nothing
  local interface Driver { capability connect() returns Nothing }
  local opaque type State
}
extend Worker { capability stop() returns Nothing }
component Gateway { depends on Worker }
concept \`Store Game\` {
  public \`new game\`
  capability \`new game\`() returns Token
}
function multiply(a: Number, b: Number) returns Number {
  requires a >= 0 and b >= 0
  ensures result >= 0
  promises "Return the product of the inputs."
  promises "Keep both input values unchanged."
}
examples for Worker {
  fixture settings: Settings = Settings {
    mode: "live", values: [1, 2], pair: [0, 0], enabled: true,
  }
}
type PairList = List<Pair<Number>>
opaque type SpecIdentifier
`);
  });

  it("reads domain operations with separately attached examples", () => {
    readAcceptedSource(`concept Shopping {
  examples {
    setup bookIsAvailable(title: Text) returns Nothing
    setup startWithEmptyBasket() returns Nothing
    action addBook(title: Text) returns Nothing
    observation bookQuantity(title: Text) returns Number
    check expectBookQuantity(title: Text, expected: Number) {
      let actual = bookQuantity(title)
      assert actual == expected
    }
  }
}

examples for Shopping from "./shopping.examples.expec"
`);
  });

  it("reads a shopper scenario written in domain operations", () => {
    readAcceptedSource(`examples {
  scenario "a shopper can add an available book" {
    given bookIsAvailable("Dune")
    given startWithEmptyBasket()

    when addBook("Dune")

    then expectBookQuantity("Dune", 1)
  }
}
`);
  });

  it("reads reusable setup with defaults and captured results", () => {
    readAcceptedSource(`type Basket { id: Text }
type Book { title: Text }
concept BasketService {
  capability openBasket() returns Basket
  capability stockBook(title: Text) returns Nothing
  capability addCopies(basket: Basket, title: Text, count: Number) returns Nothing
  capability quantity(basket: Basket, title: Text) returns Number
  examples {
    fixture defaultBook: Book = Book {
      title: "Dune",
    }
    setup stockedBasket(title: Text = defaultBook.title, copies: Number = 2) returns Basket {
      let basket = openBasket()
      do stockBook(title)
      do addCopies(basket, title, copies)
      return basket
    }
    observation copiesIn(basket: Basket, title: Text) returns Number {
      return quantity(basket, title)
    }
    scenario "add to a basket that already contains copies" {
      given basket = stockedBasket()
      when addCopies(basket, "Dune", 1)
      then copiesIn(basket, "Dune") == 3
    }
  }
}
`);
  });

  it("reads ordered participant messages and captured replies", () => {
    readAcceptedSource(`use PlayerStateSnapshot from "./models/player-state.expec"
type Receipt { id: Text }

interface GameStorage {
  capability persist(snapshot: PlayerStateSnapshot) returns Receipt
}
component GameScreen {
  depends on GameStorage
  capability showSaved(receipt: Receipt) returns Nothing

  interaction "save and show confirmation"(snapshot: PlayerStateSnapshot) {
    participant screen: GameScreen
    participant storage: GameStorage
    message screen -> storage.persist(snapshot) as receipt
    message storage -> screen.showSaved(receipt)
  }
}
interaction "persist without a confirmation view"(snapshot: PlayerStateSnapshot) {
  participant screen: GameScreen
  participant storage: GameStorage
  message screen -> storage.persist(snapshot)
}
`);
  });

  it("reads declared type uses that relationship consumers can inspect", () => {
    readAcceptedSource(`concept X {
  depends on Y
  construction(y: Y)
  public make
  capability make() returns Y
}
concept Y {
  public handle
  capability handle(x: X) returns Nothing
}
`);
  });

  it("reads comments, escaping, and multiline collections", () => {
    readAcceptedSource(`// The escaped backtick belongs to the concept's name.
concept \`Display \\\`name\\\`\` {
capability render(
    title: Text = "A \\"quoted\\" title",
    location: Text = "C:\\\\books",
  ) returns Text {
    promises "Render text including \\\\ and a tab \\t."
  }
}
type Measurements {
  values: List<Number> = [
    1,
    2,
  ]
}
examples for \`Display \\\`name\\\`\` {
  fixture title: Text = "Dune\\nPart two\\u0021"
  fixture sample: Measurements = Measurements {
    values: [1, 2], // A comment does not remove a collection comma.
  }
  example "grouping across lines": (
    2 + 3
  ) * 4 => 20
}
`);
  });

  it("reads literal expectations and explicit prose", () => {
    readAcceptedSource(`function multiply(a: Number, b: Number) returns Number
function label() returns Text
examples for multiply {
  example "eight times eight": multiply(8, 8) => 64
  example "description of the digits": multiply(8, 8) => satisfies "A nonnegative pair of digits starting with 6 and ending with 4."
  example "operator precedence": 2 + 3 * 4 => 14
  example "grouping": (2 + 3) * 4 => 20
  example "logical operators": not false and 2 < 3 or false => true
}
examples for label {
  example "a literal string result": label() => "Dune"
  scenario "a descriptive obligation" {
    when title = label()
    then title == "Dune"
    then satisfies "The title communicates the selected book."
  }
}
`);
  });

  it("reads a shared alias with literal alternatives", () => {
    readAcceptedSource(`type Mode = "preview" | "live"
`);
  });

  it("reads record fields with an imported type and a default", () => {
    readAcceptedSource(`use URL from "expec:core"
type SystemConfig {
  os: "windows"
  gameroot: URL
  brightness: Number = 80
}
`);
  });

  it("reads a record with a numeric field default", () => {
    readAcceptedSource(`type ShoppingCart {
  itemsCount: Number = 0
}
`);
  });

  it("reads a record using imported generic and record types", () => {
    readAcceptedSource(`use Pair from "./pair.expec"
use ShoppingCart from "./shopping-cart.expec"
type PlayerStateSnapshot {
  characterPosition: Pair<Number> = [0, 0]
  shoppingCart: ShoppingCart
}
`);
  });

  it("reads a generic tuple alias", () => {
    readAcceptedSource(`type Pair<T> = [T, T]
`);
  });
});

describe('recognizing malformed declarations and examples', () => {
  it("rejects a field declaration without its type separator", () => {
    expectRejectedSyntax(`type Snapshot {
  position Number
}
`);
  });

  it("rejects an unclosed declaration body", () => {
    expectRejectedSyntax(`concept Unclosed {
  capability start()
`);
  });

  it("rejects a string that does not close before the line ends", () => {
    expectRejectedSyntax(`function label() {
  promises "A title without its closing quote
}
`);
  });

  it("rejects an operator without its right operand", () => {
    expectRejectedSyntax(`examples {
  example "incomplete addition": 8 + => 64
}
`);
  });

  it("rejects scenario setup after an action", () => {
    expectRejectedSyntax(`examples {
  scenario "a setup after its action" {
    when addBook("Dune")
    given startWithEmptyBasket()
    then expectBookQuantity("Dune", 1)
  }
}
`);
  });
});

describe('preserving authored meaning and source locations', () => {
  it('keeps public references distinct from declarations and does not resolve them', () => {
    const { description } = readAcceptedSource('concept StoreGame {\n public saveGame\n capability save() returns Nothing\n}');
    const names = nodesOfKind(description, 'name').map(node => node.payload.decoded);
    expect(names).toEqual(['StoreGame', 'saveGame', 'save', 'Nothing']);
    expect(nodesOfKind(description, 'capability')).toHaveLength(1);
  });
  it('preserves literal expectations separately from explicit prose', () => {
    const { description } = readAcceptedSource('examples {\n example "value": title() => "Dune"\n example "prose": title() => satisfies "a book title"\n}');
    const examples = nodesOfKind(description, 'example');
    expect(examples).toHaveLength(2);
    const expectedKinds = examples.map(node => nodeFor(description, node.payload.expected).payload.kind);
    expect(expectedKinds).toEqual(['string-literal', 'prose-expectation']);
  });
  it('preserves omitted versus empty helper bodies and omitted versus explicit results', () => {
    const { description } = readAcceptedSource('examples {\n action first()\n action second() returns Nothing {}\n}');
    const callables = nodesOfKind(description, 'action');
    expect(callables[0]!.payload).not.toHaveProperty('body');
    expect(callables[0]!.payload).not.toHaveProperty('returnType');
    expect(callables[1]!.payload).toHaveProperty('body');
    expect(callables[1]!.payload).toHaveProperty('returnType');
  });
  it('uses Unicode scalar offsets, CRLF line boundaries, and original BOM positions', () => {
    const text = '\uFEFFtype `📚` {\r\n\tlabel: Text\r\n}';
    const { description } = readAcceptedSource(text);
    const name = nodesOfKind(description, 'name').find(node => node.payload.decoded === '📚')!;
    expect(name.range).toEqual({ sourceId: 'memory:example', start: { offset: 6, line: 1, column: 7 }, end: { offset: 9, line: 1, column: 10 } });
    const [field] = nodesOfKind(description, 'field');
    expect(field!.range.start).toEqual({ offset: 14, line: 2, column: 2 });
  });
  it('places multiplication inside addition so callers can preserve expression precedence', () => {
    const { description } = readAcceptedSource('examples { example "arithmetic": 2 + 3 * 4 => 14 }');
    const operations = nodesOfKind(description, 'binary-expression');
    expect(operations.map(node => node.payload.operator)).toEqual(['+', '*']);
    const [addition, multiplication] = operations;
    expect(nodeFor(description, addition!.payload.left).payload).toEqual({ kind: 'number-literal', token: '2' });
    expect(addition!.payload.right).toEqual(multiplication!.id);
    expect(nodeFor(description, multiplication!.payload.left).payload).toEqual({ kind: 'number-literal', token: '3' });
    expect(nodeFor(description, multiplication!.payload.right).payload).toEqual({ kind: 'number-literal', token: '4' });
  });
  it('gives callers a navigable source forest with unique preorder IDs and contained ranges', () => {
    const { description } = readAcceptedSource('type Pair<T> = [T, T]\nconcept Store {\n construction(count: Number)\n public save\n capability save(value: Pair<Number>) returns Nothing\n}');
    expectNavigableSourceForest(description);
  });
  it("rejects semicolon statement separators", () => {
    expectRejectedSyntax("type Cart { count: Number; label: Text }");
  });

  it("rejects multiple field declarations on one line", () => {
    expectRejectedSyntax("type Cart { count: Number label: Text }");
  });

  it("rejects a contract body after its declaration has ended", () => {
    expectRejectedSyntax("function calculate() returns Number\n{ ensures result > 0 }");
  });

  it("rejects list entries separated only by a newline", () => {
    expectRejectedSyntax("examples { fixture pair: List<Number> = [1\n2] }");
  });

  it("rejects chained comparisons", () => {
    expectRejectedSyntax("examples { example \"chained\": 1 < 2 < 3 => true }");
  });

  it("rejects a when step that is not a call", () => {
    expectRejectedSyntax("examples { scenario \"bad\" {\n when 1 + 2\n then true\n} }");
  });

  it("rejects a given step after an action", () => {
    expectRejectedSyntax("examples { scenario \"bad\" {\n when run()\n given prepare()\n then true\n} }");
  });

  it("rejects empty tuple types", () => {
    expectRejectedSyntax("type Empty = []");
  });

  it("rejects empty generic parameter lists", () => {
    expectRejectedSyntax("type Box<> {}");
  });

  it("rejects unterminated quoted names", () => {
    expectRejectedSyntax("type `unterminated {}");
  });

  it("rejects empty quoted names", () => {
    expectRejectedSyntax("type `` {}");
  });

  it("rejects unpaired Unicode surrogate escapes", () => {
    expectRejectedSyntax("type X = \"\\uD800\"");
  });

  it("rejects unknown string escapes", () => {
    expectRejectedSyntax("type X = \"\\q\"");
  });

  it("rejects lone carriage returns", () => {
    expectRejectedSyntax("type X {}\rtype Y {}");
  });

  it("rejects raw control characters in strings", () => {
    expectRejectedSyntax("type X = \"raw\u0001control\"");
  });

  it('allows multiline collections without suppressing expression comparison boundaries', () => {
    readAcceptedSource('type Result = List<\nList<\nNumber\n>\n>\nexamples {\n fixture values: List<Number> = [\n1,\n2,\n]\n example "grouped": (1 +\n2) => 3\n}');
    expect(readSyntax('examples {\n example "comparison": 1 <\n2 => true\n}').status).toBe('rejected');
  });
  it('treats every line break inside a collection as whitespace, including qualified references', () => {
    readAcceptedSource('type Result = List<catalog\n.\nItem>\nfunction choose(value: [\n-\n1, catalog\n.\nItem]) returns Text\nexamples {\n example "member": (catalog\n.\nlookup\n(\n)) => "Dune"\n}');
  });
  it('decodes escaped names and paired Unicode string escapes', () => {
    const { description } = readAcceptedSource('type `a\\`b` = "\\uD83D\\uDCDA"');
    expect(nodesOfKind(description, 'name')[0]!.payload).toMatchObject({ decoded: 'a`b', quoted: true });
    expect(nodesOfKind(description, 'string-literal')[0]!.payload).toMatchObject({ value: '📚' });
  });
});
