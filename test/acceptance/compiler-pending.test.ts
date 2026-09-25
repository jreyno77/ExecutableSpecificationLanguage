import { describe, it } from "vitest";

// These are unfinished CORE-18 expectations, not passing acceptance evidence.
// CV-020 keeps its concrete pending assertion body in compiler.test.ts.
describe("CORE-18 compiler acceptance still to complete", () => {
  it.todo("CV-001: compile the declared Store Game contracts without requiring their implementation");
  it.todo("CV-005: reject an imported alias that conflicts with a declaration in the same scope");
  it.todo("CV-006: require an unambiguous choice between same-named dependency exports");
  it.todo("CV-007: keep local types inside their owner and out of an exposed public signature");
  it.todo("CV-008: resolve only complete exports and package entries explicitly supplied in the input");
  it.todo("CV-009: resolve generic arguments without leaking type parameters into surrounding scope");
  it.todo("CV-010: distinguish an alias expansion cycle from a recursive record definition");
  it.todo("CV-011: validate authored records and defaults against their declared types");
  it.todo("CV-012: check call arguments, declared defaults, and typed helper returns");
  it.todo("CV-013: validate contract conditions and the context-bound result name");
  it.todo("CV-014: validate domain operations and checks without inferring their behavior from names");
  it.todo("CV-015: bind local values and captures only where their values are available");
  it.todo("CV-016: accept incomplete contracts while preserving every unfinished obligation");
  it.todo("CV-019: report source composition that belongs to a later task");
  it.todo("CV-021: supply output consumers with validated meaning and original authored intent");
  it.todo("CV-024: run the real grammar and compiler acceptance path from a clean checkout");
  it.todo("CV-025: resolve ordered communications against the participants' public contracts");
});
