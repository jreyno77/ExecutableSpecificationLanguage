import { describe, it } from 'vitest';
import { ExecutionExamples } from '../dsl/scenario-execution.js';

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
