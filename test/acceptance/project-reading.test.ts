import { describe, it } from 'vitest';
import { ProjectReading } from '../dsl/project-reading.js';

describe('reading the current complete representation', () => {
  it('returns private state, handwritten bodies and explicitly associated companion files', async () => {
    const project = await ProjectReading.create();
    await project.files({
      'src/store.ts': 'export class StoreGame {\n  private retries = 0;\n  save(value: string) { this.retries++; return value.trim(); }\n}\n',
      'src/storage.ts': 'export function serialize(value: string) { return "saved:" + value; }\n',
      'test/store.test.ts': '// handwritten regression\nexport const expected = "Dune";\n',
    });
    project.associateSymbol('store', 'src/store.ts', [{ kind: 'class', name: 'StoreGame' }]);
    project.associateFile('store', 'src/storage.ts');
    project.associateFile('store', 'test/store.test.ts');

    await project.read('store');

    project.expectReadFiles(['src/store.ts', 'src/storage.ts', 'test/store.test.ts']);
    project.expectExactFile('src/store.ts', 'export class StoreGame {\n  private retries = 0;\n  save(value: string) { this.retries++; return value.trim(); }\n}\n');
    project.expectExactFile('src/storage.ts', 'export function serialize(value: string) { return "saved:" + value; }\n');
    project.expectExactFile('test/store.test.ts', '// handwritten regression\nexport const expected = "Dune";\n');
    project.expectReadComplete();
    project.expectProjectAndAssociationsUnchanged();
  });

  it('returns whole shared files without claiming their unrelated declarations', async () => {
    const project = await ProjectReading.create();
    await project.files({ 'store.ts': 'export class StoreGame {}\nexport class Unrelated { secret = "keep"; }\n' });
    project.associateSymbol('store', 'store.ts', [{ kind: 'class', name: 'StoreGame' }]);

    await project.read('store');
    project.expectExactFile('store.ts', 'export class StoreGame {}\nexport class Unrelated { secret = "keep"; }\n');
    await project.search('store');
    project.expectDefinitions([{ file: 'store.ts', declaration: 'export class StoreGame {}' }]);
    project.expectNoDefinition('class Unrelated');
  });

  it('uses fresh live bytes after a body edit through the same configured reader', async () => {
    const project = await ProjectReading.create();
    await project.files({ 'store.ts': 'export class StoreGame { save() { return "before"; } }' });
    project.associateSymbol('store', 'store.ts', [{ kind: 'class', name: 'StoreGame' }]);
    await project.read('store');
    project.rememberRead('before');

    await project.edit('store.ts', 'export class StoreGame { save() { return "after"; } }');
    await project.read('store');

    project.expectExactFile('store.ts', 'export class StoreGame { save() { return "after"; } }');
    project.expectFileVersionChanged('store.ts', 'before');
    project.expectRememberedFile('before', 'store.ts', 'export class StoreGame { save() { return "before"; } }');
  });

  it('keeps a declaration association valid when comments move its text', async () => {
    const project = await ProjectReading.create();
    await project.files({ 'store.ts': 'export class StoreGame {}' });
    project.associateSymbol('store', 'store.ts', [{ kind: 'class', name: 'StoreGame' }]);
    await project.search('store');

    await project.edit('store.ts', '// handwritten introduction\n\nexport class StoreGame {}');
    await project.search('store');

    project.expectDefinitions([{ file: 'store.ts', declaration: 'export class StoreGame {}', line: 3 }]);
    project.expectNoMappingProblem();
  });

  it('retains readable neighbors when one associated file disappeared', async () => {
    const project = await ProjectReading.create();
    await project.files({ 'store.ts': 'export class StoreGame {}' });
    project.associateSymbol('store', 'store.ts', [{ kind: 'class', name: 'StoreGame' }]);
    project.associateFile('store', 'missing.test.ts');

    await project.read('store');

    project.expectExactFile('store.ts', 'export class StoreGame {}');
    project.expectProblemAtFile('missing-project-artifact', 'missing.test.ts');
    project.expectReadIncomplete();
  });

  it('reads a non-TypeScript companion as exact bytes without claiming semantic search', async () => {
    const project = await ProjectReading.create();
    await project.fileBytes('drawing.bin', [0, 255, 10, 128]);
    project.associateFile('store', 'drawing.bin');

    await project.read('store');
    project.expectExactBytes('drawing.bin', [0, 255, 10, 128]);
    project.expectReadComplete();
    await project.search('store');
    project.expectProblem('missing-symbol-association');
    project.expectSearchIncomplete();
  });
});

