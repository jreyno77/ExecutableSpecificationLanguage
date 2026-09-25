import fs from "node:fs";
import { describe, test } from "vitest";

type CoverageEntry = { id: string; title: string; feature: string; binding: "bound" | "partial" | "unbound"; remaining?: string };
const inventory = JSON.parse(fs.readFileSync(new URL("../../specifications/acceptance/coverage.json", import.meta.url), "utf8")) as { cases: CoverageEntry[] };

// CORE-18 owns compiler.feature. Other tasks stay on the board, not in this task's TODOs.
// CV-020 already has its concrete remaining expectation in compiler.test.ts.
const remainingCompilerCases = inventory.cases.filter((entry) =>
  entry.feature === "specifications/acceptance/compiler.feature" &&
  entry.binding !== "bound" && entry.id !== "CV-020",
);

describe("CORE-18 compiler acceptance still to complete", () => {
  for (const item of remainingCompilerCases) {
    test.todo(`${item.id} [${item.binding}] ${item.title} — ${item.remaining}`);
  }
});
