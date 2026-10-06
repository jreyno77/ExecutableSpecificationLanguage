import { afterAll, beforeAll, describe, it } from 'vitest';
import { PackageDriver } from '../../driver/package/installed-package.js';
import { ShoppingPilot } from '../../dsl/cli/shopping-pilot.js';
import { DocumentationPilot } from '../../dsl/cli/documentation-pilot.js';
import { StoreGamePilot } from '../../dsl/cli/store-game-pilot.js';

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
});
