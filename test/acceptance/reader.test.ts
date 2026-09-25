import { describe, expect, it } from "vitest";
import { createSyntaxReader } from "../../src/index.js";
import { sourceFixture } from "../support/source-fixture.js";

describe("source reader", () => {
  it.each([
    ["valid/store-game.expec", "StoreGame", false, 4, 9],
    ["valid/language-forms.expec", "Store Game", true, 22, 9],
  ] as const)("GR-001: read %s as an authored concept name", (fixture, name, quoted, line, column) => {
    const source = sourceFixture(fixture, "grammar");
    const result = createSyntaxReader().read(source);
    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") throw new Error("Expected accepted source");
    const declarations = result.description.nodes.filter((node) => node.payload.kind === "concept");
    const declaration = declarations.find((node) => {
      if (node.payload.kind !== "concept") return false;
      const nameId = node.payload.name;
      const nameNode = result.description.nodes.find((candidate) => candidate.id.ordinal === nameId.ordinal);
      return nameNode?.payload.kind === "name" && nameNode.payload.decoded === name;
    });
    expect(declaration).toBeDefined();
    if (declaration?.payload.kind !== "concept") throw new Error("Expected concept declaration");
    const nameId = declaration.payload.name;
    const nameNode = result.description.nodes.find((node) => node.id.ordinal === nameId.ordinal);
    expect(nameNode?.payload).toEqual({ kind: "name", decoded: name, quoted });
    expect(nameNode?.range).toMatchObject({ sourceId: fixture, start: { line, column } });
    expect(result.document).toEqual(source);
    expect(result.grammarVersion).toBe("candidate-0.1");
  });
});
