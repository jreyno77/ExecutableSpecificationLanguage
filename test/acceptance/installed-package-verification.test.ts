import { afterAll, beforeAll, describe, it } from 'vitest';
import { PackageExamples } from '../dsl/installed-package.js';

beforeAll(() => PackageExamples.prepare());
afterAll(() => PackageExamples.finish());

describe('Installed package consumers', () => {
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

  it('detects a missing implementation file in a packed artifact', async () => {
    const consumer = new PackageExamples();
    await consumer.installPackageWithoutFile('dist/compiler.js');
    await consumer.runPublicApiCheck();
    consumer.expectConsumerFailedFor('compiler.js');
  });

  it('detects an undeclared runtime dependency in a packed artifact', async () => {
    const consumer = new PackageExamples();
    await consumer.installPackageWithoutDependency('langium');
    await consumer.runPublicApiCheck();
    consumer.expectConsumerFailedFor('langium');
  });
});
