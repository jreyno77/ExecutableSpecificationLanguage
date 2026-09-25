import { spawn, spawnSync } from "node:child_process";
import { watch } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
if (Number(process.versions.node.split(".")[0]) !== 24) throw new Error("Use Node 24 from .node-version.");
let tests;
let timer;
let stopped = false;
let generationPending = false;
let restarting = false;

async function regenerate() {
  if (restarting) { generationPending = true; return; }
  restarting = true;
  do {
    generationPending = false;
    const child = tests;
    tests = undefined;
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise((done) => { child.once("close", done); child.kill("SIGTERM"); });
    }
    if (stopped) break;
    console.log("Grammar changed: regenerating before running tests.");
    const generated = spawnSync(process.execPath, [resolve(root, "scripts/generate-parser.mjs")], { cwd: root, stdio: "inherit" });
    if (generated.error || generated.status !== 0) {
      console.error("Parser generation failed. Tests are stopped; edit the grammar to retry.");
    } else {
      tests = spawn(process.execPath, [resolve(root, "node_modules/vitest/vitest.mjs"), "watch"], { cwd: root, stdio: "inherit" });
      tests.on("error", (error) => console.error(error.message));
    }
  } while (generationPending && !stopped);
  restarting = false;
}

const watcher = watch(resolve(root, "src/grammar"), (_event, filename) => {
  if (!filename?.endsWith(".g4")) return;
  clearTimeout(timer);
  timer = setTimeout(() => { void regenerate(); }, 150);
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopped = true;
    clearTimeout(timer);
    watcher.close();
    tests?.kill("SIGTERM");
  });
}
await regenerate();
