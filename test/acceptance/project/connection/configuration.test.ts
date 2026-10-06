import { describe, it } from 'vitest';
import { ConfigurationExamples } from '../../../dsl/project/connection/configuration.js';

describe('Project configuration and supplied dependencies', () => {
  it("reads the author's connected project, outputs and dependency requirements", () => {
    const project = new ConfigurationExamples();
    project.output("typescript", { directory: "nonempty text" });
    project.manifest({
      formatVersion: 1, version: "0.2.0", project: { root: "../game" },
      build: { entries: ["store.expec"] },
      outputs: [{ id: "typescript", options: { directory: "src" } }],
      libraries: [{ module: "inventory", version: "^1.0.0" }],
      packages: [{ alias: "vite", name: "npm:vite", version: "^6.0.0", phases: ["build"] }]
    });

    project.read();

    project.expectConfiguration();
    project.expectVersion("0.2.0");
    project.expectProject("../game");
    project.expectEntries(["store.expec"]);
    project.expectOutput("typescript", { directory: "src" });
    project.expectLibraryRequirement("inventory", "^1.0.0");
    project.expectPackageRequirement("vite", "npm:vite", "^6.0.0", ["build"]);
  });

  it("keeps an unconnected check-only configuration explicit", () => {
    const project = new ConfigurationExamples();
    project.manifest({ formatVersion: 1, version: "0.2.0", build: { entries: ["store.expec"] } });

    project.read();

    project.expectConfiguration();
    project.expectNoProject();
    project.expectOutputs([]);
    project.expectRequirements({ libraries: [], packages: [] });
  });

  it("uses changed settings while preserving the previous configuration", () => {
    const project = new ConfigurationExamples();
    project.output("typescript");
    project.output("markdown");
    project.manifest({ formatVersion: 1, version: "0.2.0", project: { root: "../game-a" },
      build: { entries: ["store.expec"] }, outputs: [{ id: "typescript" }] });
    project.read();
    project.rememberConfiguration("first");

    project.manifest({ formatVersion: 1, version: "0.3.0", project: { root: "../game-b" },
      build: { entries: ["other.expec", "store.expec"] }, outputs: [{ id: "markdown" }] });
    project.read();

    project.expectConfiguration();
    project.expectProject("../game-b");
    project.expectVersion("0.3.0");
    project.expectEntries(["other.expec", "store.expec"]);
    project.expectOutput("markdown", {});
    project.expectRememberedConfiguration("first", { root: "../game-a", version: "0.2.0", outputs: ["typescript"] });
    project.expectRememberedConfigurationUnchanged("first");
  });

  it("rejects JSON recovery instead of using a partially read destination", () => {
    const project = new ConfigurationExamples();
    project.document('{ "formatVersion": 1, "version": "0.2.0", "project": { "root": "../game" },');

    project.read();

    project.expectManifestProblem("invalid-json", []);
    project.expectNoConfiguration();
  });

  it("rejects duplicate JSON keys instead of silently choosing a destination", () => {
    const project = new ConfigurationExamples();
    project.document(`{"formatVersion":1,"version":"0.2.0","build":{"entries":["store.expec"]},
      "project":{"root":"../game-a","root":"../game-b"}}`);

    project.read();

    project.expectManifestProblem("duplicate-key", ["project", "root"]);
    project.expectNoConfiguration();
  });

  it("rejects an unsupported manifest format", () => {
    const project = new ConfigurationExamples();
    project.manifest({ formatVersion: 2, version: "0.2.0", build: { entries: ["store.expec"] } });

    project.read();

    project.expectManifestProblem("unsupported-format", ["formatVersion"]);
    project.expectNoConfiguration();
  });

  it("retains independent misspellings and missing build entries", () => {
    const project = new ConfigurationExamples();
    project.manifest({ formatVersion: 1, version: "0.2.0", project: { rooot: "../game" }, build: { entries: [] } });

    project.read();

    project.expectManifestProblem("invalid-setting", ["project", "rooot"]);
    project.expectManifestProblem("invalid-setting", ["project", "root"]);
    project.expectManifestProblem("invalid-setting", ["build", "entries"]);
    project.expectNoConfiguration();
  });

  it("rejects unknown output IDs without guessing another exporter", () => {
    const project = new ConfigurationExamples();
    project.output("typescript");
    project.manifest({ formatVersion: 1, version: "0.2.0", build: { entries: ["store.expec"] },
      outputs: [{ id: "typscript" }] });

    project.read();

    project.expectManifestProblem("unknown-output", ["outputs", 0, "id"]);
    project.expectNoConfiguration();
  });

  it("locates a target's invalid option in the manifest", () => {
    const project = new ConfigurationExamples();
    project.output("typescript", { directory: "nonempty text" });
    project.manifest({ formatVersion: 1, version: "0.2.0", build: { entries: ["store.expec"] },
      outputs: [{ id: "typescript", options: { directory: 4 } }] });

    project.read();

    project.expectManifestProblem("invalid-output-options", ["outputs", 0, "options", "directory"]);
    project.expectNoConfiguration();
  });

  it("does not treat a package dist-tag as a supported version range", () => {
    const project = new ConfigurationExamples();
    project.manifest({ formatVersion: 1, version: "0.2.0", build: { entries: ["store.expec"] },
      packages: [{ alias: "vite", name: "npm:vite", version: "latest", phases: ["build"] }] });

    project.read();

    project.expectManifestProblem("invalid-version", ["packages", 0, "version"]);
    project.expectNoConfiguration();
  });

  it("rejects competing declarations for the same package alias", () => {
    const project = new ConfigurationExamples();
    project.manifest({ formatVersion: 1, version: "0.2.0", build: { entries: ["store.expec"] },
      packages: [
        { alias: "vite", name: "npm:vite", version: "^6.0.0", phases: ["build"] },
        { alias: "vite", name: "npm:vite", version: "^7.0.0", phases: ["runtime"] }
      ] });

    project.read();

    project.expectManifestProblem("duplicate-alias", ["packages", 1, "alias"]);
    project.expectRelatedManifestPath(["packages", 0, "alias"]);
    project.expectNoConfiguration();
  });

  it("rejects repeated library declarations instead of choosing one range", () => {
    const project = new ConfigurationExamples();
    project.manifest({ formatVersion: 1, version: "0.2.0", build: { entries: ["store.expec"] },
      libraries: [{ module: "inventory", version: "^1.0.0" }, { module: "inventory", version: "^2.0.0" }] });

    project.read();

    project.expectManifestProblem("duplicate-module", ["libraries", 1, "module"]);
    project.expectRelatedManifestPath(["libraries", 0, "module"]);
    project.expectNoConfiguration();
  });

  it("passes a matching source-backed external library and configured package phases to the real compiler", () => {
    const project = new ConfigurationExamples();
    project.manifest({ formatVersion: 1, version: "0.2.0", build: { entries: ["store.expec"] },
      libraries: [{ module: "inventory", version: "^1.0.0" }],
      packages: [{ alias: "vite", name: "npm:vite", version: "^6.0.0", phases: ["build"] }] });
    project.sourceModule("inventory", "1.2.0", 'type Book { title: Text }');
    project.availablePackage("npm:vite", "6.10.0");
    project.read();

    project.resolveDependencies();
    project.compile(`use Book from "inventory"
  concept StoreGame {
    requires package "vite" for build
    capability save(book: Book) returns Nothing
  }`);

    project.expectDependencies();
    project.expectSuppliedModuleIdentity("inventory");
    project.expectCompilerPackages([{ alias: "vite", phases: ["build"] }]);
    project.expectCompiled();
    project.expectParameterType("StoreGame.save", "book", "inventory", "Book");
  });

  it("uses external signatures through the same dependency path", () => {
    const project = new ConfigurationExamples();
    project.manifest({ formatVersion: 1, version: "0.2.0", build: { entries: ["store.expec"] },
      libraries: [{ module: "inventory", version: "1.0.0" }] });
    project.externalModule("inventory", "1.0.0", [{ kind: "opaque-type", name: "Book" }]);
    project.read();

    project.resolveDependencies();
    project.compile('use Book from "inventory"\nfunction save(book: Book) returns Nothing');

    project.expectDependencies();
    project.expectSuppliedModuleIdentity("inventory");
    project.expectCompiled();
    project.expectParameterType("save", "book", "inventory", "Book");
    project.expectTypeOrigin("Book", { kind: "external", module: "inventory" });
  });

  it("does not use a specification library to satisfy a target package", () => {
    const project = new ConfigurationExamples();
    project.manifest({ formatVersion: 1, version: "0.2.0", build: { entries: ["store.expec"] },
      libraries: [{ module: "vite", version: "6.0.0" }],
      packages: [{ alias: "vite", name: "npm:vite", version: "6.0.0", phases: ["build"] }] });
    project.sourceModule("vite", "6.0.0", 'type Options {}');
    project.read();

    project.resolveDependencies();

    project.expectManifestProblem("unavailable-package", ["packages", 0, "name"]);
    project.expectNoDependencies();
  });

  it("reports independent missing libraries and packages", () => {
    const project = new ConfigurationExamples();
    project.manifest({ formatVersion: 1, version: "0.2.0", build: { entries: ["store.expec"] },
      libraries: [{ module: "inventory", version: "^1.0.0" }],
      packages: [{ alias: "vite", name: "npm:vite", version: "^6.0.0", phases: ["build"] }] });
    project.read();

    project.resolveDependencies();

    project.expectManifestProblem("unavailable-library", ["libraries", 0, "module"]);
    project.expectManifestProblem("unavailable-package", ["packages", 0, "name"]);
    project.expectNoDependencies();
  });

  it("compares numeric versions instead of lexical strings", () => {
    const project = new ConfigurationExamples();
    project.manifest({ formatVersion: 1, version: "0.2.0", build: { entries: ["store.expec"] },
      packages: [{ alias: "vite", name: "npm:vite", version: ">=6.2.0 <7.0.0", phases: ["build"] }] });
    project.availablePackage("npm:vite", "6.10.0");
    project.read();

    project.resolveDependencies();

    project.expectDependencies();
    project.expectCompilerPackages([{ alias: "vite", phases: ["build"] }]);
  });

  it("reports the incompatible supplied version and both input locations", () => {
    const project = new ConfigurationExamples();
    project.manifest({ formatVersion: 1, version: "0.2.0", build: { entries: ["store.expec"] },
      packages: [{ alias: "vite", name: "npm:vite", version: "^6.0.0", phases: ["build"] }] });
    project.availablePackage("npm:vite", "7.0.0");
    project.read();

    project.resolveDependencies();

    project.expectManifestProblem("incompatible-version", ["packages", 0, "version"]);
    project.expectRelatedInventoryPath(["packages", 0, "version"]);
    project.expectProblemMentions("npm:vite", "^6.0.0", "7.0.0");
    project.expectNoDependencies();
  });

  it("does not silently opt a stable requirement into a prerelease", () => {
    const project = new ConfigurationExamples();
    project.manifest({ formatVersion: 1, version: "0.2.0", build: { entries: ["store.expec"] },
      libraries: [{ module: "inventory", version: "^1.0.0" }] });
    project.sourceModule("inventory", "1.1.0-beta.1", 'type Book {}');
    project.read();

    project.resolveDependencies();

    project.expectManifestProblem("incompatible-version", ["libraries", 0, "version"]);
    project.expectNoDependencies();
  });

  it("accepts a deliberately requested prerelease", () => {
    const project = new ConfigurationExamples();
    project.manifest({ formatVersion: 1, version: "0.2.0", build: { entries: ["store.expec"] },
      libraries: [{ module: "inventory", version: "1.1.0-beta.1" }] });
    project.sourceModule("inventory", "1.1.0-beta.1", 'type Book {}');
    project.read();

    project.resolveDependencies();

    project.expectDependencies();
    project.expectSuppliedModuleIdentity("inventory");
  });

  it("does not pass an undeclared neighboring module or package to compilation", () => {
    const project = new ConfigurationExamples();
    project.manifest({ formatVersion: 1, version: "0.2.0", build: { entries: ["store.expec"] } });
    project.sourceModule("inventory", "1.0.0", 'type Book {}');
    project.availablePackage("npm:vite", "6.0.0");
    project.read();

    project.resolveDependencies();
    project.compile('use Book from "inventory"\nconcept StoreGame { requires package "vite" for build }');

    project.expectDependencies();
    project.expectCompilerModules([]);
    project.expectCompilerPackages([]);
    project.expectCompilationProblem("unavailable-module");
    project.expectCompilationProblem("unavailable-package");
    project.expectNoSpecification();
  });

  it("keeps undeclared imports in a source-backed external library visible to the compiler", () => {
    const project = new ConfigurationExamples();
    project.manifest({ formatVersion: 1, version: "0.2.0", build: { entries: ["store.expec"] },
      libraries: [{ module: "inventory", version: "1.0.0" }] });
    project.sourceModule("inventory", "1.0.0", 'use Price from "pricing"\ntype Book { price: Price }');
    project.sourceModule("pricing", "1.0.0", 'type Price = Number');
    project.read();

    project.resolveDependencies();
    project.compile('use Book from "inventory"\nfunction save(book: Book) returns Nothing');

    project.expectDependencies();
    project.expectCompilerModules(["inventory"]);
    project.expectCompilationProblem("unavailable-module", { module: "inventory", text: "Price", line: 1 });
    project.expectRelatedCompilationPath(["modules", "pricing"]);
    project.expectNoSpecification();
  });

  it("does not turn build-only availability into runtime availability", () => {
    const project = new ConfigurationExamples();
    project.manifest({ formatVersion: 1, version: "0.2.0", build: { entries: ["store.expec"] },
      packages: [{ alias: "vite", name: "npm:vite", version: "6.0.0", phases: ["build"] }] });
    project.availablePackage("npm:vite", "6.0.0");
    project.read();

    project.resolveDependencies();
    project.compile('concept StoreGame { requires package "vite" for runtime }');

    project.expectDependencies();
    project.expectCompilerPackages([{ alias: "vite", phases: ["build"] }]);
    project.expectCompilationProblem("unavailable-package");
    project.expectNoSpecification();
  });

  it("rechecks changed inventory without changing a previous dependency result", () => {
    const project = new ConfigurationExamples();
    project.manifest({ formatVersion: 1, version: "0.2.0", build: { entries: ["store.expec"] },
      packages: [{ alias: "vite", name: "npm:vite", version: "^6.0.0", phases: ["build"] }] });
    project.availablePackage("npm:vite", "6.0.0");
    project.read();
    project.resolveDependencies();
    project.expectDependencies();
    project.expectCompilerPackages([{ alias: "vite", phases: ["build"] }]);
    project.rememberDependencies("compatible");

    project.availablePackage("npm:vite", "7.0.0");
    project.resolveDependencies();

    project.expectManifestProblem("incompatible-version", ["packages", 0, "version"]);
    project.expectNoDependencies();
    project.expectRememberedDependenciesUnchanged("compatible");
  });

  it("requires a new reader to use a new output-profile set", () => {
    const project = new ConfigurationExamples();
    project.output("typescript");
    project.captureReader("typescript only");
    project.output("markdown");
    project.manifest({ formatVersion: 1, version: "0.2.0", build: { entries: ["store.expec"] },
      outputs: [{ id: "markdown" }] });

    project.readWith("typescript only");
    project.expectManifestProblem("unknown-output", ["outputs", 0, "id"]);
    project.expectNoConfiguration();
    project.read();

    project.expectConfiguration();
    project.expectOutput("markdown", {});
  });

  it("rejects ambiguous inventory rather than selecting a version by order", () => {
    const project = new ConfigurationExamples();
    project.manifest({ formatVersion: 1, version: "0.2.0", build: { entries: ["store.expec"] },
      packages: [{ alias: "vite", name: "npm:vite", version: "^6.0.0", phases: ["build"] }] });
    project.packageInventory([{ name: "npm:vite", version: "6.0.0" }, { name: "npm:vite", version: "6.1.0" }]);
    project.read();

    project.resolveDependencies();

    project.expectInventoryProblem("invalid-inventory", ["packages", 1, "name"]);
    project.expectRelatedInventoryPath(["packages", 0, "name"]);
    project.expectNoDependencies();
  });

  it("preserves authored paths and creates nothing while reading and planning", async () => {
    const project = new ConfigurationExamples();
    await project.existingFiles({ "src/handwritten.ts": "export const keep = 42;" });
    const manifestLocation = project.fileLocation("settings/expec.json");
    project.manifest({ formatVersion: 1, version: "0.2.0", project: { root: "../new-game" },
      build: { entries: ["specs/store.expec"] } }, manifestLocation);

    project.read();
    project.resolveDependencies();

    project.expectConfiguration();
    project.expectProject("../new-game");
    project.expectEntries(["specs/store.expec"]);
    project.expectManifestSource(manifestLocation);
    project.expectDependencies();
    await project.expectFilesExactly({ "src/handwritten.ts": "export const keep = 42;" });
    await project.expectNoProjectCreated("../new-game");
  });
});
