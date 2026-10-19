import { describe, it } from 'vitest';
import { CheckedNames } from '../../dsl/compiler/checked-names.js';

describe('editor consumers ask for checked source-name ownership', () => {
  it('keeps same-typed fields distinct in record labels and member reads', () => {
    const language = new CheckedNames();
    language.source('book', `type Book { title: Text }
type Author { title: Text }
examples {
  fixture book: Book = { title: "A" }
  fixture author: Author = { title: "B" }
  fixture bookTitle: Text = book.title
  fixture authorTitle: Text = author.title
}`);
    language.compile();

    language.collectNamesInSource('book.expec');

    language.expectCollectedNameAt('book.expec', 4, 26, 31, 'title',
      { kind: 'field', sourceId: 'book.expec', line: 1, column: 13 });
    language.expectCollectedNameAt('book.expec', 6, 34, 39, 'title',
      { kind: 'field', sourceId: 'book.expec', line: 1, column: 13 });
    language.expectNameAt('book.expec', 7, 38, 43, 'title',
      { kind: 'field', sourceId: 'book.expec', line: 2, column: 15 });
    language.expectOccurrencesOwnedAt('book.expec', 1, 13, [
      { sourceId: 'book.expec', line: 1, column: 13, endColumn: 18, spelling: 'title' },
      { sourceId: 'book.expec', line: 4, column: 26, endColumn: 31, spelling: 'title' },
      { sourceId: 'book.expec', line: 6, column: 34, endColumn: 39, spelling: 'title' },
    ]);
    language.expectOccurrencesOwnedAt('book.expec', 2, 15, [
      { sourceId: 'book.expec', line: 2, column: 15, endColumn: 20, spelling: 'title' },
      { sourceId: 'book.expec', line: 5, column: 30, endColumn: 35, spelling: 'title' },
      { sourceId: 'book.expec', line: 7, column: 38, endColumn: 43, spelling: 'title' },
    ]);
  });

  it('keeps equal Number locals attached to their actual helper declarations', () => {
    const language = new CheckedNames();
    language.source('locals', `examples {
  observation first() returns Number {
    let count = 1
    return count
  }
  observation second() returns Number {
    let count = 2
    return count
  }
}`);
    language.compile();

    // Reverse query order cannot change the declaration chosen during checking.
    language.expectNameAt('locals.expec', 8, 12, 17, 'count',
      { kind: 'let', sourceId: 'locals.expec', line: 7, column: 9 });
    language.expectNameAt('locals.expec', 4, 12, 17, 'count',
      { kind: 'let', sourceId: 'locals.expec', line: 3, column: 9 });
    language.expectOccurrencesOwnedAt('locals.expec', 3, 9, [
      { sourceId: 'locals.expec', line: 3, column: 9, endColumn: 14, spelling: 'count' },
      { sourceId: 'locals.expec', line: 4, column: 12, endColumn: 17, spelling: 'count' },
    ]);
    language.expectOccurrencesOwnedAt('locals.expec', 7, 9, [
      { sourceId: 'locals.expec', line: 7, column: 9, endColumn: 14, spelling: 'count' },
      { sourceId: 'locals.expec', line: 8, column: 12, endColumn: 17, spelling: 'count' },
    ]);
  });

  it('keeps equal Number captures attached to their authored scenario names', () => {
    const language = new CheckedNames();
    language.source('captures', `examples {
  action number() returns Number
  scenario "first" {
    when count = number()
    then count == 1
  }
  scenario "second" {
    when count = number()
    then count == 2
  }
}`);
    language.compile();

    language.expectNameAt('captures.expec', 9, 10, 15, 'count',
      { kind: 'name', sourceId: 'captures.expec', line: 8, column: 10 });
    language.expectNameAt('captures.expec', 5, 10, 15, 'count',
      { kind: 'name', sourceId: 'captures.expec', line: 4, column: 10 });
    language.expectOccurrencesOwnedAt('captures.expec', 4, 10, [
      { sourceId: 'captures.expec', line: 4, column: 10, endColumn: 15, spelling: 'count' },
      { sourceId: 'captures.expec', line: 5, column: 10, endColumn: 15, spelling: 'count' },
    ]);
    language.expectOccurrencesOwnedAt('captures.expec', 8, 10, [
      { sourceId: 'captures.expec', line: 8, column: 10, endColumn: 15, spelling: 'count' },
      { sourceId: 'captures.expec', line: 9, column: 10, endColumn: 15, spelling: 'count' },
    ]);
  });

  it('distinguishes a same-spelled alias and the individual qualified name segments', () => {
    const language = new CheckedNames();
    language.source('entry', `use Book as Book from "book"
use Library as L from "library"
type Basket { book: Book }
examples for L.save {}`);
    language.module('book', 'type Book {}');
    language.module('library', `component Library {
  public save
  capability save() returns Nothing
}`);
    language.compile();

    language.expectNameAt('entry.expec', 1, 5, 9, 'Book',
      { kind: 'record-type-declaration', sourceId: 'book.expec', line: 1, column: 6 });
    language.expectNameAt('entry.expec', 1, 13, 17, 'Book',
      { kind: 'name', sourceId: 'entry.expec', line: 1, column: 13 });
    language.expectNameAt('entry.expec', 3, 21, 25, 'Book',
      { kind: 'name', sourceId: 'entry.expec', line: 1, column: 13 });
    language.expectNameAt('entry.expec', 4, 14, 15, 'L',
      { kind: 'name', sourceId: 'entry.expec', line: 2, column: 16 });
    language.expectNameAt('entry.expec', 4, 16, 20, 'save',
      { kind: 'capability', sourceId: 'library.expec', line: 3, column: 14 });
    language.expectOccurrencesOwnedAt('book.expec', 1, 6, [
      { sourceId: 'book.expec', line: 1, column: 6, endColumn: 10, spelling: 'Book' },
      { sourceId: 'entry.expec', line: 1, column: 5, endColumn: 9, spelling: 'Book' },
    ]);
    language.expectOccurrencesOwnedAt('entry.expec', 1, 13, [
      { sourceId: 'entry.expec', line: 1, column: 13, endColumn: 17, spelling: 'Book' },
      { sourceId: 'entry.expec', line: 3, column: 21, endColumn: 25, spelling: 'Book' },
    ]);
  });

  it('does not invent a source declaration for a contextual result', () => {
    const language = new CheckedNames();
    language.source('result', `function count() returns Number {
  ensures result > 0
}
examples {
  observation copied() returns Number {
    let result = 1
    return result
  }
}`);
    language.compile();

    // Ordinary known absence comes from the query, not a driver keyword check.
    language.collectNamesInSource('result.expec');
    language.expectNoCollectedEditableNameAt('result.expec', 2, 11);
    language.expectNoEditableNameAt('result.expec', 2, 11);
    language.expectNameAt('result.expec', 7, 12, 18, 'result',
      { kind: 'let', sourceId: 'result.expec', line: 6, column: 9 });
    language.expectOccurrencesOwnedAt('result.expec', 6, 9, [
      { sourceId: 'result.expec', line: 6, column: 9, endColumn: 15, spelling: 'result' },
      { sourceId: 'result.expec', line: 7, column: 12, endColumn: 18, spelling: 'result' },
    ]);
  });

  it('publishes only the accepted union record candidate field binding', () => {
    const language = new CheckedNames();
    language.source('union', `type First {
  title: Text
  extra: Number
}
type Second { title: Text }
examples {
  fixture book: First | Second = { title: "A" }
}`);
    language.compile();

    language.expectNameAt('union.expec', 7, 36, 41, 'title',
      { kind: 'field', sourceId: 'union.expec', line: 5, column: 15 });
    language.expectOccurrencesOwnedAt('union.expec', 2, 3, [
      { sourceId: 'union.expec', line: 2, column: 3, endColumn: 8, spelling: 'title' },
    ]);
    language.expectOccurrencesOwnedAt('union.expec', 5, 15, [
      { sourceId: 'union.expec', line: 5, column: 15, endColumn: 20, spelling: 'title' },
      { sourceId: 'union.expec', line: 7, column: 36, endColumn: 41, spelling: 'title' },
    ]);
  });

  it('keeps an earlier compilation answer intact and queries without more analysis', () => {
    const language = new CheckedNames();
    language.source('book', `type Book { title: Text }
examples { fixture book: Book = { title: "A" } }`);
    language.compile();
    language.rememberOccurrencesOwnedAt('book.expec', 1, 13);

    language.source('book', `type Book { name: Text }
examples { fixture book: Book = { name: "B" } }`);
    language.compileUsingSameCompiler();
    language.rememberAnalysisWork();

    language.collectNamesInSource('book.expec');
    language.expectNameAt('book.expec', 2, 35, 39, 'name',
      { kind: 'field', sourceId: 'book.expec', line: 1, column: 13 });
    language.expectOccurrencesOwnedAt('book.expec', 1, 13, [
      { sourceId: 'book.expec', line: 1, column: 13, endColumn: 17, spelling: 'name' },
      { sourceId: 'book.expec', line: 2, column: 35, endColumn: 39, spelling: 'name' },
    ]);
    // Checks both the actual remembered answer and another query on its old Specification.
    language.expectRememberedOccurrences([
      { sourceId: 'book.expec', line: 1, column: 13, endColumn: 18, spelling: 'title' },
      { sourceId: 'book.expec', line: 2, column: 35, endColumn: 40, spelling: 'title' },
    ]);
    language.expectNoAdditionalAnalysis();
  });
});
