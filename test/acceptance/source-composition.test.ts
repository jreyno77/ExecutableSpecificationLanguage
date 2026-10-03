import { describe, it } from 'vitest';
import { CompositionExamples } from '../dsl/source-composition.js';

describe('an author compiles explicitly supplied modules and includes', () => {
  it("uses declared source imports through the real compiler", () => {
    const language = new CompositionExamples();
    language.entry("store", `use PlayerStateSnapshot from "player-state"
  use ShoppingCart from "shopping-cart"
  concept StoreGame {
    public save
    capability save(snapshot: PlayerStateSnapshot, cart: ShoppingCart) returns Nothing
  }`);
    language.module("player-state", `use ShoppingCart from "shopping-cart"
  type PlayerStateSnapshot { shoppingCart: ShoppingCart }`);
    language.module("shopping-cart", "type ShoppingCart { itemsCount: Number }");
  
    language.compose();
    language.compile();
  
    language.expectCompiled();
    language.expectParameterType("store", "StoreGame.save", "snapshot", "player-state", "PlayerStateSnapshot");
    language.expectSameFieldAndParameterType("player-state", "PlayerStateSnapshot", "shoppingCart", "store", "StoreGame.save", "cart");
    language.expectOriginalDeclarationIdentity("shopping-cart", "ShoppingCart");
  });
  
  it("keeps identical relative spellings local to their containing modules", () => {
    const language = new CompositionExamples();
    language.entry("store", `use Cart from "left/cart"
  use Order from "right/order"`);
    language.module("left/cart", `use Item from "./types.expec"
  type Cart { item: Item }`);
    language.module("right/order", `use Item from "./types.expec"
  type Order { item: Item }`);
    language.module("left/types", "type Item { label: Text }");
    language.module("right/types", "type Item { count: Number }");
    language.mapsModule("left/cart", "./types.expec", "left/types");
    language.mapsModule("right/order", "./types.expec", "right/types");
  
    language.compose();
    language.compile();
  
    language.expectCompiled();
    language.expectFieldType("left/cart", "Cart", "item", "left/types", "Item");
    language.expectFieldType("right/order", "Order", "item", "right/types", "Item");
    language.expectAuthoredLocator("left/cart", "./types.expec");
    language.expectAuthoredLocator("right/order", "./types.expec");
  });
  
  it("does not borrow a declaration from a supplied but unrelated file", () => {
    const language = new CompositionExamples();
    language.entry("store", "function save(snapshot: Snapshot) returns Nothing");
    language.module("nearby", "type Snapshot {}");
  
    language.compose();
    language.compile();
  
    language.expectProblem("unresolved-reference", "store", "Snapshot", { line: 1 });
    language.expectNoSpecification();
    language.expectNotAnalyzed("nearby", "Snapshot");
  });
  
  it("reports the missing relative dependency at the actual importing source", () => {
    const language = new CompositionExamples();
    language.entry("store", 'use Cart from "models/cart"');
    language.module("models/cart", `use Item from "./types.expec"
  type Cart { item: Item }`);
    language.mapsModule("models/cart", "./types.expec", "models/types");
  
    language.compose();
    language.compile();
  
    language.expectProblem("unavailable-module", "models/cart", "Item", { line: 1 });
    language.expectRelatedDependency(["modules", "models/types"]);
    language.expectNoSpecification();
  });
  
  it("includes shared declarations and preserves their own source identity", () => {
    const language = new CompositionExamples();
    language.entry("store", `include "shared"
  function save(snapshot: Snapshot) returns Nothing`);
    language.module("shared", "type Snapshot { name: Text }");
  
    language.compose();
    language.compile();
  
    language.expectCompiled();
    language.expectParameterType("store", "save", "snapshot", "shared", "Snapshot");
    language.expectOriginalDeclarationIdentity("shared", "Snapshot");
    language.expectNoPendingComposition();
  });
  
  it("reuses one included declaration reached through two paths", () => {
    const language = new CompositionExamples();
    language.entry("store", `include "left"
  include "right"
  function save(item: Item) returns Nothing`);
    language.module("left", 'include "shared"');
    language.module("right", 'include "shared"');
    language.module("shared", "type Item { count: Number }");
  
    language.compose();
    language.compile();
  
    language.expectCompiled();
    language.expectDeclarationCount("Item", 1);
    language.expectOriginalDeclarationIdentity("shared", "Item");
  });
  
  it("selectively imports declarations re-exported by an included source", () => {
    const language = new CompositionExamples();
    language.entry("store", `use Book as Product from "catalog"
  function save(book: Product) returns Nothing`);
    language.module("catalog", 'include "books"');
    language.module("books", "type Book { title: Text }");
  
    language.compose();
    language.compile();
  
    language.expectCompiled();
    language.expectParameterType("store", "save", "book", "books", "Book");
    language.expectOriginalDeclarationIdentity("books", "Book");
  });
  
  it("does not let a caller repair an included declaration's missing dependency", () => {
    const language = new CompositionExamples();
    language.entry("store", `include "shared"
  type Missing {}
  function save(snapshot: Snapshot) returns Nothing`);
    language.module("shared", "type Snapshot { value: Missing }");
  
    language.compose();
    language.compile();
  
    language.expectProblem("unresolved-reference", "shared", "Missing", { line: 1 });
    language.expectNoSpecification();
  });
  
  it("reports distinct included declarations with the same visible name", () => {
    const language = new CompositionExamples();
    language.entry("store", `include "left"
  include "right"`);
    language.module("left", "type Item { title: Text }");
    language.module("right", "type Item { count: Number }");
  
    language.compose();
    language.compile();
  
    language.expectProblem("duplicate-declaration", "right", "type Item", { line: 1 });
    language.expectRelatedOrigin("left", "type Item", { line: 1 });
    language.expectNoSpecification();
  });
  
  it("reports the actual include cycle", () => {
    const language = new CompositionExamples();
    language.entry("a", 'include "b"');
    language.module("b", 'include "c"');
    language.module("c", 'include "a"');
  
    language.compose();
    language.compile();
  
    language.expectProblem("include-cycle", "c", 'include "a"', { line: 1 });
    language.expectRelatedOrigins([
      { module: "a", text: 'include "b"', line: 1 },
      { module: "b", text: 'include "c"', line: 1 }
    ]);
    language.expectNoSpecification();
  });
  
  it("keeps valid declaration import cycles distinct from include cycles", () => {
    const language = new CompositionExamples();
    language.entry("a", `use B from "b"
  type A { other: B? }`);
    language.module("b", `use A from "a"
  type B { other: A? }`);
  
    language.compose();
    language.compile();
  
    language.expectCompiled();
    language.expectNoProblem("include-cycle");
    language.expectOriginalDeclarationIdentity("a", "A");
    language.expectOriginalDeclarationIdentity("b", "B");
  });
  
  it("does not override an authored declaration with an included one", () => {
    const language = new CompositionExamples();
    language.entry("store", `include "shared"
  type Item { title: Text }`);
    language.module("shared", "type Item { count: Number }");
  
    language.compose();
    language.compile();
  
    language.expectProblem("duplicate-declaration", "shared", "type Item", { line: 1 });
    language.expectRelatedOrigin("store", "type Item", { line: 2 });
    language.expectNoSpecification();
  });
  
  it("does not copy an included module's imported alias into its caller", () => {
    const language = new CompositionExamples();
    language.entry("store", `include "catalog"
  function save(book: Hidden) returns Nothing`);
    language.module("catalog", `use Book as Hidden from "books"
  type Shelf { book: Hidden }`);
    language.module("books", "type Book { title: Text }");
  
    language.compose();
    language.compile();
  
    language.expectFieldType("catalog", "Shelf", "book", "books", "Book");
    language.expectProblem("unresolved-reference", "store", "Hidden", { line: 2 });
    language.expectNoSpecification();
  });
  
  it("does not re-export an included module's imported alias", () => {
    const language = new CompositionExamples();
    language.entry("store", 'use Hidden from "catalog"');
    language.module("catalog", 'include "shelves"');
    language.module("shelves", 'use Book as Hidden from "books"');
    language.module("books", "type Book { title: Text }");
  
    language.compose();
    language.compile();
  
    language.expectProblem("unresolved-reference", "store", "Hidden", { line: 1 });
    language.expectNoSpecification();
  });
  
  it("keeps local named members and non-public capabilities private through includes", () => {
    const language = new CompositionExamples();
    language.entry("store", `include "catalog"
  function outside(snapshot: StoreGame.SessionState) returns Nothing
  use StoreGame.save from "catalog"`);
    language.module("catalog", 'include "game"');
    language.module("game", `concept StoreGame {
    local type SessionState { title: Text }
    capability save(snapshot: SessionState) returns Nothing
  }`);
  
    language.compose();
    language.compile();
  
    language.expectParameterType("game", "StoreGame.save", "snapshot", "game", "StoreGame.SessionState");
    language.expectProblem("inaccessible-reference", "store", "StoreGame.SessionState", { line: 2 });
    language.expectProblem("inaccessible-reference", "store", "StoreGame.save", { line: 3 });
    language.expectNoSpecification();
  });
  
  it("resolves relative includes in their original containing modules", () => {
    const language = new CompositionExamples();
    language.entry("store", `use Cart from "left/cart"
  use Order from "right/order"`);
    language.module("left/cart", `include "./types.expec"
  type Cart { item: Item }`);
    language.module("right/order", `include "./types.expec"
  type Order { item: Item }`);
    language.module("left/types", "type Item { label: Text }");
    language.module("right/types", "type Item { count: Number }");
    language.mapsModule("left/cart", "./types.expec", "left/types");
    language.mapsModule("right/order", "./types.expec", "right/types");
  
    language.compose();
    language.compile();
  
    language.expectCompiled();
    language.expectFieldType("left/cart", "Cart", "item", "left/types", "Item");
    language.expectFieldType("right/order", "Order", "item", "right/types", "Item");
    language.expectAuthoredLocator("left/cart", "./types.expec");
    language.expectAuthoredLocator("right/order", "./types.expec");
  });
  
  it("uses the external declaration's module when resolving its supplied type metadata", () => {
    const language = new CompositionExamples();
    language.entry("store", 'use Cart from "library/cart"');
    language.externalModule("library/cart", [{
      kind: "record-type", name: "Cart", fields: [{
        kind: "field", name: "item",
        type: { kind: "named", path: ["Item"], module: "./types.expec" }
      }]
    }]);
    language.module("library/types", "type Item { label: Text }");
    language.module("store/types", "type Item { count: Number }");
    language.mapsModule("library/cart", "./types.expec", "library/types");
  
    language.compose();
    language.compile();
  
    language.expectCompiled();
    language.expectFieldType("library/cart", "Cart", "item", "library/types", "Item");
    language.expectExternalFieldOrigin("library/cart", "Cart", "item", [0, "fields", 0]);
    language.expectNotAnalyzed("store/types", "Item");
  });
  
  it("keeps an extension pending after successfully handling an include", () => {
    const language = new CompositionExamples();
    language.entry("store", `include "shared"
  concept StoreGame {}
  extend StoreGame { capability save() returns Nothing }`);
    language.module("shared", "type Snapshot { title: Text }");
  
    language.compose();
    language.compile();
  
    language.expectOriginalDeclarationIdentity("shared", "Snapshot");
    language.expectDeferred("composition", "store", { line: 3 });
    language.expectNoSpecification();
  });
  
  it("keeps an examples attachment pending after successfully handling an include", () => {
    const language = new CompositionExamples();
    language.entry("store", `include "shared"
  concept StoreGame {}
  examples for StoreGame from "saving"`);
    language.module("shared", "type Snapshot { title: Text }");
    language.module("saving", 'examples { example "number": 1 => 1 }');
  
    language.compose();
    language.compile();
  
    language.expectOriginalDeclarationIdentity("shared", "Snapshot");
    language.expectDeferred("composition", "store", { line: 3 });
    language.expectNoSpecification();
  });
  
  it("retains included facts and authored models across calls", () => {
    const language = new CompositionExamples();
    language.entry("store", `include "shared"
  function save(item: Item) returns Nothing`);
    language.module("shared", "type Item { count: Number }");
    language.compose();
    language.compile();
    language.expectCompiled();
    language.expectParameterType("store", "save", "item", "shared", "Item");
    language.rememberResult("valid included data");
  
    language.module("shared", "type Item { count: Unknown }");
    language.compose();
    language.compile();
  
    language.expectProblem("unresolved-reference", "shared", "Unknown", { line: 1 });
    language.expectNoSpecification();
    language.expectRememberedResultUnchanged("valid included data");
    language.expectAuthoredModelsUnchanged();
  });
  
  it("keeps an unrelated invalid default visible when an include is missing", () => {
    const language = new CompositionExamples();
    language.entry("store", `include "missing"
  type Settings { copies: Number = "many" }`);
  
    language.compose();
    language.compile();
  
    language.expectProblem("unavailable-module", "store", '"missing"', { line: 1 });
    language.expectProblem("incompatible-type", "store", '"many"', { line: 2 });
    language.expectNoSpecification();
  });
  
});

