import { describe, it } from 'vitest';
import { ExecutionExamples } from '../../../dsl/project/typescript/scenario-execution.js';

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