describe('native symbols distinguish definitions and their actual uses', () => {
  it('reads an explicitly declared constructor parameter property as a class property', async () => {
    const project = await ProjectReading.create();
    await project.files({ 'store.ts': 'export class Store { constructor(public title: string) {} }\nconst store = new Store("Dune"); store.title;' });
    project.associateSymbol('title', 'store.ts', [
      { kind: 'class', name: 'Store' }, { kind: 'property', name: 'title', static: false },
    ]);

    await project.search('title');

    project.expectDefinitions([{ file: 'store.ts', declaration: 'public title: string' }]);
    project.expectIncomingAt({ file: 'store.ts', text: 'title', within: 'store.title', role: 'value' });
    project.expectSearchCompleteWithinDeclaredScope();
  });

  it('does not invent a property for an ordinary constructor parameter', async () => {
    const project = await ProjectReading.create();
    await project.files({ 'store.ts': 'export class Store { constructor(title: string) { title.trim(); } }' });
    project.associateSymbol('title', 'store.ts', [
      { kind: 'class', name: 'Store' }, { kind: 'property', name: 'title', static: false },
    ]);

    await project.search('title');

    project.expectDefinitions([]);
    project.expectProblem('missing-project-symbol');
    project.expectSearchIncomplete();
  });

  it('finds a Launcher that has no declaration or association in the specification', async () => {
    const project = await ProjectReading.create();
    await project.files({
      'src/store.ts': 'export class StoreGame {}',
      'src/launcher.ts': 'import { StoreGame } from "./store.js";\nexport class Launcher { start() { return new StoreGame(); } }',
    });
    project.associateSymbol('store', 'src/store.ts', [{ kind: 'class', name: 'StoreGame' }]);

    await project.search('store');

    project.expectDefinitions([{ file: 'src/store.ts', declaration: 'export class StoreGame {}' }]);
    project.expectProjectOnlyIncoming({ file: 'src/launcher.ts', text: 'StoreGame', within: 'new StoreGame()', role: 'construct' });
    project.expectIncomingAt({ file: 'src/launcher.ts', text: 'StoreGame', within: 'import { StoreGame }', role: 'import' });
    project.expectSearchCompleteWithinDeclaredScope();
    project.expectNoNewSpecificationIdentities();
    project.expectProjectAndAssociationsUnchanged();
  });

  it('follows import aliases and a re-export chain to the original declaration', async () => {
    const project = await ProjectReading.create();
    await project.files({
      'store.ts': 'export class StoreGame {}',
      'index.ts': 'export { StoreGame as Game } from "./store.js";',
      'launcher.ts': 'import { Game as Shop } from "./index.js";\nexport const running = new Shop();',
    });
    project.associateSymbol('store', 'store.ts', [{ kind: 'class', name: 'StoreGame' }]);

    await project.search('store');

    project.expectDefinitions([{ file: 'store.ts', declaration: 'export class StoreGame {}' }]);
    project.expectIncomingAt({ file: 'index.ts', text: 'StoreGame', role: 'export' });
    project.expectIncomingAt({ file: 'launcher.ts', text: 'Shop', within: 'new Shop()', role: 'construct' });
    project.expectNoProjectOnlyTargetForImportedAlias('Shop');
  });

  it('does not confuse a shadowing class, comments or strings with uses of the selected symbol', async () => {
    const project = await ProjectReading.create();
    await project.files({
      'store.ts': 'export class StoreGame {}',
      'other.ts': 'export class StoreGame {}\nconst text = "StoreGame";\n// StoreGame\nnew StoreGame();',
    });
    project.associateSymbol('store', 'store.ts', [{ kind: 'class', name: 'StoreGame' }]);

    await project.search('store');

    project.expectIncomingUses([]);
    project.expectSearchCompleteWithinDeclaredScope();
  });

  it('retains type uses separately from construction and calls', async () => {
    const project = await ProjectReading.create();
    await project.files({
      'store.ts': 'export class StoreGame { save() {} }',
      'launcher.ts': 'import { StoreGame } from "./store.js";\nexport function run(game: StoreGame) { game.save(); return new StoreGame(); }',
    });
    project.associateSymbol('store', 'store.ts', [{ kind: 'class', name: 'StoreGame' }]);

    await project.search('store');

    project.expectIncomingAt({ file: 'launcher.ts', text: 'StoreGame', within: 'game: StoreGame', role: 'type' });
    project.expectIncomingAt({ file: 'launcher.ts', text: 'save', within: 'game.save()', role: 'call' });
    project.expectIncomingAt({ file: 'launcher.ts', text: 'StoreGame', within: 'new StoreGame()', role: 'construct' });
    project.expectNoRuntimeExecutionClaim();
  });

  it('preserves native overload definitions as one associated symbol', async () => {
    const project = await ProjectReading.create();
    await project.files({
      'store.ts': 'export function save(value: string): string;\nexport function save(value: number): number;\nexport function save(value: string | number) { return value; }',
      'call.ts': 'import { save } from "./store.js";\nexport const receipt = save("Dune");',
    });
    project.associateSymbol('save', 'store.ts', [{ kind: 'function', name: 'save' }]);

    await project.search('save');

    project.expectDefinitionLines('store.ts', [1, 2, 3]);
    project.expectIncomingAt({ file: 'call.ts', text: 'save', within: 'save("Dune")', role: 'call' });
    project.expectNoProblem('ambiguous-project-symbol');
  });

  it('keeps construction identity separate from the class used as a type', async () => {
    const project = await ProjectReading.create();
    await project.files({
      'store.ts': 'export class StoreGame { constructor(config: string) {} }',
      'run.ts': 'import { StoreGame } from "./store.js";\nexport function run(game: StoreGame) { return new StoreGame("fast"); }',
    });
    project.associateSymbol('store', 'store.ts', [{ kind: 'class', name: 'StoreGame' }]);
    project.associateSymbol('construction', 'store.ts', [
      { kind: 'class', name: 'StoreGame' }, { kind: 'constructor', name: 'constructor' },
    ]);
    project.associateSymbol('run', 'run.ts', [{ kind: 'function', name: 'run' }]);

    await project.search('construction');
    project.expectDefinitions([{ file: 'store.ts', declaration: 'constructor(config: string) {}' }]);
    project.expectIncomingFrom('run', { file: 'run.ts', text: 'StoreGame', within: 'new StoreGame("fast")', role: 'construct' });
    project.expectNoIncomingAt({ file: 'run.ts', text: 'StoreGame', within: 'game: StoreGame' });
    project.expectNoIncomingAt({ file: 'run.ts', text: 'StoreGame', within: 'import { StoreGame }' });
    project.expectNoProblem('conflicting-project-association');

    await project.search('run');
    project.expectOutgoingTo('store', { file: 'run.ts', text: 'StoreGame', within: 'game: StoreGame', role: 'type' });
    project.expectOutgoingTo('construction', { file: 'run.ts', text: 'StoreGame', within: 'new StoreGame("fast")', role: 'construct' });
  });

  it('includes a merged declaration from a second captured source file', async () => {
    const project = await ProjectReading.create();
    await project.files({
      'book.ts': 'interface Book { title: string }',
      'more.ts': 'interface Book { copies: number }',
      'use.ts': 'const book: Book = { title: "Dune", copies: 1 };',
    });
    project.associateSymbol('book', 'book.ts', [{ kind: 'interface', name: 'Book' }]);

    await project.read('book');
    project.expectReadFiles(['book.ts', 'more.ts']);
    project.expectExactFile('more.ts', 'interface Book { copies: number }');
    await project.search('book');
    project.expectDefinitions([{ file: 'book.ts', declaration: 'interface Book { title: string }' },
      { file: 'more.ts', declaration: 'interface Book { copies: number }' }]);
    project.expectIncomingAt({ file: 'use.ts', text: 'Book', role: 'type' });
  });

  it('distinguishes a static method from the same named instance method', async () => {
    const project = await ProjectReading.create();
    await project.files({ 'store.ts': 'export class StoreGame { static save() {}\nsave() {} }\nStoreGame.save();\nnew StoreGame().save();' });
    project.associateSymbol('static-save', 'store.ts', [
      { kind: 'class', name: 'StoreGame' }, { kind: 'method', name: 'save', static: true },
    ]);

    await project.search('static-save');

    project.expectIncomingAt({ file: 'store.ts', text: 'save', within: 'StoreGame.save()', role: 'call' });
    project.expectNoIncomingAt({ file: 'store.ts', text: 'save', within: 'new StoreGame().save()' });
  });

  it('does not reconnect a renamed declaration using a similar name or body', async () => {
    const project = await ProjectReading.create();
    await project.files({ 'store.ts': 'export class RenamedGame {}' });
    project.associateSymbol('store', 'store.ts', [{ kind: 'class', name: 'StoreGame' }]);

    await project.read('store');
    project.expectExactFile('store.ts', 'export class RenamedGame {}');
    project.expectProblem('missing-project-symbol');
    await project.search('store');
    project.expectDefinitions([]);
    project.expectSearchIncomplete();
    project.expectAssociationsUnchanged();
  });

  it('reports conflicting identity claims instead of selecting by association order', async () => {
    const project = await ProjectReading.create();
    await project.files({ 'store.ts': 'export class StoreGame {}\nexport interface StoreGame { title: string }' });
    project.associateSymbol('first', 'store.ts', [{ kind: 'class', name: 'StoreGame' }]);
    project.associateSymbol('second', 'store.ts', [{ kind: 'interface', name: 'StoreGame' }]);

    await project.search('first');

    project.expectProblem('conflicting-project-association');
    project.expectSearchIncomplete();
    project.expectNoGuessedSpecifiedTarget();
  });
});

