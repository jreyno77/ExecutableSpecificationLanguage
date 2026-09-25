import fs from "node:fs";
import { describe, test } from "vitest";

type CoverageEntry = { id: string; title: string; binding: "bound" | "partial" | "unbound"; remaining?: string };
const inventory = JSON.parse(fs.readFileSync(new URL("../../specifications/acceptance/coverage.json", import.meta.url), "utf8")) as { cases: CoverageEntry[] };

describe("authored promises still awaiting complete acceptance bindings", () => {
  for (const item of inventory.cases.filter((entry) => entry.binding !== "bound")) {
    test.todo(`${item.id} [${item.binding}] ${item.title} — ${item.remaining}`);
  }
});
