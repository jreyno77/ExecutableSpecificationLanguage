import { describe, it } from 'vitest';
import { ExecutionExamples } from '../dsl/scenario-execution.js';

describe('readable scenarios reach a real application', { timeout: 90_000 }, () => {
  it('observes a real Dune basket through generated domain operations', async () => {
    const project = await ExecutionExamples.shoppingProject();
    await project.connectHttpShopFixture();
    await project.generateAcceptance();
    await project.runNativeVitest();
    project.expectPassed('a shopper can add an available book');
    project.expectActualBasketQuantity('Dune', 1);
    project.expectAllAcquiredServersClosed();
    await project.expectReadableShoppingSteps();
  });

  it('fails the same generated scenario when the real add endpoint is a no-op', async () => {
    const project = await ExecutionExamples.shoppingProject();
    await project.connectHttpShopFixture({ addBook: 'no-op' });
    await project.generateAcceptance(); await project.runNativeVitest();
    project.expectFailed('a shopper can add an available book', { expected: 1, actual: 0 });
    project.expectActualBasketQuantity('Dune', 0); project.expectAllAcquiredServersClosed();
  });

  it('passes the actual returned receipt into the later observation', async () => {
    const project = await ExecutionExamples.fromSource(`examples {
  action purchase(title: Text) returns Text
  observation receiptTitle(receipt: Text) returns Text
  scenario "receipt belongs to the purchase" {
    when receipt = purchase("Dune")
    then receiptTitle(receipt) == "Dune"
  }
}`);
    await project.connectHttpReceipts({ nextReceipt: 'r-42' });
    await project.generateAcceptance(); await project.runNativeVitest();
    project.expectActualReceiptRead('r-42'); project.expectPassed('receipt belongs to the purchase');
    await project.changeNextActualReceipt('r-99'); await project.runNativeVitest();
    project.expectActualReceiptRead('r-99'); project.expectPassed('receipt belongs to the purchase');
  });

  it('awaits slow actual startup and actions before asking for their results', async () => {
    const project = await ExecutionExamples.shoppingProject();
    await project.connectHttpShopFixture({ asynchronousStartup: true, asynchronousAdd: true });
    await project.generateAcceptance(); await project.runNativeVitest();
    project.expectPassed('a shopper can add an available book');
    project.expectActualApplicationOrder(['started', 'available', 'empty', 'added', 'observed', 'closed']);
  });
});

describe('native lifecycle keeps failures and isolation visible', { timeout: 90_000 }, () => {
  it('starts each sequential scenario with its own empty basket in either order', async () => {
    const project = await ExecutionExamples.emptyAndAddingScenarios();
    await project.connectHttpShopFixture(); await project.generateAcceptance();
    await project.runNativeVitest({ order: ['empty basket', 'add one book'] });
    project.expectPassedScenarios(['empty basket', 'add one book']);
    await project.runNativeVitest({ order: ['add one book', 'empty basket'] });
    project.expectPassedScenarios(['add one book', 'empty basket']);
    project.expectIndependentApplicationResources(); project.expectAllAcquiredServersClosed();
  });

  it('keeps concurrent scenarios independent without changing their domain bodies', async () => {
    const project = await ExecutionExamples.emptyAndAddingScenarios();
    await project.connectHttpShopFixture(); await project.generateAcceptance();
    await project.runNativeVitest({ concurrent: true });
    project.expectPassedScenarios(['empty basket', 'add one book']);
    project.expectIndependentApplicationResources(); project.expectAllAcquiredServersClosed();
  });

  it('releases an acquired server when later fixture setup fails', async () => {
    const project = await ExecutionExamples.shoppingProject();
    await project.connectHttpShopFixture({ afterStartFailure: 'Cannot prepare catalog' });
    await project.generateAcceptance(); await project.runNativeVitest();
    project.expectSetupFailure('Cannot prepare catalog'); project.expectNoDomainActions();
    project.expectAllAcquiredServersClosed();
  });

  it('reports cleanup failure even when the domain expectation passed', async () => {
    const project = await ExecutionExamples.shoppingProject();
    await project.connectHttpShopFixture({ closeFailure: 'Catalog cleanup failed' });
    await project.generateAcceptance(); await project.runNativeVitest();
    project.expectActualBasketQuantity('Dune', 1);
    project.expectNativeFailureContaining('Catalog cleanup failed'); project.expectNoPassingRunClaim();
  });

  it('retains both failed domain preparation and cleanup evidence', async () => {
    const project = await ExecutionExamples.shoppingProject();
    await project.connectHttpShopFixture({ afterStartFailure: 'Cannot prepare catalog', closeFailure: 'Catalog cleanup failed' });
    await project.generateAcceptance(); await project.runNativeVitest();
    project.expectSetupFailure('Cannot prepare catalog'); project.expectNativeFailureContaining('Catalog cleanup failed');
    project.expectNoDomainActions(); project.expectAllAcquiredServersClosed();
  });

  it('retains both the wrong quantity and a cleanup error in the native result', async () => {
    const project = await ExecutionExamples.shoppingProject();
    await project.connectHttpShopFixture({ addBook: 'no-op', closeFailure: 'Catalog cleanup failed' });
    await project.generateAcceptance(); await project.runNativeVitest();
    project.expectFailed('a shopper can add an available book', { expected: 1, actual: 0 });
    project.expectNativeFailureContaining('Catalog cleanup failed'); project.expectNoPassingRunClaim();
  });

  it('keeps a missing driver observation explicitly nonpassing', async () => {
    const project = await ExecutionExamples.shoppingProject();
    await project.connectHttpShopFixture({ quantity: 'unimplemented' });
    await project.generateAcceptance(); await project.runNativeVitest();
    project.expectNativeFailureContaining('Not implemented: shopping.bookQuantity');
    project.expectAllAcquiredServersClosed(); project.expectNoSkippedOrTodoScenarios();
  });

  it('does not retry a wrong observation until the application returns the expected value', async () => {
    const project = await ExecutionExamples.shoppingProject();
    await project.connectHttpShopFixture({ observedQuantities: [0, 1] });
    await project.generateAcceptance(); await project.runNativeVitest();
    project.expectFailed('a shopper can add an available book', { expected: 1, actual: 0 });
    project.expectActualObservationCount(1); project.expectNativeAttemptCount(1);
  });
});