describe('actual dependencies inform existing reconciliation', () => {
  it('separates matched dependencies, unobserved expectations and project-only code', async () => {
    const project = await ProjectReading.create();
    project.specification('opaque type A\nopaque type B\nopaque type C\nconcept Store {\ndepends on A, B, C\n}');
    await project.files({
      'dependencies.ts': 'export class A {}\nexport class B {}\nexport class D {}',
      'store.ts': 'import { A, B, D } from "./dependencies.js";\nexport class Store { a = new A(); b = new B(); d = new D(); }',
    });
    project.associateSymbolFromSpecification('Store', 'store.ts', [{ kind: 'class', name: 'Store' }]);
    project.associateSymbolFromSpecification('A', 'dependencies.ts', [{ kind: 'class', name: 'A' }]);
    project.associateSymbolFromSpecification('B', 'dependencies.ts', [{ kind: 'class', name: 'B' }]);

    await project.searchSpecified('Store');
    project.reconcileOutgoingWith(['A', 'B', 'C']);

    project.expectMatched(['A', 'B']);
    project.expectUnobserved(['C']);
    project.expectProjectOnlyOutgoing({ file: 'store.ts', text: 'D', within: 'new D()', role: 'construct' });
    project.expectObservedOnlyAt('store.ts', 'new D()');
    project.expectProjectAndSpecificationUnchanged();
  });

  it('keeps private implementation dependencies without adding parameters or internal helpers as dependencies', async () => {
    const project = await ProjectReading.create();
    await project.files({
      'storage.ts': 'export class Storage { write(value: string) {} }',
      'store.ts': 'import { Storage } from "./storage.js";\nexport class StoreGame {\nprivate storage = new Storage();\nprivate trim(value: string) { return value.trim(); }\nsave(value: string) { this.storage.write(this.trim(value)); }\n}',
    });
    project.associateSymbol('store', 'store.ts', [{ kind: 'class', name: 'StoreGame' }]);
    project.associateSymbol('storage', 'storage.ts', [{ kind: 'class', name: 'Storage' }]);

    await project.search('store');

    project.expectOutgoingTo('storage', { file: 'store.ts', text: 'Storage', within: 'new Storage()', role: 'construct' });
    project.expectOutgoingTo('storage', { file: 'store.ts', text: 'write', role: 'call' });
    project.expectNoOutgoingLocal('value');
    project.expectNoOutgoingLocal('trim');
    project.expectNoOutgoingTo('store');
  });

  it('attributes an incoming member call to an explicitly associated consumer', async () => {
    const project = await ProjectReading.create();
    await project.files({
      'store.ts': 'export class StoreGame { save() {} }',
      'launcher.ts': 'import { StoreGame } from "./store.js";\nexport class Launcher { run(store: StoreGame) { store.save(); } }',
    });
    project.associateSymbol('store', 'store.ts', [{ kind: 'class', name: 'StoreGame' }]);
    project.associateSymbol('launcher', 'launcher.ts', [{ kind: 'class', name: 'Launcher' }]);

    await project.search('store');

    project.expectIncomingFrom('launcher', { file: 'launcher.ts', text: 'save', within: 'store.save()', role: 'call' });
    project.expectProjectOnlyIncoming({ file: 'launcher.ts', text: 'StoreGame', within: 'import { StoreGame }', role: 'import' });
  });

  it('does not attribute an unused import to every declaration in a shared file', async () => {
    const project = await ProjectReading.create();
    await project.files({
      'storage.ts': 'export class Storage {}',
      'store.ts': 'import { Storage } from "./storage.js";\nexport class StoreGame {}\nexport const separate = new Storage();',
    });
    project.associateSymbol('store', 'store.ts', [{ kind: 'class', name: 'StoreGame' }]);
    project.associateSymbol('storage', 'storage.ts', [{ kind: 'class', name: 'Storage' }]);

    await project.search('store');

    project.expectOutgoingUses([]);
  });
});

