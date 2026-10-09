import { describe, it } from "vitest";
import { SourceReading } from "../../dsl/language/source-reading.js";

describe("an author reads a specification", () => {
  it("preserves a plain concept name at its authored location", () => {
    const language = new SourceReading();
    language.sourceIs("concept StoreGame {}");

    language.readSource();

    language.expectConceptNamed("StoreGame", { quoted: false, at: { line: 1, column: 9 } });
    language.expectOriginalSourcePreserved();
    language.expectGrammarVersion("candidate-0.1");
  });

  it("preserves spaces in a quoted concept name at its authored location", () => {
    const language = new SourceReading();
    language.sourceIs('concept `Store Game` {}');

    language.readSource();

    language.expectConceptNamed("Store Game", { quoted: true, at: { line: 1, column: 9 } });
    language.expectOriginalSourcePreserved();
    language.expectGrammarVersion("candidate-0.1");
  });
});

describe("receiving located syntax problems", () => {
  it('locates a missing closing brace after the last authored line', () => {
    const language = new SourceReading();
    language.sourceIs('type Book {\n  title: Text\n');
    language.readSource();
    language.expectSyntaxProblem({
      category: 'expected-token',
      primaryRange: { start: { offset: 26, line: 3, column: 1 }, end: { offset: 26, line: 3, column: 1 } },
      relatedRanges: [{ start: { offset: 10, line: 1, column: 11 }, end: { offset: 11, line: 1, column: 12 } }],
    });
  });

  it('locates missing syntax after a same-line opening brace', () => {
    const language = new SourceReading();
    language.sourceIs('type Draft {');
    language.readSource();
    language.expectSyntaxProblem({
      category: 'expected-token',
      primaryRange: { start: { offset: 12, line: 1, column: 13 }, end: { offset: 12, line: 1, column: 13 } },
      relatedRanges: [{ start: { offset: 11, line: 1, column: 12 }, end: { offset: 12, line: 1, column: 13 } }],
    });
  });

  it('counts Unicode scalars when locating missing syntax', () => {
    const language = new SourceReading();
    language.sourceIs('type `📚` {');
    language.readSource();
    language.expectSyntaxProblem({
      category: 'expected-token',
      primaryRange: { start: { offset: 10, line: 1, column: 11 }, end: { offset: 10, line: 1, column: 11 } },
      relatedRanges: [{ start: { offset: 9, line: 1, column: 10 }, end: { offset: 10, line: 1, column: 11 } }],
    });
  });

  it('keeps an ordinary erroneous token at its authored location', () => {
    const language = new SourceReading();
    language.sourceIs('type `📚` {\n  title Text\n}');
    language.readSource();
    language.expectSyntaxProblem({
      category: 'expected-token',
      primaryRange: { start: { offset: 19, line: 2, column: 9 }, end: { offset: 23, line: 2, column: 13 } },
      relatedRanges: [],
    });
  });
});