describe('execution remains separate from generation and project editing', { timeout: 90_000 }, () => {
  it('connects an authored HTTP fixture after generating the DSL it imports', async () => {
    const project = await ExecutionExamples.shoppingProject();
    project.expectDefaultDslAndDriverGenerated();
    await project.rememberDefaultFixture();
    await project.connectHttpShopFixture({ requiresConstructorArgument: 'serverUrl' });
    await project.generateAcceptance();
    await project.expectSelectedFixture('test/dsl/http-shopping-test.ts', 'test');
    await project.expectDefaultFixtureUnchanged();
    project.expectDefaultScaffoldsReportedAsUnselected();
    await project.runNativeVitest(); project.expectPassed('a shopper can add an available book');
    project.expectAllAcquiredServersClosed();
  });

  it('does not rewrite a handwritten caller while connecting generated tests', async () => {
    const project = await ExecutionExamples.shoppingProject();
    await project.authorManualCallerOfDefaultFixture(); await project.rememberManualCaller();
    await project.connectHttpShopFixture(); await project.generateAcceptance();
    await project.expectManualCallerUnchanged();
    await project.expectGeneratedTestsImport('test/dsl/http-shopping-test.ts');
    await project.runNativeVitest({ generatedOnly: true }); project.expectPassed('a shopper can add an available book');
  });

  it('refuses fixture selection when a generated test import was manually changed', async () => {
    const project = await ExecutionExamples.shoppingProject();
    await project.authorCompatibleAlternateFixture();
    await project.changeGeneratedFixtureImport('test/dsl/alternate-test.ts');
    await project.connectHttpShopFixture(); await project.rememberProjectBytes();
    await project.generateAcceptance();
    project.expectFixtureImportConflict(); await project.expectProjectBytesUnchanged();
  });

  it('keeps the same explicit fixture selection unchanged on replay', async () => {
    const project = await ExecutionExamples.shoppingProject();
    await project.connectHttpShopFixture(); await project.generateAcceptance();
    await project.rememberProjectBytes(); await project.generateAcceptance();
    project.expectUnchangedReceipt(); await project.expectProjectBytesUnchanged();
  });

  it('does not open the configured fixture during compilation or regeneration', async () => {
    const project = await ExecutionExamples.shoppingProject();
    await project.connectHttpShopFixture(); await project.denyRuntimeStarts();
    await project.generateAcceptance(); await project.regenerateAcceptance();
    await project.expectNoRuntimeStart(); project.expectGeneratedFilesUnchanged();
  });

  it('preserves authored lifecycle and driver code while regenerating a scenario title', async () => {
    const project = await ExecutionExamples.shoppingProject();
    await project.connectHttpShopFixture(); await project.generateAcceptance();
    await project.rememberFixtureAndDriverBytes(); project.renameScenario('a shopper adds Dune');
    await project.regenerateAcceptance(); await project.expectFixtureAndDriverBytesUnchanged();
    await project.runNativeVitest(); project.expectPassed('a shopper adds Dune');
    project.expectAllAcquiredServersClosed();
  });

  it('refuses a missing fixture without claiming an executable connection', async () => {
    const project = await ExecutionExamples.shoppingProject();
    await project.mapMissingNativeFixture(); await project.rememberProjectBytes();
    await project.generateAcceptance(); project.expectLocatedFixtureMappingProblem();
    await project.expectProjectBytesUnchanged(); await project.expectNoRuntimeStart();
  });

});
