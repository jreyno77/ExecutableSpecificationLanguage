import { describe, it } from 'vitest';
import { CompilationExamples } from '../dsl/compiler-composition.js';

describe('compiling a specification for independent consumers', () => {
  it("shares contracts and declared relationships with independent consumers", () => {
    const language = new CompilationExamples();
    language.source(`type SystemConfig { brightness: Number }
type Snapshot { title: Text }
concept Storage {}
concept StoreGame {
  depends on Storage
  public startup, saveGame
  construction(configurations: SystemConfig)
  capability startup(configurations: SystemConfig) returns Nothing
  capability saveGame(snapshot: Snapshot) returns Nothing {
    promises "Save the snapshot to durable storage."
  }
}`, { locator: "store", sourceId: "store.expec" });

    language.compile();

    language.expectChecked();
    language.expectPublicCapabilities("StoreGame", ["startup", "saveGame"]);
    language.expectSignature("StoreGame.startup", ["configurations: SystemConfig"], "Nothing");
    language.expectSignature("StoreGame.saveGame", ["snapshot: Snapshot"], "Nothing");
    language.expectSameType("StoreGame.construction.configurations", "StoreGame.startup.configurations");
    language.expectRelationship("StoreGame", "Storage", "dependency", { line: 5 });
    language.expectRelationship("StoreGame.startup", "SystemConfig", "input", { line: 8 });
    language.expectPromise("StoreGame.saveGame", "Save the snapshot to durable storage.");
    language.expectNoCommunications();
    language.expectConsumersAgreeInEitherOrder();
  });

  it("retains standalone declarations and nested type-use origins", () => {
    const language = new CompilationExamples();
    language.source(`type Book { title: Text }
type Shelf { books: List<Book> }
function echo(book: Book) returns Book`);

    language.compile();

    language.expectChecked();
    language.expectOwnedTypes(["Book", "Shelf"]);
    language.expectOwnedFunctions(["echo"]);
    language.expectRelationship("Shelf.books", "Book", "field-type", { line: 2, typePath: [0] });
    language.expectRelationship("echo", "Book", "input", { line: 3, within: "book: Book" });
    language.expectRelationship("echo", "Book", "output", { line: 3, within: "returns Book" });
  });

  it("preserves omitted, absent-value and declared-value results", () => {
    const language = new CompilationExamples();
    language.source(`function unspecified()
function stop() returns Nothing
function quantity() returns Number`);

    language.compile();

    language.expectChecked();
    language.expectResult("unspecified", "unspecified");
    language.expectResult("stop", "none");
    language.expectResult("quantity", "Number");
    language.expectAuthoredBody("quantity", "absent");
  });

  it("rejects a public name that has no matching capability", () => {
    const language = new CompilationExamples();
    language.source(`concept StoreGame {
  public saveGame
  capability save() returns Nothing
}`);

    language.compile();

    language.expectProblem("unresolved-reference", "saveGame", { line: 2 });
    language.expectNoSpecification();
  });

  it("retains independent missing names and invalid defaults", () => {
    const language = new CompilationExamples();
    language.source(`type Broken {
  first: MissingFirst
  second: MissingSecond
  copies: Number = "many"
}`);

    language.compile();

    language.expectProblem("unresolved-reference", "MissingFirst", { line: 2 });
    language.expectProblem("unresolved-reference", "MissingSecond", { line: 3 });
    language.expectProblem("incompatible-type", '"many"', { line: 4 });
    language.expectNoSpecification();
  });

  it("stops at rejected syntax without making up semantic facts", () => {
    const language = new CompilationExamples();
    language.source(`type Broken { copies Number }`);

    language.compile();

    language.expectSyntaxProblem("expected-token", "Number");
    language.expectNoSemanticFindings();
    language.expectNoSpecification();
  });

  it("checks an unused fixture instead of accepting its annotation", () => {
    const language = new CompilationExamples();
    language.source(`examples { fixture copies: Number = "many" }`);

    language.compile();

    language.expectProblem("incompatible-type", '"many"');
    language.expectNoSpecification();
  });

  it("checks unused callable parameter defaults", () => {
    const language = new CompilationExamples();
    language.source(`function reserve(copies: Number = "many") returns Nothing`);

    language.compile();

    language.expectProblem("incompatible-type", '"many"');
    language.expectNoSpecification();
  });

  it("checks construction defaults even when nothing constructs the concept", () => {
    const language = new CompilationExamples();
    language.source(`concept StoreGame {
  construction(retries: Number = "many")
}`);

    language.compile();

    language.expectProblem("incompatible-type", '"many"');
    language.expectNoSpecification();
  });

  it("allows a bodyless operation's default to use checked fixture data", () => {
    const language = new CompilationExamples();
    language.source(`examples {
  fixture defaultCount: Number = 1
  action addCopies(count: Number = defaultCount) returns Nothing
  check hasQuantity(expected: Number)
  scenario "one copy" {
    when addCopies()
    then hasQuantity(defaultCount)
  }
}`);

    language.compile();

    language.expectChecked();
    language.expectSteps("one copy", ["when addCopies()", "then hasQuantity(defaultCount)"]);
  });

  it("checks conditions in an unused contract", () => {
    const language = new CompilationExamples();
    language.source(`function reserve(copies: Number) returns Nothing {
  requires copies
}`);

    language.compile();

    language.expectProblem("invalid-purpose", "copies", { line: 2 });
    language.expectNoSpecification();
  });

  it("completes contextual result checking without leaving a stale requirement", () => {
    const language = new CompilationExamples();
    language.source(`function quantity() returns Number {
  ensures result >= 0
}`);

    language.compile();

    language.expectChecked();
    language.expectContractCondition("quantity", "ensures", "result >= 0");
  });

  it("preserves the shopper's intent without inventing observed results", () => {
    const language = new CompilationExamples();
    language.source(`examples {
  setup bookIsAvailable(title: Text) returns Nothing
  setup startWithEmptyBasket() returns Nothing
  action addBook(title: Text) returns Nothing
  observation quantity(title: Text) returns Number
  scenario "add an available book" {
    given bookIsAvailable("Dune")
    given startWithEmptyBasket()
    when addBook("Dune")
    then quantity("Dune") == 1
  }
  example "one copy": quantity("Dune") => 1
  example "durable basket": quantity("Dune") => satisfies "Survives restart."
}`);

    language.compile();

    language.expectChecked();
    language.expectSteps("add an available book", [
      'given bookIsAvailable("Dune")', "given startWithEmptyBasket()",
      'when addBook("Dune")', 'then quantity("Dune") == 1'
    ]);
    language.expectExample("one copy", { actual: 'quantity("Dune")', expected: "1" });
    language.expectProseExpectation("durable basket", "Survives restart.");
    language.expectAuthoredBody("quantity", "absent");
  });

  it("completes scenario capture and member analysis", () => {
    const language = new CompilationExamples();
    language.source(`type Receipt { saved: Boolean }
examples {
  action save() returns Receipt
  scenario "saved receipt" {
    when receipt = save()
    then receipt.saved == true
  }
}`);

    language.compile();

    language.expectChecked();
    language.expectSteps("saved receipt", ["when receipt = save()", "then receipt.saved == true"]);
  });

  it("retains a wrong scenario role and argument as independent failures", () => {
    const language = new CompilationExamples();
    language.source(`examples {
  observation quantity(seed: Number) returns Number
  scenario "bad action" {
    when quantity("many")
    then true
  }
}`);

    language.compile();

    language.expectProblem("invalid-step-role", 'quantity("many")');
    language.expectProblem("incompatible-type", '"many"');
    language.expectNoSpecification();
  });

  it("rejects incompatible actual and expected example types", () => {
    const language = new CompilationExamples();
    language.source(`examples { example "quantity": 1 => "one" }`);

    language.compile();

    language.expectProblem("incompatible-type", '"one"');
    language.expectNoSpecification();
  });

  it("checks an expectation's types without claiming its arithmetic passed", () => {
    const language = new CompilationExamples();
    language.source(`examples { example "wrong arithmetic": 8 * 8 => 65 }`);

    language.compile();

    language.expectChecked();
    language.expectExample("wrong arithmetic", { actual: "8 * 8", expected: "65" });
  });

  it("retains independent problems on both sides of a short example", () => {
    const language = new CompilationExamples();
    language.source(`function copies(count: Number) returns Number
examples { example "two mistakes": copies("many") => missingExpected }`);

    language.compile();

    language.expectProblem("incompatible-type", '"many"');
    language.expectProblem("unresolved-reference", "missingExpected");
    language.expectNoSpecification();
  });

  it("provides declared message identities and captured reply types", () => {
    const language = new CompilationExamples();
    language.source(`type Snapshot { title: Text }
type Receipt { saved: Boolean }
concept Screen {
  public showSaved
  capability showSaved(receipt: Receipt) returns Nothing
}
concept Storage {
  public persist
  capability persist(snapshot: Snapshot) returns Receipt
}
interaction "save"(snapshot: Snapshot) {
  participant screen: Screen
  participant storage: Storage
  message screen -> storage.persist(snapshot) as receipt
  message storage -> screen.showSaved(receipt)
}`);

    language.compile();

    language.expectChecked();
    language.expectCommunication("save", 1, {
      sender: "screen", receiver: "storage", operation: "Storage.persist", reply: "Receipt"
    });
    language.expectCommunication("save", 2, {
      sender: "storage", receiver: "screen", operation: "Screen.showSaved"
    });
    language.expectReplyUsesCatalogIdentity("save", 1, "Receipt");
  });

  it("does not accept an invalid message just because its declaration resolves", () => {
    const language = new CompilationExamples();
    language.source(`concept Screen {}
concept Storage {
  public persist
  capability persist(title: Text) returns Nothing
}
interaction "save"() {
  participant screen: Screen
  participant storage: Storage
  message screen -> storage.persist(42)
}`);

    language.compile();

    language.expectProblem("incompatible-type", "42");
    language.expectNoSpecification();
  });

  it("keeps source composition pending alongside a real invalid default", () => {
    const language = new CompilationExamples();
    language.source(`include "extra.expec"
type Book { copies: Number = "many" }`);

    language.compile();

    language.expectProblem("composition-required", 'include "extra.expec"', { line: 1 });
    language.expectDeferred("composition", 'include "extra.expec"', { line: 1 });
    language.expectProblem("incompatible-type", '"many"', { line: 2 });
    language.expectNoSpecification();
  });

  it("does not certify an authored helper body whose checker was withdrawn", () => {
    const language = new CompilationExamples();
    language.source(`examples {
  observation quantity() returns Number { return "many" }
}`);

    language.compile();

    language.expectDeferred("helper-body", '{ return "many" }', { line: 2 });
    language.expectNoSpecification();
  });

  it("does not mistake an empty authored check body for a validated check", () => {
    const language = new CompilationExamples();
    language.source(`examples { check quantityIsCorrect() {} }`);

    language.compile();

    language.expectDeferred("helper-body", "{}", { within: "check quantityIsCorrect() {}" });
    language.expectNoSpecification();
  });

  it("retains a missing declared result when a scenario needs a captured value", () => {
    const language = new CompilationExamples();
    language.source(`examples {
  action save()
  scenario "receipt" {
    when receipt = save()
    then true
  }
}`);

    language.compile();

    language.expectDeferred("declared-result", "save()", { line: 4 });
    language.expectNoSpecification();
  });

  it("uses source-backed dependencies without making them entry-owned output", () => {
    const language = new CompilationExamples();
    language.module("models", `type Receipt { saved: Boolean }`, { sourceId: "models.expec" });
    language.source(`use Receipt from "models"
function save() returns Receipt`, { locator: "store", sourceId: "store.expec" });

    language.compile();

    language.expectChecked();
    language.expectOwnedTypes([]);
    language.expectOwnedFunctions(["save"]);
    language.expectResultOrigin("save", { module: "models", sourceId: "models.expec", line: 1 });
    language.expectField("Receipt", "saved", "Boolean");
  });

  it("validates unused declarations in a reached source module", () => {
    const language = new CompilationExamples();
    language.module("models", `type Receipt { saved: Boolean }
type Unused { copies: Number = "many" }`, { sourceId: "models.expec" });
    language.source(`use Receipt from "models"
function save() returns Receipt`);

    language.compile();

    language.expectProblem("incompatible-type", '"many"', { sourceId: "models.expec", line: 2 });
    language.expectNoSpecification();
  });

  it("does not pull an unreachable supplied module into compilation", () => {
    const language = new CompilationExamples();
    language.module("unrelated", `type Unused { copies: Number = "many" }`);
    language.source(`type Book { title: Text }`);

    language.compile();

    language.expectChecked();
    language.expectOwnedTypes(["Book"]);
    language.expectNoDeclaration("Unused");
  });

  it("uses external signatures without demanding unavailable source bodies", () => {
    const language = new CompilationExamples();
    language.externalModule("library", [{
      kind: "function", name: "quantity",
      parameters: [{ name: "seed", type: { kind: "builtin", name: "Number" }, hasDefault: true }],
      result: { kind: "builtin", name: "Number" }
    }]);
    language.source(`use quantity from "library"
examples { example "quantity": quantity() => 1 }`);

    language.compile();

    language.expectChecked();
    language.expectExternalOperation("quantity", "library");
    language.expectExample("quantity", { actual: "quantity()", expected: "1" });
  });

  it("observes removed modules on the next call without changing an earlier result", () => {
    const language = new CompilationExamples();
    language.module("models", `type Receipt { saved: Boolean }`);
    language.source(`use Receipt from "models"
function save() returns Receipt`);
    language.compile();
    language.expectChecked();
    language.rememberResult("available");

    language.removeModule("models");
    language.compile();

    language.expectProblem("unavailable-module", "Receipt", { line: 1 });
    language.expectRelatedDependency(["modules", "models"]);
    language.expectNoSpecification();
    language.expectRememberedResultUnchanged("available");
  });

  it("uses changed source on the same compiler without leaking an earlier answer", () => {
    const language = new CompilationExamples();
    language.source(`type Book { copies: Number }`);
    language.compile();
    language.expectChecked();
    language.rememberResult("numeric copies");

    language.source(`type Book { copies: Text }`);
    language.compile();

    language.expectChecked();
    language.expectField("Book", "copies", "Text");
    language.expectRememberedField("numeric copies", "Book", "copies", "Number");
    language.expectRememberedResultUnchanged("numeric copies");
  });

  it("uses changed external signatures without rewriting an earlier result", () => {
    const language = new CompilationExamples();
    language.externalModule("inventory", [{
      kind: "function", name: "quantity", parameters: [],
      result: { kind: "builtin", name: "Text" }
    }]);
    language.source(`use quantity from "inventory"
examples { example "quantity label": quantity() => "one" }`);
    language.compile();
    language.expectChecked();
    language.rememberResult("text quantity");

    language.externalModule("inventory", [{
      kind: "function", name: "quantity", parameters: [],
      result: { kind: "builtin", name: "Number" }
    }]);
    language.compile();

    language.expectProblem("incompatible-type", '"one"');
    language.expectNoSpecification();
    language.expectRememberedResultUnchanged("text quantity");
  });

  it("checks declared package availability without installing packages", () => {
    const language = new CompilationExamples();
    language.source(`concept StoreGame { requires package "vite" for build }`);

    language.compile();
    language.expectProblem("unavailable-package", '"vite"');
    language.expectNoSpecification();

    language.package("vite", ["build"]);
    language.compile();
    language.expectChecked();
  });
});
