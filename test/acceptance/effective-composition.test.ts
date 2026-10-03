import { describe, it } from 'vitest';
import { CompositionExamples } from '../dsl/source-composition.js';

describe('Effective extensions and example ownership', () => {
it("adds a capability from an explicitly included extension", () => {
  const language = new CompositionExamples();
  language.entry("store", `include "saving"
concept StoreGame { public save }`);
  language.module("saving", `use StoreGame from "store"
extend StoreGame {
  capability save(snapshot: Text) returns Nothing
}`);

  language.compose();
  language.compile();

  language.expectCompiled();
  language.expectCapabilities("store", "StoreGame", ["save"]);
  language.expectCapabilityOrigin("store", "StoreGame.save", "saving", { line: 3 });
  language.expectOriginalMemberIdentity("saving", "save");
  language.expectOriginalConceptMembers("store", "StoreGame", ["public"]);
});

it("keeps extension imports in their authoring module", () => {
  const language = new CompositionExamples();
  language.entry("store", `include "saving"
concept StoreGame {}
function outside(value: Imported)`);
  language.module("saving", `use StoreGame from "store"
use Snapshot as Imported from "models"
extend StoreGame { capability save(snapshot: Imported) returns Nothing }`);
  language.module("models", "type Snapshot {}");

  language.compose();
  language.compile();

  language.expectBoundType("saving", "Imported", "models", "Snapshot");
  language.expectProblem("unresolved-reference", "store", "Imported", { line: 3 });
  language.expectNoSpecification();
});

it("rejects an extension that redeclares an existing capability", () => {
  const language = new CompositionExamples();
  language.entry("store", `concept StoreGame { capability save() returns Nothing }
extend StoreGame { capability save(snapshot: Text) returns Nothing }`);

  language.compose();
  language.compile();

  language.expectProblem("duplicate-declaration", "store", "capability save", { line: 2 });
  language.expectRelatedOrigin("store", "capability save", { line: 1 });
  language.expectNoSpecification();
});

it("does not extend a record as if it were a concept", () => {
  const language = new CompositionExamples();
  language.entry("store", `type Snapshot {}
extend Snapshot { capability save() returns Nothing }`);

  language.compose();
  language.compile();

  language.expectProblem("wrong-reference-kind", "store", "Snapshot", { line: 2 });
  language.expectNoSpecification();
});

it("preserves independent mistakes when an extension target is unavailable", () => {
  const language = new CompositionExamples();
  language.entry("store", `extend Missing { capability save() returns Nothing }
function outside(value: Typo)`);

  language.compose();
  language.compile();

  language.expectProblem("unresolved-reference", "store", "Missing", { line: 1 });
  language.expectProblem("unresolved-reference", "store", "Typo", { line: 2 });
  language.expectNoSpecification();
});

it("augments an external concept without modifying its supplied contract", () => {
  const language = new CompositionExamples();
  language.entry("store", `use Store from "library"
extend Store {
  public save
  capability save() returns Nothing
}`);
  language.externalModule("library", [{ kind: "concept", name: "Store", public: [], members: [] }]);

  language.compose();
  language.compile();

  language.expectCompiled();
  language.expectCapabilities("library", "Store", ["save"]);
  language.expectDeclarationOrigin("library", "Store", { kind: "external", module: "library", path: [0] });
  language.expectCapabilityOrigin("library", "Store.save", "store", { line: 4 });
  language.expectOriginalConceptMembers("library", "Store", ["public"]);
});

it("preserves the scenario contract when an inline block is extracted", () => {
  const inline = new CompositionExamples();
  inline.entry("store", `concept StoreGame {
  capability save(snapshot: Text) returns Nothing
  examples {
    scenario "save the snapshot" {
      when save("current")
      then satisfies "The snapshot is saved."
    }
  }
}`);
  inline.compileSource();
  inline.expectCompiled();

  const separate = new CompositionExamples();
  separate.entry("store", `concept StoreGame { capability save(snapshot: Text) returns Nothing }
examples for StoreGame from "saving"`);
  separate.module("saving", `examples {
  scenario "save the snapshot" {
    when save("current")
    then satisfies "The snapshot is saved."
  }
}`);

  separate.compose();
  separate.compile();

  separate.expectCompiled();
  separate.expectScenarioContract("save the snapshot", {
    subject: "StoreGame", operation: "StoreGame.save", arguments: ["current"],
    expectation: "The snapshot is saved."
  });
  inline.expectScenarioContract("save the snapshot", {
    subject: "StoreGame", operation: "StoreGame.save", arguments: ["current"],
    expectation: "The snapshot is saved."
  });
  separate.expectScenarioOrigin("save the snapshot", "saving", { line: 2 });
  separate.expectNoPendingComposition();
});

it("allows attached examples to use their subject's local data", () => {
  const language = new CompositionExamples();
  language.entry("store", `concept StoreGame {
  local type SessionState { label: Text }
  capability save(snapshot: SessionState) returns Nothing
}
examples for StoreGame from "saving"`);
  language.module("saving", `examples {
  fixture state: SessionState = SessionState { label: "ready" }
  scenario "save private state" {
    when save(state)
    then true
  }
}`);

  language.compose();
  language.compile();

  language.expectCompiled();
  language.expectFixtureType("saving", "state", "store", "StoreGame.SessionState");
  language.expectScenarioSubject("save private state", "store", "StoreGame");
});

it("does not make a subject's local type available to outside code", () => {
  const language = new CompositionExamples();
  language.entry("store", `concept StoreGame { local type SessionState {} }
examples for StoreGame from "saving"
function outside(value: StoreGame.SessionState)`);
  language.module("saving", "examples { fixture state: SessionState = SessionState {} }");

  language.compose();
  language.compile();

  language.expectProblem("inaccessible-reference", "store", "StoreGame.SessionState", { line: 3 });
  language.expectNoSpecification();
});

it("keeps test operations private to each extracted examples block", () => {
  const language = new CompositionExamples();
  language.entry("store", `concept StoreGame {}
examples for StoreGame from "saving"`);
  language.module("saving", `examples { action prepare() returns Nothing }
examples {
  scenario "another block" {
    when prepare()
    then true
  }
}`);

  language.compose();
  language.compile();

  language.expectProblem("unresolved-reference", "saving", "prepare", { line: 4 });
  language.expectNoSpecification();
});

it("reports an unknown operation in the extracted file at its original location", () => {
  const language = new CompositionExamples();
  language.entry("store", `concept StoreGame { capability save() returns Nothing }
examples for StoreGame from "saving"`);
  language.module("saving", `examples {
  scenario "misspelled operation" {
    when saev()
    then true
  }
}`);

  language.compose();
  language.compile();

  language.expectProblem("unresolved-reference", "saving", "saev", { line: 3 });
  language.expectNoSpecification();
  language.expectNoPendingComposition();
});

it("attaches a named examples block to an explicitly imported subject", () => {
  const language = new CompositionExamples();
  language.entry("saving", `use StoreGame from "store"
examples for StoreGame {
  scenario "save" {
    when save()
    then true
  }
}`);
  language.module("store", "concept StoreGame { capability save() returns Nothing }");

  language.compose();
  language.compile();

  language.expectCompiled();
  language.expectScenarioSubject("save", "store", "StoreGame");
  language.expectNoPendingComposition();
});

it("rejects an attachment file whose explicit subject disagrees", () => {
  const language = new CompositionExamples();
  language.entry("store", `concept StoreGame {}
examples for StoreGame from "saving"`);
  language.module("saving", `concept Other {}
examples for Other { example "number": 1 => 1 }`);

  language.compose();
  language.compile();

  language.expectProblem("conflicting-example-subject", "saving", "Other", { line: 2 });
  language.expectRelatedOrigin("store", "StoreGame", { line: 2 });
  language.expectNoSpecification();
});

it("requires an examples block in an attached file", () => {
  const language = new CompositionExamples();
  language.entry("store", `concept StoreGame {}
examples for StoreGame from "saving"`);
  language.module("saving", "type Snapshot {}");

  language.compose();
  language.compile();

  language.expectProblem("empty-examples-source", "store", '"saving"', { line: 2 });
  language.expectNoSpecification();
});

it("does not assign one extracted block two different subjects", () => {
  const language = new CompositionExamples();
  language.entry("store", `concept First {}
concept Second {}
examples for First from "shared-examples"
examples for Second from "shared-examples"`);
  language.module("shared-examples", 'examples { example "number": 1 => 1 }');

  language.compose();
  language.compile();

  language.expectProblem("conflicting-example-subject", "store", "Second", { line: 4 });
  language.expectRelatedOrigin("store", "First", { line: 3 });
  language.expectNoSpecification();
});

it("checks an attached test-operation body without executing its call", () => {
  const language = new CompositionExamples();
  language.entry("store", `concept StoreGame { capability save() returns Nothing }
examples for StoreGame from "saving"`);
  language.module("saving", `examples {
  action saveIt() returns Nothing { do save() }
  scenario "save" {
    when saveIt()
    then true
  }
}`);

  language.compose();
  language.compile();

  language.expectCompiled();
  language.expectNoPendingComposition();
});

it("retains earlier composition results and authored models across calls", () => {
  const language = new CompositionExamples();
  language.entry("store", `include "saving"
concept StoreGame {}`);
  language.module("saving", `use StoreGame from "store"
extend StoreGame { capability save() returns Nothing }`);
  language.compose();
  language.compile();
  language.expectCompiled();
  language.expectCapabilities("store", "StoreGame", ["save"]);
  language.rememberResult("with save");

  language.module("saving", `use StoreGame from "store"
extend StoreGame { capability shutDown() returns Nothing }`);
  language.compose();
  language.compile();

  language.expectCompiled();
  language.expectCapabilities("store", "StoreGame", ["shutDown"]);
  language.expectRememberedCapabilities("with save", "store", "StoreGame", ["save"]);
  language.expectRememberedResultUnchanged("with save");
  language.expectAuthoredModelsUnchanged();
});

it("imports a public capability supplied by an extension", () => {
  const language = new CompositionExamples();
  language.entry("caller", `use Store.save from "store"
examples { example "saving": save() => satisfies "The game is saved." }`);
  language.module("store", `include "saving"
concept Store { public save }`);
  language.module("saving", `use Store from "store"
extend Store { capability save() returns Nothing }`);

  language.compose();
  language.compile();

  language.expectCompiled();
  language.expectCallTarget("caller", "saving", "store", "Store.save");
  language.expectOriginalMemberIdentity("saving", "save");
});

it("keeps each member's file fallback while sharing the owner's local declarations", () => {
  const language = new CompositionExamples();
  language.entry("store", `include "saving"
type Imported { count: Number }
concept Store {
  local type SessionState { label: Text }
  capability base(snapshot: Imported) returns Nothing
}`);
  language.module("saving", `use Store from "store"
use Snapshot as Imported from "models"
extend Store { capability save(snapshot: Imported, state: SessionState) returns Nothing }`);
  language.module("models", "type Snapshot { title: Text }");

  language.compose();
  language.compile();

  language.expectCompiled();
  language.expectParameterType("store", "Store.base", "snapshot", "store", "Imported");
  language.expectParameterType("store", "Store.save", "snapshot", "models", "Snapshot");
  language.expectParameterType("store", "Store.save", "state", "store", "Store.SessionState");
});

it("checks the input type of an imported capability contributed by an extension", () => {
  const language = new CompositionExamples();
  language.entry("caller", `use Store.save from "store"
examples { example "wrong snapshot": save(3) => satisfies "Saved." }`);
  language.module("store", `include "saving"
concept Store { public save }`);
  language.module("saving", `use Store from "store"
extend Store { capability save(snapshot: Text) returns Nothing }`);

  language.compose();
  language.compile();

  language.expectParameterType("store", "Store.save", "snapshot", "builtin", "Text");
  language.expectProblem("incompatible-type", "caller", "3", { line: 2 });
  language.expectNoSpecification();
  language.expectNoPendingComposition();
});

it("does not lend unrelated owner-file declarations to an extension", () => {
  const language = new CompositionExamples();
  language.entry("store", `include "saving"
type Hidden {}
concept Store {}`);
  language.module("saving", `use Store from "store"
extend Store { capability save(snapshot: Hidden) returns Nothing }`);

  language.compose();
  language.compile();

  language.expectProblem("unresolved-reference", "saving", "Hidden", { line: 2 });
  language.expectNoSpecification();
  language.expectNoPendingComposition();
});

it("orders contributions without changing their original identities or parents", () => {
  const language = new CompositionExamples();
  language.entry("store", `include "z-saving"
include "a-saving"
concept Store { capability first() returns Nothing }`);
  language.module("z-saving", `use Store from "store"
extend Store { capability last() returns Nothing }`);
  language.module("a-saving", `use Store from "store"
extend Store { capability middle() returns Nothing }`);

  language.compose();
  language.compile();

  language.expectCompiled();
  language.expectCapabilities("store", "Store", ["first", "middle", "last"]);
  language.expectMemberParent("a-saving", "middle", "store", "Store");
  language.expectMemberParent("z-saving", "last", "store", "Store");
  language.expectOriginalMemberParentKind("a-saving", "middle", "extend");
  language.expectConsumedDirectiveHandles("a-saving", "extend");
  language.expectAuthoredModelsUnchanged();
});

it("leaves an unreached extension unapplied", () => {
  const language = new CompositionExamples();
  language.entry("store", "concept Store {}");
  language.module("saving", `use Store from "store"
extend Store { capability save() returns Nothing }`);

  language.compose();
  language.compile();

  language.expectCompiled();
  language.expectCapabilities("store", "Store", []);
  language.expectNotAnalyzed("saving", "save");
});

it("accepts equivalent named subjects and repeated file attachments once", () => {
  const language = new CompositionExamples();
  language.entry("store", `concept Store { capability save() returns Nothing }
examples for Store from "saving"
examples for Store from "saving"`);
  language.module("saving", `use Store as Shop from "store"
examples for Shop { example "saving": save() => satisfies "Saved." }`);

  language.compose();
  language.compile();

  language.expectCompiled();
  language.expectExampleCount("saving", 1);
  language.expectExampleSubject("saving", "saving", "store", "Store");
  language.expectOriginalExampleIdentity("saving", "saving");
  language.expectSubjectBinding("saving", "Shop", "store", "Store");
  language.expectBlockIsNotRoot("saving", 0);
});

it("keeps an ownerless authored block ownerless in source after attachment", () => {
  const language = new CompositionExamples();
  language.entry("store", `concept Store {}
examples for Store from "saving"`);
  language.module("saving", 'examples { example "number": 1 => 1 }');

  language.compose();
  language.compile();

  language.expectCompiled();
  language.expectExampleSubject("saving", "number", "store", "Store");
  language.expectBlockHasNoAuthoredSubject("saving", 0);
  language.expectBlockHasNoSyntheticSubject("saving", 0);
  language.expectOriginalBlockIsRoot("saving", 0);
  language.expectBlockIsNotRoot("saving", 0);
});

it("uses each attachment directive's original module for relative lookup", () => {
  const language = new CompositionExamples();
  language.entry("entry", `use Left from "left/store"
use Right from "right/store"`);
  language.module("left/store", `concept Left {}
examples for Left from "./examples.expec"`);
  language.module("right/store", `concept Right {}
examples for Right from "./examples.expec"`);
  language.module("left/examples", 'examples { example "left": 1 => 1 }');
  language.module("right/examples", 'examples { example "right": 2 => 2 }');
  language.mapsModule("left/store", "./examples.expec", "left/examples");
  language.mapsModule("right/store", "./examples.expec", "right/examples");

  language.compose();
  language.compile();

  language.expectCompiled();
  language.expectExampleSubject("left/examples", "left", "left/store", "Left");
  language.expectExampleSubject("right/examples", "right", "right/store", "Right");
  language.expectExampleOrigin("left/examples", "left", { line: 1 });
  language.expectExampleOrigin("right/examples", "right", { line: 1 });
});

it("keeps attachment cycles finite when every block has the same subject", () => {
  const language = new CompositionExamples();
  language.entry("a", `concept Store {}
examples for Store from "b"
examples { example "a": 1 => 1 }`);
  language.module("b", `use Store from "a"
examples for Store from "a"
examples { example "b": 2 => 2 }`);

  language.compose();
  language.compile();

  language.expectCompiled();
  language.expectExampleCount("a", 1);
  language.expectExampleCount("b", 1);
  language.expectExampleSubject("a", "a", "a", "Store");
  language.expectExampleSubject("b", "b", "a", "Store");
  language.expectNoProblem("include-cycle");
});

it("does not treat transitively included blocks as directly attached blocks", () => {
  const language = new CompositionExamples();
  language.entry("store", `concept Store {}
examples for Store from "saving"`);
  language.module("saving", 'include "shared-examples"');
  language.module("shared-examples", 'examples { example "number": 1 => 1 }');

  language.compose();
  language.compile();

  language.expectProblem("empty-examples-source", "store", '"saving"', { line: 2 });
  language.expectBlockIsRoot("shared-examples", 0);
  language.expectNoSpecification();
});

it("does not invent a winner for conflicting subjects", () => {
  const language = new CompositionExamples();
  language.entry("store", `concept First {}
concept Second {}
examples for First from "saving"
examples for Second from "saving"`);
  language.module("saving", 'examples { example "number": 1 => 1 }');

  language.compose();
  language.compile();

  language.expectProblem("conflicting-example-subject", "store", "Second", { line: 4 });
  language.expectRelatedOrigin("store", "First", { line: 3 });
  language.expectBlockNotAnalyzed("saving", 0);
  language.expectNoOwnedExamples("store", "First");
  language.expectNoOwnedExamples("store", "Second");
  language.expectNoSpecification();
});

it("attaches examples to an external record without changing its fields", () => {
  const language = new CompositionExamples();
  language.entry("examples", `use Book from "library"
examples for Book {
  fixture book: Book = Book { copies: 1 }
  example "copies": book.copies => 1
}`);
  language.externalModule("library", [{ kind: "record-type", name: "Book", fields: [
    { kind: "field", name: "copies", type: { kind: "builtin", name: "Number" } }
  ] }]);

  language.compose();
  language.compile();

  language.expectCompiled();
  language.expectExampleSubject("examples", "copies", "library", "Book");
  language.expectFields("library", "Book", ["copies"]);
  language.expectFixtureType("examples", "book", "library", "Book");
  language.expectAuthoredModelsUnchanged();
});

it("does not turn a callable subject's parameters into example data", () => {
  const language = new CompositionExamples();
  language.entry("examples", `function double(amount: Number) returns Number
examples for double { example "missing argument": amount => 2 }`);

  language.compose();
  language.compile();

  language.expectExampleSubject("examples", "missing argument", "examples", "double");
  language.expectProblem("unavailable-value", "examples", "amount", { line: 2 });
  language.expectNoSpecification();
  language.expectNoPendingComposition();
});

it("retains a builtin subject without inventing a declaration in source", () => {
  const language = new CompositionExamples();
  language.entry("examples", 'examples for Text { example "text": "ready" => "ready" }');

  language.compose();
  language.compile();

  language.expectCompiled();
  language.expectBuiltinExampleSubject("text", "Text");
  language.expectAuthoredDeclarationCount("Text", 0);
  language.expectOriginalExampleIdentity("examples", "text");
});

it("does not claim an invalid extension subtree was analyzed", () => {
  const language = new CompositionExamples();
  language.entry("store", `extend Missing { capability save() returns Nothing }
type Settings { count: Number = "many" }`);

  language.compose();
  language.compile();

  language.expectProblem("unresolved-reference", "store", "Missing", { line: 1 });
  language.expectProblem("incompatible-type", "store", '"many"', { line: 2 });
  language.expectNotAnalyzed("store", "save");
  language.expectNoSpecification();
  language.expectNoPendingComposition();
});

it("checks independent declarations in a file reached by an invalid attachment", () => {
  const language = new CompositionExamples();
  language.entry("store", 'examples for Missing from "saving"');
  language.module("saving", `type Settings { count: Number = "many" }
examples { example "number": 1 => 1 }`);

  language.compose();
  language.compile();

  language.expectProblem("unresolved-reference", "store", "Missing", { line: 1 });
  language.expectProblem("incompatible-type", "saving", '"many"', { line: 1 });
  language.expectBlockNotAnalyzed("saving", 0);
  language.expectNoSpecification();
  language.expectNoPendingComposition();
});
});