describe('the supplied capture bounds TypeScript configuration and resolution', () => {
  it('keeps forced module declarations separate in an explicit native configuration', async () => {
    const project = await ProjectReading.create({ configFile: 'tsconfig.json' });
    await project.files({
      'tsconfig.json': '{"compilerOptions":{"moduleDetection":"force"},"files":["book.ts","more.ts"]}',
      'book.ts': 'interface Book { title: string }',
      'more.ts': 'interface Book { copies: number }',
    });
    project.associateSymbol('book', 'book.ts', [{ kind: 'interface', name: 'Book' }]);

    await project.read('book');
    project.expectReadFiles(['book.ts']);
    await project.search('book');
    project.expectDefinitions([{ file: 'book.ts', declaration: 'interface Book { title: string }' }]);
    project.expectNoDefinitionFrom('more.ts');
    project.expectSearchCompleteWithinDeclaredScope();
  });

  it('uses captured JSONC configuration, extends and a path alias', async () => {
    const project = await ProjectReading.create({ configFile: 'tsconfig.json' });
    await project.files({
      'tsconfig.json': '{ // native JSONC\n"extends": "./base.json", "include": ["src/**/*"],\n}',
      'base.json': '{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"Bundler","baseUrl":".","paths":{"@store":["src/store.ts"]}}}',
      'src/store.ts': 'export class StoreGame {}',
      'src/run.ts': 'import { StoreGame } from "@store";\nexport const store = new StoreGame();',
      'ignored.ts': 'this is not valid TypeScript',
    });
    project.associateSymbol('store', 'src/store.ts', [{ kind: 'class', name: 'StoreGame' }]);

    await project.search('store');

    project.expectIncomingAt({ file: 'src/run.ts', text: 'StoreGame', within: 'new StoreGame()', role: 'construct' });
    project.expectScopeFiles(['src/run.ts', 'src/store.ts']);
    project.expectConfiguredExclusion('ignored.ts');
    project.expectNoNativeDiagnosticFrom('ignored.ts');
  });

  it('does not silently use defaults after an explicit config is missing', async () => {
    const project = await ProjectReading.create({ configFile: 'missing.json' });
    await project.files({ 'store.ts': 'export class StoreGame {}' });
    project.associateSymbol('store', 'store.ts', [{ kind: 'class', name: 'StoreGame' }]);

    await project.search('store');

    project.expectProblemAtFile('missing-project-config', 'missing.json');
    project.expectSearchIncomplete();
    project.expectNoDefaultProfileSubstitution();
  });

  it('reads an associated file outside the configured program without adding a semantic root', async () => {
    const project = await ProjectReading.create({ configFile: 'tsconfig.json' });
    await project.files({
      'tsconfig.json': '{"files":["run.ts"]}',
      'run.ts': 'export const unrelated = true;',
      'store.ts': 'export class StoreGame { private handwritten = "keep"; }',
    });
    project.associateSymbol('store', 'store.ts', [{ kind: 'class', name: 'StoreGame' }]);

    await project.read('store');
    project.expectExactFile('store.ts', 'export class StoreGame { private handwritten = "keep"; }');
    project.expectProblemAtFile('outside-project-program', 'store.ts');
    project.expectReadIncomplete();
    await project.search('store');
    project.expectDefinitions([]);
    project.expectProblemAtFile('outside-project-program', 'store.ts');
    project.expectScopeFiles(['run.ts']);
    project.expectSearchIncomplete();
    project.expectNoDefaultProfileSubstitution();
  });

  it('reports uncaptured packages even if a matching package exists outside the snapshot', async () => {
    const project = await ProjectReading.create();
    await project.files({ 'store.ts': 'import { Storage } from "storage-lib";\nexport class StoreGame { storage = new Storage(); }' });
    await project.outsideCaptureFile('node_modules/storage-lib/index.d.ts', 'export class Storage {}');
    project.associateSymbol('store', 'store.ts', [{ kind: 'class', name: 'StoreGame' }]);

    await project.searchWithProjectFilesystemReadsForbidden('store');

    project.expectNativeProblemAt(2307, 'store.ts', '"storage-lib"');
    project.expectOutgoingUnresolvedAt('store.ts', '"storage-lib"');
    project.expectSearchIncomplete();
    project.expectNoAmbientProjectFileReads();
  });

  it('uses a captured read-only package declaration without claiming its native symbol', async () => {
    const project = await ProjectReading.create();
    await project.files({
      'node_modules/storage-lib/package.json': '{"name":"storage-lib","types":"index.d.ts"}',
      'node_modules/storage-lib/index.d.ts': 'export declare class Storage { write(value: string): void }',
      'store.ts': 'import { Storage } from "storage-lib";\nexport class StoreGame { storage = new Storage(); }',
    });
    project.associateSymbol('store', 'store.ts', [{ kind: 'class', name: 'StoreGame' }]);
    project.captureNativeDependencies();

    await project.search('store');

    project.expectNativeTarget({ file: 'node_modules/storage-lib/index.d.ts', declaration: 'export declare class Storage { write(value: string): void }' },
      { file: 'store.ts', text: 'Storage', within: 'new Storage()', role: 'construct' });
    project.expectSearchCompleteWithinDeclaredScope();
  });

  it('uses the installed pinned standard library without resolving arbitrary disk paths', async () => {
    const project = await ProjectReading.create();
    await project.files({ 'store.ts': 'export class StoreGame { async titles(): Promise<string[]> { return ["Dune"].map(title => title.trim()); } }' });
    project.associateSymbol('store', 'store.ts', [{ kind: 'class', name: 'StoreGame' }]);

    await project.searchWithProjectFilesystemReadsForbidden('store');

    project.expectNoNativeProblems();
    project.expectLibraryResourcesConfinedToPinnedTypeScript();
    project.expectNoLibraryFileAsProjectArtifact();
    project.expectProjectUnchanged();
  });

  it('keeps composite projects explicitly incomplete instead of flattening their scopes', async () => {
    const project = await ProjectReading.create({ configFile: 'tsconfig.json' });
    await project.files({
      'tsconfig.json': '{"files":["store.ts"],"references":[{"path":"./other"}]}',
      'store.ts': 'export class StoreGame {}',
      'other/tsconfig.json': '{"compilerOptions":{"composite":true},"files":["store.ts"]}',
      'other/store.ts': 'export class StoreGame { other = true; }',
    });
    project.associateSymbol('store', 'store.ts', [{ kind: 'class', name: 'StoreGame' }]);

    await project.search('store');

    project.expectProblem('unsupported-project-config');
    project.expectSearchIncomplete();
    project.expectNoDefinitionFrom('other/store.ts');
  });
});

