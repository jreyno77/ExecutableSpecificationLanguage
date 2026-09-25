import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, "src/grammar/generated");
mkdirSync(output, { recursive: true });

const result = spawnSync(process.execPath, [
  resolve(root, "node_modules/antlr-ng/dist/cli/runner.js"),
  "-D", "language=TypeScript",
  "--generate-listener", "false",
  "--generate-visitor", "false",
  "--exact-output-dir", "true",
  "--warnings-are-errors", "true",
  "--output-directory", output,
  "--", "src/grammar/Expec.g4",
], { cwd: root, stdio: "inherit" });

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
