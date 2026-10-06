import { afterEach, beforeAll, describe, it } from 'vitest';
import { PythonDelivery } from '../../../dsl/project/python/python-cli.js';

beforeAll(() => PythonDelivery.prepare(), 90_000);
afterEach(() => PythonDelivery.dispose(), 30_000);
const dune = `examples {
  setup bookIsAvailable(title: Text) returns Nothing
  setup startWithEmptyBasket() returns Nothing
  action addBook(title: Text) returns Nothing
  observation bookQuantity(title: Text) returns Number
  check expectBookQuantity(title: Text, expected: Number) {
    let actual = bookQuantity(title)
    assert actual == expected
  }
  scenario "a shopper can add an available book" {
    given bookIsAvailable("Dune")
    given startWithEmptyBasket()
    when addBook("Dune")
    then expectBookQuantity("Dune", 1)
  }
}`;

describe('the Python CLI executes the actual generated scenarios', () => {
  it('builds and executes the Dune scenario without running an unrelated failing test', async () => {
    const p = await PythonDelivery.initialized();
    await p.source(dune); await p.useShoppingOutput(); await p.install(); p.expectInstalled();
    await p.build(); p.expectBuilt(); await p.implementBasket(1); await p.unrelatedFailingTest();
    await p.rememberGeneratedTest(); await p.test();
    await p.expectOnlyScenarioPassed('a shopper can add an available book'); await p.expectGeneratedTestUnchanged();
    await p.removeGeneratedScenarioFile(); await p.test(); p.expectUnavailableScenario();
  }, 900_000);
  it('reuses a project after native execution and an ordinary preexisting bytecode cache', async () => {
    const p = await PythonDelivery.initialized();
    await p.source(dune); await p.useShoppingOutput(); await p.install(); p.expectInstalled();
    await p.build(); p.expectBuilt(); await p.implementBasket(1); await p.cacheCurrentApplication();
    await p.rememberGeneratedTest(); await p.test(); await p.expectOnlyScenarioPassed('a shopper can add an available book');
    await p.captureNativeProject(); p.expectNativeCaptureComplete();
    await p.build(); p.expectBuildUnchanged(); await p.expectGeneratedTestUnchanged();
    await p.test(); await p.expectOnlyScenarioPassed('a shopper can add an available book'); await p.expectGeneratedTestUnchanged();
  }, 900_000);
  it('reports the real two-copy application failure against the authored one-copy expectation', async () => {
    const p = await PythonDelivery.initialized();
    await p.source(dune); await p.useShoppingOutput(); await p.install(); p.expectInstalled();
    await p.build(); p.expectBuilt(); await p.implementBasket(2); await p.rememberGeneratedTest();
    await p.test(); p.expectWrongQuantity(1, 2); await p.expectGeneratedTestUnchanged();
  }, 900_000);
  it('executes changed application source despite a valid-looking stale bytecode cache', async () => {
    const p = await PythonDelivery.initialized();
    await p.source(dune); await p.useShoppingOutput(); await p.install(); p.expectInstalled();
    await p.build(); p.expectBuilt(); await p.implementBasket(1);
    await p.keepOldBytecodeWhileBasketNowAdds(2); p.expectOrdinaryCachedQuantity(1);
    await p.rememberGeneratedTest(); await p.test();
    p.expectWrongQuantity(1, 2); await p.expectGeneratedTestUnchanged();
  }, 900_000);
  it('permits the real application to save runtime data outside its source roots', async () => {
    const p = await PythonDelivery.initialized();
    await p.source(dune); await p.useShoppingOutput(); await p.install(); p.expectInstalled();
    await p.build(); p.expectBuilt(); await p.implementBasket(1); await p.saveQuantityTo('data/basket.json');
    await p.test(); await p.expectOnlyScenarioPassed('a shopper can add an available book');
    await p.expectRuntimeData('data/basket.json', { Dune: 1 });
  }, 900_000);
  it('retains completed native phases when execution changed an executable input', async () => {
    const p = await PythonDelivery.initialized();
    await p.source(dune); await p.useShoppingOutput(); await p.install(); p.expectInstalled();
    await p.build(); p.expectBuilt(); await p.implementBasket(1); await p.changeOwnApplicationSourceAfterAddingBook();
    await p.test(); await p.expectApplicationSourceChanged();
    p.expectProblem('stale-project'); p.expectNativeScenarioPassedButCommandFailed();
  }, 900_000);
  it('fails when actual pytest collection removes the current generated case', async () => {
    const p = await PythonDelivery.initialized();
    await p.source(dune); await p.useShoppingOutput(); await p.install(); p.expectInstalled();
    await p.build(); p.expectBuilt(); await p.implementBasket(1); await p.preventNativeCollection();
    await p.rememberGeneratedTest(); await p.test();
    p.expectNoCaseWasExecuted(); await p.expectGeneratedTestUnchanged();
  }, 900_000);
  it('refuses a current scenario whose confirmed native association is missing', async () => {
    const p = await PythonDelivery.initialized();
    await p.source(dune); await p.useShoppingOutput(); await p.install(); p.expectInstalled();
    await p.build(); p.expectBuilt(); await p.implementBasket(1);
    await p.forgetScenarioAssociation('a shopper can add an available book');
    await p.test(); p.expectProblem('generated-tests-not-executed'); p.expectNoNativeExecution();
  }, 900_000);
  it('does not overlook an executed root conftest outside the declared source roots', async () => {
    const p = await PythonDelivery.initialized();
    await p.source(dune); await p.useShoppingOutput(); await p.install(); p.expectInstalled();
    await p.build(); p.expectBuilt(); await p.implementBasket(1); await p.rootFixtureChangesItself();
    await p.test(); await p.expectRootFixtureChanged();
    p.expectProblem('stale-project'); p.expectNativeScenarioPassedButCommandFailed();
  }, 900_000);
});
