import { afterAll, beforeAll, describe, it } from 'vitest';
import { PackageExamples } from '../dsl/installed-package.js';

beforeAll(() => PackageExamples.prepare());
afterAll(() => PackageExamples.finish());

describe('Installed package consumers', () => {
  it('initializes the chosen project and builds its starter through installed public exports', async () => {
    const consumer = new PackageExamples();
    await consumer.installCurrentPackage();
    await consumer.initializeProject('chosen-game', 'typescript');
    consumer.expectInstalledInitialization(['package.json', 'tsconfig.json', 'src/index.ts', '.gitignore']);
    consumer.expectInstalledStarterBuild('5.9.3');
    consumer.expectInstalledPackageUsed();
    await consumer.checkTypeScriptConsumer();
    consumer.expectDeclarationsAccepted();
  });

  it('generates a natively checked callable scaffold through the installed TypeScript output', async () => {
    const consumer = new PackageExamples();
    await consumer.installCurrentPackage();
    await consumer.generateTypeScript('function save(title: Text) returns Nothing',
      'import { save } from "./src/save.js"; save("Dune");',
      'import { save } from "./src/save.js"; save(64);',
      'function save(title: Text, copies: Number) returns Nothing');

    consumer.expectInstalledTypeScriptScaffold('Not implemented: save');
    consumer.expectInvalidNativeArgument('64');
    consumer.expectHandwrittenNativeFileProtected();
    consumer.expectInstalledPackageUsed();
    await consumer.checkTypeScriptConsumer();
    consumer.expectDeclarationsAccepted();
  });

  it('renders and searches installed diagrams using only captured input and immutable package resources', async () => {
    const consumer = new PackageExamples();
    await consumer.installCurrentPackage();
    await consumer.diagramProject('concept Store { public save\ncapability save() returns Nothing }');
    consumer.expectInstalledPackageUsed();
    consumer.expectInstalledDiagramFiles(['design/structure.d2', 'design/structure.svg']);
    consumer.expectInstalledNativeSignature('Store', 'save() → Nothing');
    consumer.expectInstalledSvgLabel('Store');
    consumer.expectInstalledDiagramCoverage();
    consumer.expectOnlyInstalledDiagramResourcesUsed();
    await consumer.checkTypeScriptConsumer();
    consumer.expectDeclarationsAccepted();
  });

  it('reads handwritten TypeScript and discovers an unmodeled caller through the installed package', async () => {
    const consumer = new PackageExamples();
    await consumer.installCurrentPackage();
    await consumer.readTypeScriptProject({
      'store.ts': 'export class StoreGame { private count = 1; }',
      'run.ts': 'import { StoreGame } from "./store.js"; export const game = new StoreGame();',
    });

    consumer.expectInstalledProjectFile('store.ts', 'export class StoreGame { private count = 1; }');
    consumer.expectInstalledProjectConsumer('run.ts', 'StoreGame', 'new StoreGame()', 'construct');
    consumer.expectRuntimeTypeScriptInstalled('5.9.3');
    consumer.expectInstalledPackageUsed();
    await consumer.checkTypeScriptConsumer();
    consumer.expectDeclarationsAccepted();
  });

  it('generates readable Markdown and observes notes and links through the installed package', async () => {
    const consumer = new PackageExamples();
    await consumer.installCurrentPackage();
    await consumer.documentProject('concept Game { public save\ncapability save() returns Nothing }', '\nReader note.\n');

    consumer.expectInstalledPackageUsed();
    consumer.expectInstalledDocumentation('reference/Game.md', [
      '# Game', 'capability save() returns Nothing', 'Reader note.',
      'Statically checked specification. Runtime behavior is not verified by this document.',
    ]);
    consumer.expectInstalledDocumentConsumer('guide.md', 'reference/Game.md');
    await consumer.checkTypeScriptConsumer();
    consumer.expectDeclarationsAccepted();
  });

  it('exposes the same error declaration and checked signature to installed public consumers', async () => {
    const consumer = new PackageExamples();
    await consumer.installCurrentPackage();
    await consumer.check('type Account { id: Text }\nerror type AccountError {\ncode: "duplicate-account" | "invalid-account"\nemail: Text\n}\nfunction createAccount(email: Text) returns Account fails with AccountError');
    consumer.expectInstalledPackageUsed();
    consumer.expectSpecificationAccepted();
    consumer.expectDomainFailures('createAccount', 'Account', [
      { family: 'AccountError', codes: ['duplicate-account', 'invalid-account'], payload: ['email: Text'] },
    ]);
    await consumer.checkTypeScriptConsumer();
    consumer.expectDeclarationsAccepted();
  });

  it('checks an unavailable type through the installed package', async () => {
    const consumer = new PackageExamples();
    await consumer.installCurrentPackage();
    await consumer.check('function save(snapshot: Missing) returns Nothing');
    consumer.expectInstalledPackageUsed();
    consumer.expectProblem('unresolved-reference', 'Missing');
    consumer.expectNoAcceptedSpecification();
  });

  it('exposes usable declarations and readable capabilities to a TypeScript consumer', async () => {
    const consumer = new PackageExamples();
    await consumer.installCurrentPackage();
    await consumer.checkTypeScriptConsumer();
    await consumer.check(`concept StoreGame { capability saveGame(snapshot: Text) returns Nothing }
function quantity() returns Number
examples { scenario "count" {
  when result = quantity()
  then result == 1
} }`);
    consumer.expectDeclarationsAccepted();
    consumer.expectSpecificationAccepted();
    consumer.expectCapabilities(['saveGame']);
    consumer.expectSourceLoaded(['saveGame']);
    consumer.expectCheckedCalls(['quantity']);
    consumer.expectCapturedSteps([
      { available: [], capture: { name: 'result', type: 'Number' } },
      { available: [{ name: 'result', type: 'Number' }] },
    ]);
  });

  it('detects a missing implementation file in a packed artifact', async () => {
    const consumer = new PackageExamples();
    await consumer.installPackageWithoutFile('dist/compiler.js');
    await consumer.runPublicApiCheck();
    consumer.expectConsumerFailedFor('compiler.js');
  });

  it('lets generation and documentation consumers read the same checked test body', async () => {
    const consumer = new PackageExamples();
    await consumer.installCurrentPackage();
    await consumer.check(`examples {
observation quantity(title: Text) returns Number
check expected(title: Text, copies: Number) {
let actual = quantity(title)
assert actual == copies
}
}`);
    consumer.expectInstalledPackageUsed();
    consumer.expectSpecificationAccepted();
    consumer.expectTestBody('expected', ['quantity'], ['let actual = quantity(title)', 'assert actual == copies']);
  });

  it('applies a guarded file change through the installed public writer', async () => {
    const consumer = new PackageExamples();
    await consumer.installCurrentPackage();
    await consumer.changeProjectFile('original book', 'updated book');

    consumer.expectInstalledPackageUsed();
    consumer.expectProjectFileChanged('original book', 'updated book');
  });

  it('uses an independently authored installed output to write, read and discover a new consumer', async () => {
    const consumer = new PackageExamples();
    await consumer.installCurrentPackage();
    await consumer.registerCountOutput();
    await consumer.checkTypeScriptConsumer();
    consumer.expectDeclarationsAccepted();
    await consumer.createCountReport(`concept Storage {}
type Snapshot { title: Text }
concept StoreGame {
  depends on Storage, Snapshot
  public save
  capability save(snapshot: Snapshot) returns Nothing
}`, 'reports');
    consumer.expectDeclarationCounts({ concepts: 2, recordTypes: 1, capabilities: 1 });
    consumer.expectCountReportWritten('applied');

    await consumer.readCountReport('StoreGame');
    consumer.expectWholeCountReport('reports/counts.json', '"capabilities": 1');
    await consumer.writeCountConsumer('Release checklist');
    await consumer.searchCountReport();
    consumer.expectCountDefinition('reports/counts.json');
    consumer.expectCountConsumer('notes/release.counts.json', 'Release checklist');
    consumer.expectCompleteCountCoverage('declaration-count report definitions and references');
    consumer.expectInstalledPackageUsed();
  });

  it('detects an undeclared runtime dependency in a packed artifact', async () => {
    const consumer = new PackageExamples();
    await consumer.installPackageWithoutDependency('langium');
    await consumer.runPublicApiCheck();
    consumer.expectConsumerFailedFor('langium');
  });
});
