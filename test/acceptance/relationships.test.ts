import { describe, expect, it } from "vitest";
import { Language, symbolAt, typeShape } from "./language-driver.js";

describe("declared relationships", () => {
  it("signature relationships preserve two-way flow and explicit dependencies without an ownership keyword", () => {
    const language = new Language({
      sourceId: "relationships.expec",
      text: `concept X {
  depends on Y
  construction(y: Y)
  public make
  capability make() returns Y
}
concept Y {
  public handle
  capability handle(x: X) returns Nothing
}
type Envelope {
  item: Y
}
function convert(input: X) returns Y
`,
    });
    language.compile();
    const { specification } = language.expectAccepted();
    const x = symbolAt(specification, "X");
    const y = symbolAt(specification, "Y");
    const make = symbolAt(specification, "X", "make");
    const handle = symbolAt(specification, "Y", "handle");
    const construction = specification.symbols.find((symbol) => symbol.kind === "construction" && symbol.owner?.value === x.id.value);
    expect(construction).toBeDefined();
    expect(typeShape(specification, construction?.parameters[0]?.valueType)).toMatchObject({ kind: "declared", declaration: y.id });
    expect(construction?.id).not.toEqual(x.id);
    expect(typeShape(specification, make.resultType)).toMatchObject({ kind: "declared", declaration: y.id });
    expect(typeShape(specification, handle.parameters[0]?.valueType)).toMatchObject({ kind: "declared", declaration: x.id });
    const names = new Map(specification.symbols.map((symbol) => [symbol.id.value, symbol.path.join(".")]));
    const actual = specification.relationships.map((relationship) => ({
      kind: relationship.kind,
      owner: names.get(relationship.owner.value),
      target: names.get(relationship.target.value),
      direction: relationship.direction,
    }));
    expect(actual).toEqual(expect.arrayContaining([
      { kind: "dependency", owner: "X", target: "Y", direction: "reference" },
      { kind: "construction-input", owner: "X", target: "Y", direction: "input" },
      { kind: "capability-output", owner: "X", target: "Y", direction: "output" },
      { kind: "capability-input", owner: "Y", target: "X", direction: "input" },
      { kind: "field", owner: "Envelope", target: "Y", direction: "reference" },
      { kind: "function-input", owner: "convert", target: "X", direction: "input" },
      { kind: "function-output", owner: "convert", target: "Y", direction: "output" },
    ]));
    expect(specification.dependencies).toHaveLength(1);
    expect(specification.dependencies[0]).toMatchObject({ owner: x.id, target: y.id });
    for (const relationship of specification.relationships) {
      expect(relationship.source.sourceId).toBe("relationships.expec");
      expect(specification.source.nodes.some((node) => node.id.ordinal === relationship.source.ordinal)).toBe(true);
    }
    // A renderer draws Y -> X for X's input and X -> Y for X's output.
    // Distinct kind/owner/direction facts keep those different promises distinguishable.
    expect(actual.filter((edge) => edge.owner === "X" && edge.target === "Y")).toHaveLength(3);
  });
});