describe('coverage and observation ownership remain honest', () => {
  it('retains useful incoming evidence alongside a dynamic lookup', async () => {
    const project = await ProjectReading.create();
    await project.files({
      'store.ts': 'export class StoreGame {}',
      'launcher.ts': 'import { StoreGame } from "./store.js";\nexport const store = new StoreGame();\nexport async function load(name: string) { return import(name); }',
    });
    project.associateSymbol('store', 'store.ts', [{ kind: 'class', name: 'StoreGame' }]);

    await project.search('store');

    project.expectIncomingAt({ file: 'launcher.ts', text: 'StoreGame', within: 'new StoreGame()', role: 'construct' });
    project.expectIncomingUnresolvedAt('launcher.ts', 'import(name)');
    project.expectIncomingIncomplete();
    project.expectOutgoingCompleteWithinDeclaredScope();
  });

  it('does not choose one dependency for a union receiver with different native members', async () => {
    const project = await ProjectReading.create();
    await project.files({ 'store.ts': 'export class Disk { save() {} }\nexport class Cloud { save() {} }\nexport class StoreGame { save(storage: Disk | Cloud) { storage.save(); } }' });
    project.associateSymbol('store', 'store.ts', [{ kind: 'class', name: 'StoreGame' }]);
    project.associateSymbol('disk', 'store.ts', [{ kind: 'class', name: 'Disk' }]);
    project.associateSymbol('cloud', 'store.ts', [{ kind: 'class', name: 'Cloud' }]);

    await project.search('store');

    project.expectOutgoingUnresolvedAt('store.ts', 'storage.save');
    project.expectNoSingleCallTargetAt('store.ts', 'storage.save()');
    project.expectOutgoingTo('disk', { file: 'store.ts', text: 'Disk', within: 'Disk | Cloud', role: 'type' });
    project.expectOutgoingTo('cloud', { file: 'store.ts', text: 'Cloud', within: 'Disk | Cloud', role: 'type' });
    project.expectOutgoingIncomplete();
  });

  it('preserves exact UTF-16 locations after a non-BMP character', async () => {
    const project = await ProjectReading.create();
    await project.files({
      'store.ts': 'export class StoreGame {}',
      'run.ts': 'import { StoreGame } from "./store.js";\nconst title = "📚"; new StoreGame();',
    });
    project.associateSymbol('store', 'store.ts', [{ kind: 'class', name: 'StoreGame' }]);

    await project.search('store');

    project.expectIncomingUtf16Slice('run.ts', 'StoreGame', { within: 'new StoreGame()', role: 'construct' });
    project.expectSitesUseCapturedFileVersion('run.ts');
  });

  it('keeps an unreadable captured path as a gap while returning independent evidence', async () => {
    const project = await ProjectReading.create();
    await project.files({ 'store.ts': 'export class StoreGame {}', 'run.ts': 'import { StoreGame } from "./store.js"; new StoreGame();' });
    project.associateSymbol('store', 'store.ts', [{ kind: 'class', name: 'StoreGame' }]);
    const captured = await project.captureWithReadFailure('broken.ts');

    project.searchSnapshot('store', captured);

    project.expectOriginalSnapshotProblem('read-failed', 'broken.ts');
    project.expectIncomingAt({ file: 'run.ts', text: 'StoreGame', within: 'new StoreGame()', role: 'construct' });
    project.expectSearchIncomplete();
  });

  it('does not reuse a program merely because the snapshot object and supplied version stayed the same', async () => {
    const project = await ProjectReading.create();
    await project.files({ 'store.ts': 'export class StoreGame {}', 'run.ts': 'import { StoreGame } from "./store.js"; new StoreGame();' });
    project.associateSymbol('store', 'store.ts', [{ kind: 'class', name: 'StoreGame' }]);
    const captured = await project.capture();
    project.searchSnapshot('store', captured);
    project.rememberSearch('before');

    project.replaceCapturedBytesKeepingVersion(captured, 'run.ts', 'export const unused = true;');
    project.searchSnapshot('store', captured);

    project.expectIncomingUses([]);
    project.expectRememberedIncomingAt('before', 'run.ts', 'new StoreGame()');
  });

  it('keeps earlier file bytes and later reads independent of caller mutation', async () => {
    const project = await ProjectReading.create();
    await project.files({ 'store.ts': 'export class StoreGame {}' });
    project.associateSymbol('store', 'store.ts', [{ kind: 'class', name: 'StoreGame' }]);
    await project.read('store');
    project.mutateReturnedBytes('store.ts');

    await project.read('store');

    project.expectExactFile('store.ts', 'export class StoreGame {}');
    project.expectProjectUnchanged();
  });

});
