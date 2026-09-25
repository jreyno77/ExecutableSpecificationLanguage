import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const major = Number(process.versions.node.split(".")[0]);
if (major !== 24) {
  throw new Error(`Use Node 24 from .node-version; current runtime is ${process.version}.`);
}

const steps = [
  ["Generate parser", "scripts/generate-parser.mjs", []],
  ["Typecheck", "node_modules/typescript/bin/tsc", ["--noEmit"]],
  ["Unit tests", "node_modules/vitest/vitest.mjs", ["run", "tests/unit"]],
  ["Acceptance tests", "node_modules/vitest/vitest.mjs", ["run", "tests/acceptance"]],
  ["Build", "node_modules/typescript/bin/tsc", ["-p", "tsconfig.build.json"]],
];

for (const [label, script, args] of steps) {
  console.log(label);
  const result = spawnSync(process.execPath, [resolve(root, script), ...args], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
