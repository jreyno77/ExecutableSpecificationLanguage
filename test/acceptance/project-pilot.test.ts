import { afterAll, beforeAll, describe, it } from 'vitest';
import { PackageDriver } from '../driver/installed-package.js';
import { ShoppingPilot } from '../dsl/shopping-pilot.js';
import { DocumentationPilot } from '../dsl/documentation-pilot.js';
import { CompilerPilot } from '../dsl/compiler-pilot.js';
import { StoreGamePilot } from '../dsl/store-game-pilot.js';

beforeAll(() => PackageDriver.prepare(), 240_000);
afterAll(() => PackageDriver.finish());

describe('a maintainer verifies a real application through the installed language', () => {
  it('keeps checked declarations and authored message order consistent in Markdown and UML', async () => {
    const pilot = await DocumentationPilot.fromSource(`type Receipt { saved: Boolean }
concept Screen {
  public show
  capability show(receipt: Receipt) returns Nothing
}
concept Storage {
  public save
  capability save() returns Receipt
}
interaction "save"() {
  participant screen: Screen
  participant storage: Storage
  message screen -> storage.save() as receipt
  message storage -> screen.show(receipt)
}`);
    await pilot.buildOutputs();
    await pilot.expectDocumentedSignature('Storage', 'save', [], 'Receipt');
    pilot.expectNativeMessages('save', ['screen -> storage: receipt: Receipt = save()', 'storage -> screen: show(receipt)']);
    pilot.expectNativeSvgLabels(['screen', 'storage', 'save()', 'show(receipt)']);
    pilot.expectDeclaredCommunicationOnly();
  }, 180_000);

  it('runs the generated Dune scenario from a wrong basket to the repaired HTTP application', async () => {
    const pilot = await ShoppingPilot.create('Dune', 1);
    await pilot.initializeAndInstall();
    await pilot.build();
    await pilot.connectHttpFixture();
    await pilot.build();
    await pilot.rememberGeneratedTests();

    await pilot.runScenarios();
    pilot.expectQuantityDifference(1, 0);
    await pilot.expectActualQuantity('Dune', 0);
    await pilot.expectAllServersClosed();

    await pilot.repairActualAddEndpoint();
    await pilot.runScenarios();
    pilot.expectScenarioPassed('a shopper can add an available book');
    await pilot.expectActualQuantity('Dune', 1);
    await pilot.expectAllServersClosed();
    await pilot.expectGeneratedTestsUnchanged();
  }, 600_000);
});

