import { describe, it } from 'vitest';
import { FixtureData } from '../dsl/fixture-data.js';

describe('checking reusable fixture data', () => {
  it("accepts a book described entirely as data", () => {
    const fixtures = new FixtureData();
    fixtures.source(`type Book {
    title: Text
    copies: Number
  }
  examples {
    fixture book: Book = { title: "Dune", copies: 1 }
    fixture expectedCopies: Number = book.copies
  }`);

    fixtures.check("book");

    fixtures.expectType("Book");
  });

  it("checks a value read from another fixture", () => {
    const fixtures = new FixtureData();
    fixtures.source(`type Book {
    title: Text
    copies: Number
  }
  examples {
    fixture book: Book = { title: "Dune", copies: 1 }
    fixture expectedCopies: Number = book.copies
  }`);

    fixtures.check("expectedCopies");

    fixtures.expectType("Number");
  });

  it("rejects text supplied for a numeric field", () => {
    const fixtures = new FixtureData();
    fixtures.source(`type Book {
    title: Text
    copies: Number
  }
  examples {
    fixture book: Book = { title: "Dune", copies: "many" }
    fixture expectedCopies: Number = book.copies
  }`);

    fixtures.check("book");

    fixtures.expectIncompatibleValue('"many"', "Number");
    fixtures.expectNoType();
  });

  it("preserves the original failure when another fixture reads that field", () => {
    const fixtures = new FixtureData();
    fixtures.source(`type Book {
    title: Text
    copies: Number
  }
  examples {
    fixture book: Book = { title: "Dune", copies: "many" }
    fixture expectedCopies: Number = book.copies
  }`);

    fixtures.check("book");
    fixtures.expectIncompatibleValue('"many"', "Number");

    fixtures.check("expectedCopies");

    fixtures.expectOriginalProblemFrom("book", '"many"');
    fixtures.expectNoType();
  });

  it("allows a fixture to refer to a later declaration", () => {
    const fixtures = new FixtureData();
    fixtures.source(`examples {
    fixture first: Number = second
    fixture second: Number = 2
  }`);

    fixtures.check("first");

    fixtures.expectType("Number");
  });

  it("reports a cycle without invalidating unrelated data", () => {
    const fixtures = new FixtureData();
    fixtures.source(`examples {
    fixture first: Number = second
    fixture second: Number = first
    fixture other: Number = 3
  }`);

    fixtures.check("first");

    fixtures.expectCycle(["first", "second", "first"]);
    fixtures.expectCycleReferences([
      { line: 2, text: "second" },
      { line: 3, text: "first" },
    ]);
    fixtures.expectNoType();

    fixtures.check("other");

    fixtures.expectType("Number");
  });

  it("does not borrow a fixture from another examples block", () => {
    const fixtures = new FixtureData();
    fixtures.source(`examples { fixture title: Text = "Dune" }
  examples { fixture copy: Text = title }`);

    fixtures.check("copy");

    fixtures.expectUnresolvedName("title", { line: 2 });
    fixtures.expectNoType();
  });

  it("reports a misspelled fixture at its use", () => {
    const fixtures = new FixtureData();
    fixtures.source(`examples {
    fixture title: Text = "Dune"
    fixture copy: Text = titlle
  }`);

    fixtures.check("copy");

    fixtures.expectUnresolvedName("titlle", { line: 3 });
    fixtures.expectNoType();
  });

  it("allows an ordinary fixture named result", () => {
    const fixtures = new FixtureData();
    fixtures.source(`examples {
    fixture result: Number = 2
    fixture total: Number = result + 1
  }`);

    fixtures.check("total");

    fixtures.expectType("Number");
  });

  it("rejects a runtime call even when its result type fits", () => {
    const fixtures = new FixtureData();
    fixtures.source(`type Basket { id: Text }
  function createBasket() returns Basket
  examples { fixture basket: Basket = createBasket() }`);

    fixtures.checkInitializerAsExpression("basket");
    fixtures.expectValidExpression();

    fixtures.check("basket");

    fixtures.expectRuntimeCallRejected("createBasket()");
    fixtures.expectNoType();
  });

  it("rejects a runtime call inside a list", () => {
    const fixtures = new FixtureData();
    fixtures.source(`type Basket { id: Text }
  function createBasket() returns Basket
  examples { fixture baskets: List<Basket> = [createBasket()] }`);

    fixtures.check("baskets");

    fixtures.expectRuntimeCallRejected("createBasket()");
    fixtures.expectNoType();
  });

  it("rejects a runtime call inside a record", () => {
    const fixtures = new FixtureData();
    fixtures.source(`type Book { copies: Number }
  function readQuantity() returns Number
  examples { fixture book: Book = { copies: readQuantity() } }`);

    fixtures.check("book");

    fixtures.expectRuntimeCallRejected("readQuantity()");
    fixtures.expectNoType();
  });

  it("checks an empty list using its declared element type", () => {
    const fixtures = new FixtureData();
    fixtures.source(`type Book { title: Text }
  examples { fixture books: List<Book> = [] }`);

    fixtures.check("books");

    fixtures.expectType("List<Book>");
  });

  it("checks an anonymous record inside a typed collection", () => {
    const fixtures = new FixtureData();
    fixtures.source(`type Book {
    title: Text
    copies: Number
  }
  type Cart { books: List<Book> }
  examples {
    fixture cart: Cart = { books: [{ title: "Dune", copies: 1 }] }
  }`);

    fixtures.check("cart");

    fixtures.expectType("Cart");
  });

  it("reports a required field missing from the fixture", () => {
    const fixtures = new FixtureData();
    fixtures.source(`type Book {
    title: Text
    copies: Number
  }
  examples { fixture book: Book = { title: "Dune" } }`);

    fixtures.check("book");

    fixtures.expectMissingField("copies", { fixture: "book" });
    fixtures.expectNoType();
  });

  it("reports a field that the record does not declare", () => {
    const fixtures = new FixtureData();
    fixtures.source(`type Book { title: Text }
  examples {
    fixture book: Book = { title: "Dune", genre: "science fiction" }
  }`);

    fixtures.check("book");

    fixtures.expectUnknownField("genre", { line: 3 });
    fixtures.expectNoType();
  });

  it("does not choose arbitrarily between matching record types", () => {
    const fixtures = new FixtureData();
    fixtures.source(`type PrintedBook { title: Text }
  type Ebook { title: Text }
  examples {
    fixture book: PrintedBook | Ebook = { title: "Dune" }
  }`);

    fixtures.check("book");

    fixtures.expectAmbiguousRecord({ fixture: "book" });
    fixtures.expectNoType();
  });

  it("retains an invalid expression alongside an unresolved declared type", () => {
    const fixtures = new FixtureData();
    fixtures.source(`examples {
    fixture count: MissingCount = 1 + "many"
  }`);

    fixtures.check("count");

    fixtures.expectUnresolvedName("MissingCount", { line: 2 });
    fixtures.expectInvalidOperand('"many"', "+");
    fixtures.expectNoType();
  });

  it("retains a data restriction and an independent composition prerequisite", () => {
    const fixtures = new FixtureData();
    fixtures.source(`include "./shared.expec"
  function readCount() returns Number
  examples {
    fixture counts: List<Number> = [readCount(), sharedCount]
  }`);

    fixtures.check("counts");

    fixtures.expectRuntimeCallRejected("readCount()");
    fixtures.expectDeferredReference("sharedCount", "composition");
    fixtures.expectNoType();
  });

  it("does not report a successful type while source composition is missing", () => {
    const fixtures = new FixtureData();
    fixtures.source(`include "./shared.expec"
  examples { fixture count: Number = sharedCount }`);

    fixtures.check("count");

    fixtures.expectDeferredReference("sharedCount", "composition");
    fixtures.expectNoProblems();
    fixtures.expectNoType();
  });

  it("requires a nonoptional fixture value even when the type has a default", () => {
    const fixtures = new FixtureData();
    fixtures.source(`type Book {
    title: Text
    copies: Number = 1
  }
  examples { fixture book: Book = { title: "Dune" } }`);

    fixtures.check("book");

    fixtures.expectMissingField("copies", { fixture: "book" });
    fixtures.expectNoType();
  });

  it("accepts an explicit value without depending on its type default", () => {
    const fixtures = new FixtureData();
    fixtures.source(`function readQuantity() returns Number
  type Book {
    title: Text
    copies: Number = readQuantity()
  }
  examples { fixture book: Book = { title: "Dune", copies: 2 } }`);

    fixtures.check("book");

    fixtures.expectType("Book");
  });

  it("accepts an omitted optional field without consuming its default", () => {
    const fixtures = new FixtureData();
    fixtures.source(`function readNote() returns Text
  type Book {
    title: Text
    note: Text? = readNote()
  }
  examples { fixture book: Book = { title: "Dune" } }`);

    fixtures.check("book");

    fixtures.expectType("Book");
  });

  it("accepts finite data for a recursive type without expanding defaults", () => {
    const fixtures = new FixtureData();
    fixtures.source(`type Branch { children: List<Branch> = [Branch {}] }
  examples { fixture root: Branch = { children: [] } }`);

    fixtures.check("root");

    fixtures.expectType("Branch");
  });

  it("retains a fixture result after another fixture is checked", () => {
    const fixtures = new FixtureData();
    fixtures.source(`examples {
    fixture first: Number = second
    fixture second: Number = 2
    fixture broken: Number = "many"
  }`);

    fixtures.check("first");
    fixtures.expectType("Number");
    fixtures.rememberReport("first");

    fixtures.check("broken");
    fixtures.expectIncompatibleValue('"many"', "Number");
    fixtures.expectNoType();

    fixtures.check("first");

    fixtures.expectType("Number");
    fixtures.expectSameReportAs("first");
    fixtures.expectRememberedReportUnchanged("first");
    fixtures.expectInspectionUnchanged();
  });

  it("also succeeds when the invalid fixture is checked first", () => {
    const fixtures = new FixtureData();
    fixtures.source(`examples {
    fixture first: Number = second
    fixture second: Number = 2
    fixture broken: Number = "many"
  }`);

    fixtures.check("broken");
    fixtures.expectIncompatibleValue('"many"', "Number");

    fixtures.check("first");

    fixtures.expectType("Number");
  });

  it("rejects a type declaration supplied where a fixture is required", () => {
    const fixtures = new FixtureData();
    fixtures.source(`type Book { title: Text }
  examples { fixture book: Book = { title: "Dune" } }`);

    fixtures.attemptToCheckTypeDeclaration("Book");

    fixtures.expectQueryError("unexpected-kind");
  });

  it("rejects a fixture handle owned by another source model", () => {
    const fixtures = new FixtureData();
    fixtures.source(`examples { fixture count: Number = 1 }`);

    const other = new FixtureData();
    other.source(`examples { fixture count: Number = 1 }`);

    fixtures.attemptToCheckForeignFixture(other, "count");

    fixtures.expectQueryError("foreign-node");
  });
});
