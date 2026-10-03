import { afterAll, beforeAll, describe, it } from 'vitest';
import { PackageExamples } from '../dsl/installed-package.js';

beforeAll(() => PackageExamples.prepare());
afterAll(() => PackageExamples.finish());

describe('Installed package consumers', () => {
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

  it('detects an undeclared runtime dependency in a packed artifact', async () => {
    const consumer = new PackageExamples();
    await consumer.installPackageWithoutDependency('langium');
    await consumer.runPublicApiCheck();
    consumer.expectConsumerFailedFor('langium');
  });
});