describe('the language develops useful compiler acceptance', () => {
  it('rejects a suppressed real compiler finding through its generated acceptance test', async () => {
    const pilot = await CompilerPilot.fromExamples(`  scenario "undeclared public capability is rejected" {
    when readSource("concept StoreGame {\\n  public saveGame\\n  capability save() returns Nothing\\n}")
    then expectProblem("unresolved-reference", "saveGame", 2, 10)
  }`);
    await pilot.initializeAndInstall();
    await pilot.rememberImplementation();
    await pilot.build();
    await pilot.expectCompilerContract();
    await pilot.useCompilerDriver('suppress-real-problems');
    await pilot.runGeneratedTests();
    pilot.expectMissingDiagnosticFails();
    await pilot.expectActualDiagnostic('unresolved-reference', 'saveGame', 2, 10);

    await pilot.useCompilerDriver('actual-packaged-compiler');
    await pilot.runGeneratedTests();
    pilot.expectPassed(['undeclared public capability is rejected']);
    await pilot.expectActualDiagnostic('unresolved-reference', 'saveGame', 2, 10);
    await pilot.expectImplementationKept();
  }, 600_000);

  it('adds the valid counterpart without rewriting the compiler or parser', async () => {
    const pilot = await CompilerPilot.fromExamples(`  scenario "undeclared public capability is rejected" {
    when readSource("concept StoreGame {\\n  public saveGame\\n  capability save() returns Nothing\\n}")
    then expectProblem("unresolved-reference", "saveGame", 2, 10)
  }`);
    await pilot.initializeAndInstall();
    await pilot.rememberImplementation();
    await pilot.build();
    await pilot.useCompilerDriver('actual-packaged-compiler');
    const valid = 'concept StoreGame {\n  public saveGame\n  capability saveGame() returns Nothing\n}';
    await pilot.addAcceptedSource(valid);
    await pilot.build();
    await pilot.runGeneratedTests();
    pilot.expectPassed(['undeclared public capability is rejected', 'matching capability is accepted']);
    await pilot.expectAcceptedSource(valid);
    await pilot.expectImplementationKept();
    await pilot.expectExistingCompilerRegressions();
  }, 600_000);

  it('bootstraps a fresh working copy while the candidate generated DSL remains broken', async () => {
    const pilot = await CompilerPilot.fromExamples(`  scenario "undeclared public capability is rejected" {
    when readSource("concept StoreGame {\\n  public saveGame\\n  capability save() returns Nothing\\n}")
    then expectProblem("unresolved-reference", "saveGame", 2, 10)
  }`);
    await pilot.initializeAndInstall();
    await pilot.rememberImplementation();
    await pilot.build();
    await pilot.useCompilerDriver('actual-packaged-compiler');
    await pilot.retainBootstrap();
    await pilot.breakGeneratedDsl();
    await pilot.expectCandidateSyntaxFailure();

    await pilot.bootstrapFreshCopy();
    await pilot.build();
    await pilot.restoreTrustedDriver();
    await pilot.runGeneratedTests();
    pilot.expectPassed(['undeclared public capability is rejected']);
    await pilot.expectActualDiagnostic('unresolved-reference', 'saveGame', 2, 10);
    await pilot.expectTrustedBootstrapUsed();
  }, 600_000);
});
describe('a maintainer evolves real StoreGame code', () => {
  it('adopts the original single-file implementation without replacing it', async () => {
    const pilot = await StoreGamePilot.originalStoreGame();
    await pilot.rememberOriginalFileBytes();
    await pilot.adoptMappedStoreGame();
    pilot.expectConfirmedMethods(['startup', 'save', 'delete', 'new', 'shutDown']);
    await pilot.expectOriginalFileBytesKept();
    await pilot.expectNoDuplicateNativeClass('StoreGame');
    await pilot.read('StoreGame');
    pilot.expectReadContains(['private running', 'private assertRunning', 'localStorage.setItem', 'export const storeGame']);
  }, 600_000);

  it('adopts the distributed implementation through its actual native aliases', async () => {
    const pilot = await StoreGamePilot.distributedStoreGame();
    await pilot.rememberFiles(['src/models.ts', 'src/game.ts', 'launcher.ts']);
    await pilot.adoptMappedStoreGame();
    await pilot.expectRememberedFilesKept();
    await pilot.search('StoreGame.save');
    pilot.expectDefinition('src/game.ts', 'save');
    pilot.expectProjectOnlyIncoming('launcher.ts', 'save');
    pilot.expectCompleteNativeCoverage();
    await pilot.checkNativeTypes();
    pilot.expectNativeTypesAccepted();
  }, 600_000);

  it('renames saving and exposes the new Supabase obligation while retaining local saving', async () => {
    const pilot = await StoreGamePilot.adoptedOriginalStoreGame();
    const saveId = await pilot.identity('StoreGame.save');
    await pilot.rememberMethodBody('StoreGame.save');
    await pilot.renameSourceCapability('StoreGame.save', 'saveGame', { retain: saveId });
    await pilot.declarePersistenceDependency('SupabaseStorage');
    await pilot.promise('StoreGame.saveGame', 'Save the snapshot to the configured Supabase database.');
    await pilot.updateThroughPublicRecipe();
    pilot.expectIdentity('StoreGame.saveGame', saveId);
    await pilot.expectMethodBodyKept('StoreGame.saveGame');
    pilot.expectNativeSourceContains('localStorage.setItem');
    pilot.expectDeclaredDependency('StoreGame', 'SupabaseStorage');
    pilot.expectUnverifiedPromise('Save the snapshot to the configured Supabase database.');
    await pilot.generatePersistenceVerification('The saved snapshot can be read from Supabase.');
    pilot.expectObligation('verification-required', 'The saved snapshot can be read from Supabase.');
    await pilot.runGeneratedVerification();
    pilot.expectVerificationFailure('The saved snapshot can be read from Supabase.');
    pilot.expectNoRemotePersistenceClaim();
  }, 600_000);

  it('moves the source declaration without guessing a new adopted native placement', async () => {
    const pilot = await StoreGamePilot.adoptedDistributedStoreGame();
    const id = await pilot.identity('StoreGame');
    await pilot.rememberFiles(['src/models.ts', 'src/game.ts', 'launcher.ts']);
    await pilot.moveSourceDeclaration('StoreGame', 'game/store.expec', { retain: id });
    await pilot.updateThroughPublicRecipe();
    pilot.expectIdentity('StoreGame', id);
    pilot.expectSourceOrigin('StoreGame', 'game/store.expec');
    await pilot.expectRememberedFilesKept();
    await pilot.search('StoreGame');
    pilot.expectDefinition('src/game.ts', 'StoreGame');
  }, 600_000);

  it('moves an output-created native root while keeping its implementation and launcher alias', async () => {
    const pilot = await StoreGamePilot.generatedStoreGame();
    await pilot.implementSave('localStorage.setItem("store-game-save", snapshot);');
    await pilot.addPrivateHelper('assertRunning');
    await pilot.file('launcher.ts', 'import { StoreGame as Game } from "./src/StoreGame.js"; new Game().save("Dune");');
    await pilot.rememberMethodBody('StoreGame.save');
    await pilot.renameRoot('StoreGame', 'Game');
    await pilot.buildThroughInstalledCli();
    await pilot.expectFileAbsent('src/StoreGame.ts');
    await pilot.expectMethodBodyKept('Game.save');
    pilot.expectPrivateHelper('src/Game.ts', 'assertRunning');
    pilot.expectNativeImport('launcher.ts', { imported: 'Game', local: 'Game', from: './src/Game.js' });
    await pilot.checkNativeTypes();
    pilot.expectNativeTypesAccepted();
  }, 600_000);

  it('removes only an unused generated stub and retains handwritten work', async () => {
    const pilot = await StoreGamePilot.adoptedOriginalStoreGame();
    await pilot.addCapability('StoreGame', 'archive', [], 'Nothing');
    await pilot.updateThroughPublicRecipe();
    pilot.expectThrowingStub('StoreGame.archive', 'Not implemented: StoreGame.archive');
    await pilot.retireSourceCapability('StoreGame.archive');
    await pilot.updateThroughPublicRecipe();
    pilot.expectNativeMethodAbsent('StoreGame.archive');
    pilot.expectNativeSourceContains('private assertRunning');
    await pilot.expectOriginalSavingBodyKept();
  }, 600_000);

  it('refuses to retire implemented saving while preserving the prior confirmed identity', async () => {
    const pilot = await StoreGamePilot.adoptedDistributedStoreGame();
    const saveId = await pilot.identity('StoreGame.save');
    await pilot.rememberAllProjectAndBaselineBytes();
    await pilot.retireSourceCapability('StoreGame.save');
    await pilot.updateThroughPublicRecipe();
    pilot.expectProblem('handwritten-removal');
    await pilot.expectProjectAndBaselineBytesKept();
    pilot.expectConfirmedIdentity('StoreGame.save', saveId);
    await pilot.search('StoreGame.save');
    pilot.expectProjectOnlyIncoming('launcher.ts', 'save');
  }, 600_000);

  it('reads a later handwritten change and rebuilds unchanged input without further edits', async () => {
    const pilot = await StoreGamePilot.adoptedDistributedStoreGame();
    await pilot.addHandwrittenSaveComment('Keep the local offline fallback.');
    await pilot.read('StoreGame');
    pilot.expectReadContains(['Keep the local offline fallback.', 'localStorage.setItem']);
    await pilot.updateThroughPublicRecipe();
    await pilot.rememberAllProjectAndBaselineBytes();
    await pilot.reopenRecipeInNewProcess();
    await pilot.updateThroughPublicRecipe();
    pilot.expectUnchanged();
    await pilot.expectProjectAndBaselineBytesKept();
  }, 600_000);
});
