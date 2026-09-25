import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assertCommitIdentity } from "./metadata.mjs";

function run(command, args, cwd, capture = false, env = process.env) {
  return execFileSync(command, args, {
    cwd, env, encoding: "utf8", stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
}

function npm(args, cwd, capture = false) {
  // The workflow runs on Ubuntu. A pinned npm CLI can also be supplied for Windows development.
  const cli = process.env.EXPEC_NPM_CLI ?? process.env.npm_execpath;
  if (cli) return run(process.env.EXPEC_NODE ?? "node", [cli, ...args], cwd, capture);
  if (process.platform === "win32") throw new Error("Set EXPEC_NPM_CLI to the pinned npm-cli.js when checking delivery locally on Windows.");
  return run("npm", args, cwd, capture);
}

export function artifactKind(workspace) {
  return existsSync(join(workspace, "package.json")) ? "compiler-package" : "specification-bundle";
}

/** Runs only local build commands; no GitHub writes and no registry publication. */
export async function buildArtifact({ workspace, mergeSha, pullNumber }) {
  const head = run("git", ["rev-parse", "HEAD"], workspace, true).trim();
  assertCommitIdentity(head, mergeSha, "Checked-out source");
  if (run("git", ["status", "--porcelain", "--untracked-files=normal"], workspace, true).trim()) {
    throw new Error("Delivery requires a clean checkout of the exact merged source.");
  }
  const directory = mkdtempSync(join(tmpdir(), "expec-delivery-"));
  const kind = artifactKind(workspace);
  let name;
  let version = null;
  if (kind === "specification-bundle") {
    name = `expec-specification-pr-${pullNumber}.zip`;
    run("git", ["archive", "--format=zip", "--prefix=expec-specification/", `--output=${join(directory, name)}`, mergeSha], workspace);
  } else {
    const buildRoot = join(directory, "source");
    mkdirSync(buildRoot);
    const sourceArchive = join(directory, "source.tar");
    run("git", ["archive", "--format=tar", `--output=${sourceArchive}`, mergeSha], workspace);
    run("tar", ["-xf", sourceArchive, "-C", buildRoot], directory);
    npm(["ci", "--ignore-scripts", "--no-audit", "--no-fund"], buildRoot);
    npm(["run", "check"], buildRoot);
    const manifest = JSON.parse(readFileSync(join(buildRoot, "package.json"), "utf8"));
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)) throw new Error("Package has no supported base version.");
    version = `${manifest.version.split("-")[0]}-pr.${pullNumber}`;
    npm(["version", version, "--no-git-tag-version", "--ignore-scripts", "--allow-same-version"], buildRoot);
    const packed = JSON.parse(npm(["pack", "--json", "--ignore-scripts", "--pack-destination", directory], buildRoot, true));
    if (packed.length !== 1 || packed[0].filename !== `${manifest.name.replace(/^@/, "").replace("/", "-")}-${version}.tgz`) {
      throw new Error("npm pack did not produce the expected single compiler package.");
    }
    name = packed[0].filename;
    const consumer = mkdtempSync(join(tmpdir(), "expec-consumer-"));
    writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
    npm(["install", "--ignore-scripts", "--no-audit", "--no-fund", resolve(directory, name)], consumer);
    writeFileSync(join(consumer, "smoke.mjs"), [
      'import assert from "node:assert/strict";',
      'const { createCompiler } = await import(process.env.EXPEC_PACKAGE_NAME);',
      'const compiler = createCompiler();',
      'const compile = (text) => compiler.compile({ source: { sourceId: "packed-smoke.expec", text }, dependencies: { modules: [], packages: [] } });',
      'assert.equal(compile("type Message { body: Text }\\nfunction show(item: Message) returns Nothing").status, "accepted");',
      'const rejected = compile("function show(item: Missing) returns Nothing");',
      'assert.equal(rejected.status, "rejected");',
      'assert.ok(rejected.diagnostics.some((diagnostic) => diagnostic.code === "unresolved-reference"));',
      'console.log("Packed public API smoke passed.");',
    ].join("\n"));
    run(process.env.EXPEC_NODE ?? "node", [join(consumer, "smoke.mjs")], consumer, false, { ...process.env, EXPEC_PACKAGE_NAME: manifest.name });
  }
  const bytes = readFileSync(join(directory, name));
  return { kind, name, version, bytes, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}
