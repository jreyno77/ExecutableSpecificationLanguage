import { describe, it } from "vitest";
import { SourceReading } from "../support/source-reading.js";

describe("an author reads a specification", () => {
  it.each([
    { spelling: "a plain concept name", fixture: "valid/store-game.expec", name: "StoreGame", quoted: false, line: 4, column: 9 },
    { spelling: "a quoted concept name", fixture: "valid/language-forms.expec", name: "Store Game", quoted: true, line: 22, column: 9 },
  ])("GR-001: preserves $spelling at its authored location", ({ fixture, name, quoted, line, column }) => {
    const language = new SourceReading();
    language.sourceIs(fixture);

    language.readSource();

    language.expectConceptNamed(name, { quoted, at: { line, column } });
    language.expectOriginalSourcePreserved();
    language.expectGrammarVersion("candidate-0.1");
  });
});
