import { afterAll, beforeAll, expect, it } from 'vitest';
import { PackageDriver } from '../../driver/package/installed-package.js';
import { ShippedWalkthrough } from '../../dsl/package/shipped-walkthrough.js';

beforeAll(() => PackageDriver.prepare(), 240_000);
afterAll(() => PackageDriver.finish());

it('follows the shipped shopping walkthrough from a wrong basket to a real passing scenario', async () => {
  const author = await ShippedWalkthrough.install();
  author.expectDocumentedShoppingFiles();
  await author.copySpecification();
  await author.command(['init', '--root', './game', '--target', 'typescript', '--yes']); author.expectSuccess();
  await author.command(['install']); author.expectSuccess();
  await author.configureDocumentedNativeProject();
  await author.command(['check']); author.expectSuccess();
  await author.command(['build']); author.expectSuccess();
  await author.expectReadableSteps(['bookIsAvailable("Dune")', 'startWithEmptyBasket()', 'addBook("Dune")', 'expectBookQuantity("Dune", 1)']);

  await author.implementBasket('missing-add');
  await author.command(['test']);
  author.expectQuantityFailure('a shopper can add an available book', 1, 0);
  await author.implementBasket('working');
  await author.command(['test']);
  author.expectPassed('a shopper can add an available book');
}, 600_000);

it('locates an undeclared public capability without changing the connected code', async () => {
  const author = await ShippedWalkthrough.install();
  author.expectDocumentedShoppingFiles();
  await author.copySpecification();
  await author.command(['init', '--root', './game', '--target', 'typescript', '--yes']); author.expectSuccess();
  await author.command(['install']); author.expectSuccess();
  await author.configureDocumentedNativeProject();
  await author.command(['build']); author.expectSuccess();
  await author.source('concept StoreGame { public saveGame\ncapability save() returns Nothing }');
  await author.rememberProjectFiles();
  await author.command(['build']);
  await author.expectUnknownDeclaration('saveGame', 'main.expec');
  await author.expectProjectFilesUnchanged();
}, 300_000);

it('declines the installed initialization prompt without creating a project', async () => {
  const author = await ShippedWalkthrough.install();
  author.expectDocumentedShoppingFiles();
  await author.copySpecification();
  await author.withoutPackageRequirements();
  await author.rememberWorkingFiles();
  await author.declineInitialization();
  await author.expectDeclinedWithoutChanges();
}, 90_000);

it('uses a public rename diagnostic to retain a handwritten body and its identity', async () => {
  const author = await ShippedWalkthrough.install();
  await author.copySpecification(); await author.useTypeScriptOutput();
  await author.source('class StoreGame { public save\ncapability save(snapshot: Text) returns Nothing }');
  await author.command(['init', '--root', './game', '--target', 'typescript', '--yes']); author.expectSuccess();
  await author.command(['install']); author.expectSuccess();
  await author.configureDocumentedNativeProject();
  await author.command(['build']); author.expectSuccess();
  await author.implementSave('localStorage.setItem("save", JSON.stringify(snapshot));');

  await author.source('class StoreGame { public saveGame\ncapability saveGame(snapshot: Text) returns Nothing }');
  await author.rememberProjectFiles();
  await author.command(['build']);
  const savedIdentity = author.identityDecision('save', 2);
  await author.expectProjectFilesUnchanged();
  await author.writeCorrespondence(savedIdentity, 2, 1);
  await author.command(['build', '--decisions', './changes.json']); author.expectSuccess();
  await author.expectSaveBody('saveGame', 'localStorage.setItem("save", JSON.stringify(snapshot));');

  await author.source('class StoreGame { public saveAgain\ncapability saveAgain(snapshot: Text) returns Nothing }');
  await author.rememberProjectFiles();
  await author.command(['build']);
  expect(author.identityDecision('saveGame', 2)).toBe(savedIdentity);
  await author.expectProjectFilesUnchanged();
  await author.source('class StoreGame { public saveGame\ncapability saveGame(snapshot: Text) returns Nothing }');
  await author.command(['build']); author.expectUnchangedBuild();
  await author.expectProjectFilesUnchanged();
}, 360_000);

it('builds Markdown and UML from the shipped contracts without claiming execution', async () => {
  const author = await ShippedWalkthrough.install('store-design');
  author.expectDocumentedDesignFiles();
  await author.copySpecification(); await author.createDocumentProject();
  await author.command(['build']); author.expectSuccess();
  await author.expectDocumentedContract('StoreGame', 'save', 'PlayerStateSnapshot', 'Nothing');
}, 120_000);
