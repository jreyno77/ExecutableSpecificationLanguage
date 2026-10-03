import { describe, it } from 'vitest';
import { ConnectionExamples } from '../dsl/project-connection.js';

describe('Connecting and reading the current project', () => {
  it("connects the project beside the manifest instead of using its diagnostic label", async () => {
    const project = new ConnectionExamples();
    await project.files({ "work/game/src/store.ts": 'export const name = "A";' });
    project.manifest("work/settings/expec.json", {
      formatVersion: 1, version: "0.2.0", project: { root: "../game" },
      build: { entries: ["store.expec"] }
    }, { sourceId: "editor:unsaved-settings" });

    await project.connect();
    await project.readSnapshot();

    project.expectConnectedTo("work/game");
    project.expectCompleteSnapshot();
    project.expectFile("src/store.ts", 'export const name = "A";');
    project.expectAuthoredRoot("../game");
    await project.expectFilesystemUnchanged();
  });

  it("keeps an omitted project unconnected without choosing or creating a destination", async () => {
    const project = new ConnectionExamples();
    await project.files({ "handwritten.txt": "keep" });
    project.manifest("settings/expec.json", {
      formatVersion: 1, version: "0.2.0", build: { entries: ["store.expec"] }
    });

    await project.connect();

    project.expectUnconnected("not-configured");
    project.expectNoSuggestedRoot();
    await project.expectFilesystemUnchanged();
  });

  it("returns the missing configured destination for a later initialization decision", async () => {
    const project = new ConnectionExamples();
    await project.files({ "handwritten.txt": "keep" });
    project.manifest("settings/expec.json", {
      formatVersion: 1, version: "0.2.0", project: { root: "../new-game" },
      build: { entries: ["store.expec"] }
    });

    await project.connect();

    project.expectUnconnected("missing-root", "new-game");
    await project.expectMissingPath("new-game");
    await project.expectFilesystemUnchanged();
  });

  it("reports a file at the configured root instead of treating it as a new project", async () => {
    const project = new ConnectionExamples();
    await project.files({ "game": "do not replace this file" });
    project.connectedManifest("game");

    await project.connect();

    project.expectConnectionProblem("root-not-directory", ["project", "root"]);
    project.expectNoConnectionValue();
    await project.expectFilesystemUnchanged();
  });

  it("connects an existing empty directory without initializing it", async () => {
    const project = new ConnectionExamples();
    await project.directory("game");
    project.connectedManifest("game");

    await project.connect();
    await project.readSnapshot();

    project.expectConnectedTo("game");
    project.expectCompleteSnapshot();
    project.expectFilePaths([]);
    await project.expectFilesystemUnchanged();
  });

  it("reads a later handwritten edit without changing an earlier snapshot", async () => {
    const project = new ConnectionExamples();
    await project.files({ "game/src/store.ts": 'export function hidden() { return "before"; }' });
    project.connectedManifest("game");
    await project.connect();
    await project.readSnapshot();
    project.expectFile("src/store.ts", 'export function hidden() { return "before"; }');
    project.rememberSnapshot("before edit");

    await project.editFile("game/src/store.ts", 'export function hidden() { return "after"; }');
    await project.readSnapshot();

    project.expectCompleteSnapshot();
    project.expectFile("src/store.ts", 'export function hidden() { return "after"; }');
    project.expectChangedFileVersion("src/store.ts", "before edit");
    project.expectSameRootIdentity("before edit");
    project.expectRememberedFile("before edit", "src/store.ts", 'export function hidden() { return "before"; }');
    project.expectRememberedSnapshotUnchanged("before edit");
  });

  it("observes newly created and removed files on the same context", async () => {
    const project = new ConnectionExamples();
    await project.files({ "game/src/old.ts": "export const old = 1;" });
    project.connectedManifest("game");
    await project.connect();
    await project.readSnapshot();
    project.expectFilePaths(["src/old.ts"]);

    await project.removeFile("game/src/old.ts");
    await project.editFile("game/src/new.ts", "export const current = 2;");
    await project.readSnapshot();

    project.expectCompleteSnapshot();
    project.expectFilePaths(["src/new.ts"]);
    project.expectFile("src/new.ts", "export const current = 2;");
  });

  it("preserves binary bytes and text line endings without interpreting them", async () => {
    const project = new ConnectionExamples();
    await project.files({ "game/src/store.ts": "// café\r\nexport const keep = 1;\r\n" });
    await project.fileBytes("game/assets/icon.bin", [0, 255, 128, 10, 13]);
    project.connectedManifest("game");

    await project.connect();
    await project.readSnapshot();

    project.expectCompleteSnapshot();
    project.expectFile("src/store.ts", "// café\r\nexport const keep = 1;\r\n");
    project.expectBytes("assets/icon.bin", [0, 255, 128, 10, 13]);
    project.expectVersionDescribesBytes("assets/icon.bin", [0, 255, 128, 10, 13]);
  });

  it("reports excluded metadata and dependency folders while retaining other handwritten files", async () => {
    const project = new ConnectionExamples();
    await project.files({
      "game/.git/HEAD": "ref: refs/heads/main",
      "game/packages/web/node_modules/tool/index.js": "third party",
      "game/src/private.ts": "export const keep = 42;",
      "game/.gitignore": "src/private.ts"
    });
    project.connectedManifest("game");

    await project.connect();
    await project.readSnapshot();

    project.expectCompleteSnapshot();
    project.expectFilePaths([".gitignore", "src/private.ts"]);
    project.expectExcludedPaths([".git", "packages/web/node_modules"]);
    project.expectFile("src/private.ts", "export const keep = 42;");
  });

  it("honors an explicitly selected scan policy instead of silently retaining default exclusions", async () => {
    const project = new ConnectionExamples();
    await project.files({ "game/node_modules/local/handwritten.js": "export const local = true;" });
    project.connectedManifest("game");
    project.excludeNames([]);

    await project.connect();
    await project.readSnapshot();

    project.expectCompleteSnapshot();
    project.expectExcludedPaths([]);
    project.expectFile("node_modules/local/handwritten.js", "export const local = true;");
  });

  it("retains the declared scan scope even when no excluded entries exist", async () => {
    const project = new ConnectionExamples();
    await project.directory("game");
    project.connectedManifest("game");
    await project.connect();
    await project.readSnapshot();
    project.expectCompleteSnapshot();
    project.expectExcludeNames([".git", "node_modules"]);
    project.expectExcludedPaths([]);
    project.rememberSnapshot("default scope");

    project.excludeNames([]);
    await project.connect();
    await project.readSnapshot();

    project.expectCompleteSnapshot();
    project.expectExcludeNames([]);
    project.expectExcludedPaths([]);
    project.expectRememberedExcludeNames("default scope", [".git", "node_modules"]);
    project.expectRememberedSnapshotUnchanged("default scope");
    await project.expectFilesystemUnchanged();
  });

  it("keeps an internal directory link visible as a coverage gap without reading its target", async () => {
    const project = new ConnectionExamples();
    await project.files({ "game/src/keep.ts": "keep", "outside/private.txt": "outside the selected project" });
    await project.directoryLink("game/linked", "outside");
    project.connectedManifest("game");

    await project.connect();
    await project.readSnapshot();

    project.expectIncompleteSnapshot();
    project.expectSnapshotProblem("link-not-followed", "linked");
    project.expectFilePaths(["src/keep.ts"]);
    await project.expectFilesystemUnchanged();
  });

  it("refuses a replacement at the connected root until the caller reconnects", async () => {
    const project = new ConnectionExamples();
    await project.files({ "game/src/store.ts": 'export const name = "original";' });
    project.connectedManifest("game");
    await project.connect();
    await project.readSnapshot();
    project.rememberSnapshot("original root");

    await project.moveDirectory("game", "old-game");
    await project.editFile("game/src/store.ts", 'export const name = "replacement";');
    await project.readSnapshot();

    project.expectIncompleteSnapshot();
    project.expectSnapshotProblem("root-changed", "");
    project.expectFilePaths([]);
    project.expectRememberedSnapshotUnchanged("original root");

    await project.connect();
    await project.readSnapshot();
    project.expectCompleteSnapshot();
    project.expectFile("src/store.ts", 'export const name = "replacement";');
    project.expectDifferentRootIdentity("original root");
  });

  it("does not follow a selected root link after it is retargeted", async () => {
    const project = new ConnectionExamples();
    await project.files({ "game-a/src/store.ts": "A", "game-b/src/store.ts": "B" });
    await project.directoryLink("selected", "game-a");
    project.connectedManifest("selected");
    await project.connect();
    await project.readSnapshot();
    project.expectConnectedTo("game-a");
    project.expectFile("src/store.ts", "A");

    await project.retargetDirectoryLink("selected", "game-b");
    await project.readSnapshot();

    project.expectIncompleteSnapshot();
    project.expectSnapshotProblem("root-changed", "");
    project.expectFilePaths([]);
  });

  it("reports a disappeared root instead of returning a successful empty project", async () => {
    const project = new ConnectionExamples();
    await project.directory("game");
    project.connectedManifest("game");
    await project.connect();
    await project.removeDirectory("game");

    await project.readSnapshot();

    project.expectIncompleteSnapshot();
    project.expectSnapshotProblem("root-unavailable", "");
    project.expectFilePaths([]);
    await project.expectMissingPath("game");
  });

  it("keeps an unreadable file as a located gap while returning readable neighbors", async () => {
    const project = new ConnectionExamples();
    await project.files({ "game/src/readable.ts": "read me", "game/src/blocked.ts": "preserve me" });
    project.connectedManifest("game");
    await project.connect();
    await project.preventRead("game/src/blocked.ts");

    await project.readSnapshot();

    project.expectIncompleteSnapshot();
    project.expectSnapshotProblem("read-failed", "src/blocked.ts");
    project.expectFilePaths(["src/readable.ts"]);
    project.expectFile("src/readable.ts", "read me");
    await project.allowRead("game/src/blocked.ts");
    await project.expectDiskFile("game/src/blocked.ts", "preserve me");
  });

  it("does not let caller changes to captured bytes affect a later read", async () => {
    const project = new ConnectionExamples();
    await project.files({ "game/src/store.ts": "keep" });
    project.connectedManifest("game");
    await project.connect();
    await project.readSnapshot();
    project.replaceCapturedBytes("src/store.ts", [0, 0, 0, 0]);

    await project.readSnapshot();

    project.expectCompleteSnapshot();
    project.expectFile("src/store.ts", "keep");
    await project.expectDiskFile("game/src/store.ts", "keep");
  });
});
