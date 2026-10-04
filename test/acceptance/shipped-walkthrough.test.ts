import { afterAll, beforeAll, it } from 'vitest';
import { PackageDriver } from '../driver/installed-package.js';
import { ShippedWalkthrough } from '../dsl/shipped-walkthrough.js';

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
