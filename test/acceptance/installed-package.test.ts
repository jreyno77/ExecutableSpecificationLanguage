import { afterAll, beforeAll, describe, it } from 'vitest';
import { PackageExamples } from '../dsl/installed-package.js';

beforeAll(() => PackageExamples.prepare());
afterAll(() => PackageExamples.finish());

describe('Installed package consumers', () => {
  it('builds a useful catalog through a public installed launcher with checkout access blocked', async () => {
    const consumer = new PackageExamples();
    await consumer.installCurrentPackage();
    await consumer.buildPublicCatalog('function save(snapshot: Text) returns Nothing');
    consumer.expectPublicCatalog('save(snapshot: Text) returns Nothing\n');
    consumer.expectCheckoutAndPrivateImportsBlocked();
    consumer.expectInstalledPackageUsed();
  });
  it('checks a real manifest through the installed expec command without writing project files', async () => {
    const consumer = new PackageExamples();
    await consumer.installCurrentPackage();
    await consumer.checkFromInstalledCommand();
    consumer.expectInstalledCommandCheckedWithoutWriting();
    consumer.expectInstalledPackageUsed();
    await consumer.checkTypeScriptConsumer(); consumer.expectDeclarationsAccepted();
  });

  it('runs generated shopping scenarios through an authored HTTP fixture and closes its servers', async () => {
    const consumer = new PackageExamples();
    await consumer.installCurrentPackage();
    await consumer.runInstalledHttpLifecycle();
    consumer.expectHttpScenarioPassed('a shopper can add an available book');
    consumer.expectHttpNoOpFailed('a shopper can add an available book', 0, 1);
    consumer.expectHttpServersClosed(); consumer.expectInstalledPackageUsed();
  });
  it('generates readable shopping tests that reject a real basket which adds nothing', async () => {
    const consumer = new PackageExamples();
    await consumer.installCurrentPackage();
    await consumer.generateShoppingAcceptance();
    consumer.expectShoppingSteps([
      'await shopping.bookIsAvailable("Dune")', 'await shopping.startWithEmptyBasket()',
      'await shopping.addBook("Dune")', 'await shopping.expectBookQuantity("Dune", 1)',
    ]);
    consumer.expectShoppingPassed('a shopper can add an available book');
    consumer.expectBrokenBasketFailed('a shopper can add an available book', 0, 1);
    consumer.expectAcceptanceAndDriverPreserved();
    consumer.expectInstalledPackageUsed();
    await consumer.checkTypeScriptConsumer(); consumer.expectDeclarationsAccepted();
  });

  it('guards a planned write when an actual external native input changes through the installed package', async () => {
    const consumer = new PackageExamples();
    await consumer.installCurrentPackage();
    await consumer.applyWriteAfterNativeReplacement({
      library: 'catalog.jar', before: 'version-one', after: 'version-two', file: 'result.txt', text: 'written',
    });
    consumer.expectExternalNativeChangeStopsWrite('result.txt', 'version-one', 'version-two');
    consumer.expectInstalledPackageUsed();
    await consumer.checkTypeScriptConsumer();
    consumer.expectDeclarationsAccepted();
  });

  it('preserves an adopted implementation and its caller through an installed native rename', async () => {
    const consumer = new PackageExamples();
    await consumer.installCurrentPackage();
    await consumer.preserveTypeScript({
      source: 'class StoreGame { public save\ncapability save(snapshot: Text) returns Nothing }',
      revised: 'class StoreGame { public saveGame\ncapability saveGame(snapshot: Text) returns Nothing }',
      implementation: 'export class StoreGame { private saves = 0; save(snapshot: string): void { this.saves++; console.log(snapshot); } }\n',
      caller: 'import { StoreGame } from "./game.js"; new StoreGame().save("Dune");\n',
    });
    consumer.expectAdoptedSourceUnchanged();
    consumer.expectPreservedNativeSource('private saves = 0; saveGame(snapshot: string): void { this.saves++; console.log(snapshot); }');
    consumer.expectPreservedCaller('new StoreGame().saveGame("Dune")');
    consumer.expectPreservedRuntimeOutput('Dune');
    consumer.expectInstalledPackageUsed();
    await consumer.checkTypeScriptConsumer(); consumer.expectDeclarationsAccepted();
  });

  it('compiles every configured workspace entry with one shared Book through the installed package', async () => {
    const consumer = new PackageExamples();
    await consumer.installCurrentPackage();
    await consumer.compileWorkspace({
      'game.expec': 'use Book from "./catalog.expec"\nfunction save(book: Book) returns Nothing',
      'checkout.expec': 'use Book from "./catalog.expec"\nfunction price(book: Book) returns Number',
      'catalog.expec': 'type Book { title: Text }',
    }, ['game.expec', 'checkout.expec']);

    consumer.expectWorkspaceFunctions(['price', 'save']);
    consumer.expectSharedWorkspaceType('Book', 2);
    consumer.expectInstalledPackageUsed();
  });

  it('queries actual installed Vitest declarations and refuses a write after they change', async () => {
    const consumer = new PackageExamples();
    await consumer.installCurrentPackage();
    await consumer.captureNativeDependencies({ vitest: '5.0.2', '@types/node': '24.13.6' });
    consumer.expectInstalledMethodConsumer('test/manual.ts', 'expectQuantity');
    consumer.expectReadOnlyNativeEvidence('node_modules/vitest/dist/index.d.ts');
    consumer.expectChangedNativeEvidenceStopsWrite('notes.txt');
    consumer.expectInstalledPackageUsed();
    await consumer.checkTypeScriptConsumer();
    consumer.expectDeclarationsAccepted();
  });

  it('initializes the chosen project and builds its starter through installed public exports', async () => {
    const consumer = new PackageExamples();
    await consumer.installCurrentPackage();
    await consumer.initializeProject('chosen-game', 'typescript');
    consumer.expectInstalledInitialization(['package.json', 'tsconfig.json', 'src/index.ts', '.gitignore']);
    consumer.expectInstalledToolchainAcquired('typescript', '5.9.3');
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
      'function save(title: Text, copies: Number) returns Nothing', 'title: number');

    consumer.expectInstalledTypeScriptScaffold('Not implemented: save');
    consumer.expectInvalidNativeArgument('64');
    consumer.expectConflictingNativeSignatureProtected();
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

  it('acquires packages in a UUID folder through the installed public product', async () => {
    const consumer = new PackageExamples();
    await consumer.installCurrentPackage();
    await consumer.provideLocalLibraryAndNativeRegistry('workspace-ac9f7484-6445-4166-82d0-d154b34699f2');
    await consumer.installConfiguredStorage();
    consumer.expectSelectedAndInstalledStorage('2.1.0');
    await consumer.loadAcquiredLibrary('use Book from "books"\nfunction save(book: Book) returns Nothing');
    consumer.expectAcquiredFieldType('Book.title', 'Text');
    consumer.expectSelectedAndInstalledStorage('2.1.0');
    consumer.expectNoLibraryModuleInWorkspaceOwnership();
    consumer.expectInstalledPackageUsed();
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
