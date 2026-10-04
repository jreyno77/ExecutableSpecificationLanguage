import { afterAll, beforeAll, describe, it } from 'vitest';
import { PackageDriver } from '../driver/installed-package.js';
import { StoreGamePilot } from '../dsl/store-game-pilot.js';

beforeAll(() => PackageDriver.prepare(), 240_000);
afterAll(() => PackageDriver.finish());

describe('a maintainer evolves real StoreGame code', () => {
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
