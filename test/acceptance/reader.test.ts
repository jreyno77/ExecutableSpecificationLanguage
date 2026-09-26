import { describe, it } from "vitest";
import { SourceReading } from "../support/source-reading.js";

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
