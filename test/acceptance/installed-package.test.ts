import { afterAll, beforeAll, describe, it } from 'vitest';
import { PackageExamples } from '../dsl/installed-package.js';

beforeAll(() => PackageExamples.prepare());
afterAll(() => PackageExamples.finish());

describe('Installed package consumers', () => {
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

  it('applies a guarded file change through the installed public writer', async () => {
    const consumer = new PackageExamples();
    await consumer.installCurrentPackage();
    await consumer.changeProjectFile('original book', 'updated book');

    consumer.expectInstalledPackageUsed();
    consumer.expectProjectFileChanged('original book', 'updated book');
  });

  it('detects an undeclared runtime dependency in a packed artifact', async () => {
    const consumer = new PackageExamples();
    await consumer.installPackageWithoutDependency('langium');
    await consumer.runPublicApiCheck();
    consumer.expectConsumerFailedFor('langium');
  });
});
