import { describe, it } from 'vitest';
import { CheckedNames } from '../../dsl/compiler/checked-names.js';

describe('source-name query completeness and caller boundaries', () => {

it("keeps compilation success while accepted collection alternatives disagree on a field", () => {
  const language = new CheckedNames();
  language.source("choices", `type First { title: Text }
type Second { title: Text }
examples {
  fixture books: List<First> | List<Second> = [{ title: "A" }]
}`);
  language.compile();
  language.expectNameProblemAt("choices.expec", 4, 50, "ambiguous-source-name");
  language.expectSourceNamesProblem("choices.expec", "ambiguous-source-name");
  language.expectOccurrencesProblemOwnedAt("choices.expec", 1, 14, "ambiguous-source-name");
});

it("returns the whole quoted Unicode token in scalar coordinates", () => {
  const language = new CheckedNames();
  language.source("unicode", "type `Book 📚` {}");
  language.compile();
  language.expectNameAt("unicode.expec", 1, 6, 14, "Book 📚",
    { kind: "record-type-declaration", sourceId: "unicode.expec", line: 1, column: 6 });
  language.expectSameNameAt("unicode.expec", 1, 12, 1, 6);
  // Query inside emoji; expected whole range starts at column 6, exclusive end 14.
  // Driver must separately assert whole start=6, not assume start=query column.
});

it("rejects unknown sources, invalid offsets and foreign or unsuitable handles", () => {
  const language = new CheckedNames();
  language.source("book", "type Book {}");
  language.compile();
  language.expectUnknownNameSource("missing.expec");
  language.expectInvalidNameOffsets("book.expec", [-1, 0.5, NaN, Infinity]);
  language.expectForeignNameOwnerRejected();
  language.expectNonIntroductionNameOwnerRejected();
  language.expectNoEditableNameAt("book.expec", 1, 5);
});

it("keeps index and previous answers isolated from returned-list/range mutation", () => {
  const language = new CheckedNames();
  language.source("book", "type Book {}");
  language.compile();
  language.rememberOccurrencesOwnedAt("book.expec", 1, 6);
  language.tryToMutateReturnedNames();
  language.expectRememberedOccurrences([
    { sourceId: "book.expec", line: 1, column: 6, endColumn: 10, spelling: "Book" },
  ]);
});

it("does not report a complete list when a supplied resolution lacks capture evidence", () => {
  const language = new CheckedNames();
  language.source("book", `type Book {}
type Shelf { item: Book }`);
  language.compileUsingPublicModelWithoutPrivateEvidence();
  language.expectSourceNamesRequirement("book.expec", "source-name-selection");
  language.expectOccurrencesRequirementOwnedAt("book.expec", 1, 6, "source-name-selection");
});

it("retains message endpoint identities and reads the actual captured reply", () => {
  const language = new CheckedNames();
  language.source("messages", `concept Shop {
  public count, consume
  capability count() returns Number
  capability consume(value: Number) returns Nothing
}
interaction "send count"() {
  participant shopper: Shop
  participant store: Shop
  message shopper -> store.count() as count
  message store -> shopper.consume(count)
}`);
  language.compile();

  language.expectNameAt("messages.expec", 9, 11, 18, "shopper",
    { kind: "participant", sourceId: "messages.expec", line: 7, column: 15 });
  language.expectNameAt("messages.expec", 9, 22, 27, "store",
    { kind: "participant", sourceId: "messages.expec", line: 8, column: 15 });
  language.expectNameAt("messages.expec", 10, 11, 16, "store",
    { kind: "participant", sourceId: "messages.expec", line: 8, column: 15 });
  language.expectNameAt("messages.expec", 10, 20, 27, "shopper",
    { kind: "participant", sourceId: "messages.expec", line: 7, column: 15 });
  language.expectNameAt("messages.expec", 9, 28, 33, "count",
    { kind: "capability", sourceId: "messages.expec", line: 3, column: 14 });
  language.expectNameAt("messages.expec", 10, 28, 35, "consume",
    { kind: "capability", sourceId: "messages.expec", line: 4, column: 14 });
  language.expectNameAt("messages.expec", 9, 39, 44, "count",
    { kind: "name", sourceId: "messages.expec", line: 9, column: 39 });
  language.expectNameAt("messages.expec", 10, 36, 41, "count",
    { kind: "name", sourceId: "messages.expec", line: 9, column: 39 });
  language.expectOccurrencesOwnedAt("messages.expec", 9, 39, [
    { sourceId: "messages.expec", line: 9, column: 39, endColumn: 44, spelling: "count" },
    { sourceId: "messages.expec", line: 10, column: 36, endColumn: 41, spelling: "count" },
  ]);
});

it('retains authored extension and attached-example subject names after composition', () => {
  const language = new CheckedNames();
  language.source('store', `include "saving"
concept Store {}
examples for Store from "examples"`);
  language.module('saving', `use Store from "store"
extend Store { capability save() returns Nothing }`);
  language.module('examples', 'examples {}');
  language.compile();

  language.expectNameAt('saving.expec', 2, 8, 13, 'Store',
    { kind: 'concept', sourceId: 'store.expec', line: 2, column: 9 });
  language.expectNameAt('store.expec', 3, 14, 19, 'Store',
    { kind: 'concept', sourceId: 'store.expec', line: 2, column: 9 });
  language.expectOccurrencesOwnedAt('store.expec', 2, 9, [
    { sourceId: 'saving.expec', line: 1, column: 5, endColumn: 10, spelling: 'Store' },
    { sourceId: 'saving.expec', line: 2, column: 8, endColumn: 13, spelling: 'Store' },
    { sourceId: 'store.expec', line: 2, column: 9, endColumn: 14, spelling: 'Store' },
    { sourceId: 'store.expec', line: 3, column: 14, endColumn: 19, spelling: 'Store' },
  ]);
});
});
