import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { createCompiler } from "../../src/index.js";
import { inputFor, Language, resultsCatalog, sourceFixture, symbolAt, typeShape } from "./language-driver.js";

describe("authors can trust declared contracts", () => {
  test("CV-002: Text, Number, Boolean and List work without imports; Nothing stays an explicit return", () => {
    const language = new Language(sourceFixture("valid/builtins.expec"));
    language.compile();
    const { specification } = language.expectAccepted();
    const message = symbolAt(specification, "Message");
    for (const [fieldName, primitiveName] of [["body", "Text"], ["count", "Number"], ["visible", "Boolean"]]) {
      const field = message.fields.find((item) => item.name === fieldName);
      expect(typeShape(specification, field?.valueType)).toEqual({ kind: "primitive", primitiveName });
      expect(symbolAt(specification, primitiveName!).origin).toEqual({ kind: "builtin", name: primitiveName });
    }
    const list = typeShape(specification, message.fields.find((field) => field.name === "labels")?.valueType);
    expect(list.kind).toBe("list");
    if (list.kind !== "list") throw new Error("Expected a homogeneous list");
    expect(typeShape(specification, list.element)).toEqual({ kind: "primitive", primitiveName: "Text" });
    const show = symbolAt(specification, "show");
    expect(show.resultSpecified).toBe(true);
    expect(typeShape(specification, show.resultType)).toEqual({ kind: "no-result" });
    expect(specification.imports).toEqual([]);
    expect(specification.document).toEqual(language.input.source);
  });

  test("CV-003: an unavailable custom input type is an author error at its reference", () => {
    const language = new Language(sourceFixture("invalid/unknown-type.expec"));
    language.compile();
    language.expectProblemAt("unresolved-reference", 3, 29, "PlayerStateSnapshot");
  });

  test("CV-004: declaring save does not declare the promised saveGame capability", () => {
    const language = new Language(sourceFixture("invalid/public-mismatch.expec"));
    language.compile();
    language.expectProblemAt("unresolved-reference", 2, 10, "saveGame");
  });

  test("CV-004: a same-named type cannot satisfy a public capability promise", () => {
    const language = new Language(sourceFixture("invalid/public-type-reference.expec"));
    language.compile();
    language.expectProblemAt("wrong-reference-kind", 2, 10, "saveGame");
  });

  test.each([
    ["invalid/duplicate-type.expec", "Item"],
    ["invalid/duplicate-field.expec", "count"],
    ["invalid/duplicate-parameter.expec", "value"],
    ["invalid/shadow-builtin.expec", "Text"],
  ])("CV-005: conflicting declarations in %s identify both origins (%s)", (fixture) => {
    const language = new Language(sourceFixture(fixture));
    language.compile();
    const diagnostic = language.expectRejected("duplicate-declaration");
    expect(diagnostic.primary.kind).toBe("source");
    expect(diagnostic.related.length).toBeGreaterThan(0);
  });

  test("CV-017: independent unavailable types retain exact original source positions", () => {
    const language = new Language(sourceFixture("invalid/two-missing-types.expec"));
    language.compile();
    language.expectRejected("unresolved-reference");
    if (language.result?.status !== "rejected") throw new Error("Expected rejection");
    const actual = language.result.diagnostics.filter((item) => item.code === "unresolved-reference").map((item) => {
      if (item.primary.kind !== "source") throw new Error("Expected source provenance");
      return { sourceId: item.primary.range.sourceId, line: item.primary.range.start.line, column: item.primary.range.start.column };
    });
    expect(actual).toEqual([
      { sourceId: "invalid/two-missing-types.expec", line: 2, column: 23 },
      { sourceId: "invalid/two-missing-types.expec", line: 3, column: 24 },
    ]);
  });

  test("CV-018: malformed source is rejected rather than repaired into a valid model", () => {
    const language = new Language(sourceFixture("invalid/syntax-error.expec"));
    language.compile();
    const diagnostic = language.expectProblemAt("expected-token", 2, 12, "Number");
    expect(diagnostic.phase).toBe("syntax");
    expect(language.result?.diagnostics.every((item) => item.phase === "syntax")).toBe(true);
  });

  test("CV-020: repeating a supplied input is deterministic and changed source is observed", () => {
    const compiler = createCompiler();
    const input = inputFor(sourceFixture("invalid/public-mismatch.expec"));
    const first = compiler.compile(input);
    expect(first.status).toBe("rejected");
    expect(compiler.compile(input)).toEqual(first);
    const language = new Language({ ...input.source, text: input.source.text.replace("public saveGame", "public save") }, undefined, compiler.compile.bind(compiler));
    language.compile();
    const { specification } = language.expectAccepted();
    const owner = symbolAt(specification, "StoreGame");
    const save = symbolAt(specification, "StoreGame", "save");
    expect(owner.publicMembers).toEqual([save.id]);
    expect(specification.publicContracts).toContainEqual({ owner: owner.id, capabilities: [save.id] });
    expect(specification.bindings.some((binding) => binding.target.value === save.id.value)).toBe(true);
  });

  test.todo("CV-020: removing a supplied module invalidates an earlier accepted import", () => {
    const compiler = createCompiler();
    const source = sourceFixture("valid/catalog-import.expec");
    const input = inputFor(source, resultsCatalog());
    const first = compiler.compile(input);
    expect(first.status).toBe("accepted");
    expect(compiler.compile(input)).toEqual(first);
    if (first.status !== "accepted") throw new Error("Expected the supplied declaration to resolve");
    const validate = symbolAt(first.specification, "validate");
    const result = typeShape(first.specification, validate.resultType);
    expect(result.kind).toBe("declared");
    if (result.kind !== "declared") throw new Error("Expected a named result type");
    const target = first.specification.symbols.find((symbol) => symbol.id.value === result.declaration.value);
    expect(target?.origin).toEqual({ kind: "external", locator: "results", exportedPath: ["ValidationResult"] });
    const removed = new Language(source, { modules: [], packages: [] }, compiler.compile.bind(compiler));
    removed.compile();
    removed.expectRejected("unavailable-dependency");
  });

  test("CV-022: a nearby unsupplied file neither declares a type nor authorizes project I/O", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "expec-acceptance-"));
    const source = sourceFixture("invalid/unknown-type.expec");
    const nearbyFile = path.join(directory, "models.expec");
    const before = "type PlayerStateSnapshot { title: Text }\n";
    fs.writeFileSync(nearbyFile, before);
    const language = new Language({ ...source, sourceId: path.join(directory, "game.expec") });
    const suppliedSnapshot = structuredClone(language.input);
    const reads = vi.spyOn(fs, "readFileSync");
    const scans = vi.spyOn(fs, "readdirSync");
    const writes = vi.spyOn(fs, "writeFileSync");
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Compilation must not fetch dependencies"));
    try {
      language.compile();
      language.expectRejected("unresolved-reference");
      expect(language.input).toEqual(suppliedSnapshot);
      expect(reads).not.toHaveBeenCalled();
      expect(scans).not.toHaveBeenCalled();
      expect(writes).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
      try {
        expect(fs.readdirSync(directory)).toEqual(["models.expec"]);
        expect(fs.readFileSync(nearbyFile, "utf8")).toBe(before);
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  });

  test("CV-023: an always-successful implementation cannot satisfy the missing-capability expectation", () => {
    const valid = createCompiler().compile(inputFor(sourceFixture("valid/builtins.expec")));
    expect(valid.status).toBe("accepted");
    const incorrect = new Language(sourceFixture("invalid/public-mismatch.expec"), undefined, () => valid);
    incorrect.compile();
    expect(() => incorrect.expectRejected("unresolved-reference")).toThrow();
  });

  test("CV-023: an unimplemented compiler operation stays a failure", () => {
    const unfinished = new Language(sourceFixture("invalid/public-mismatch.expec"), undefined, () => { throw new Error("not implemented"); });
    expect(() => unfinished.compile()).toThrow("not implemented");
    expect(unfinished.result).toBeUndefined();
  });
});
