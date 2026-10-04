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
});
