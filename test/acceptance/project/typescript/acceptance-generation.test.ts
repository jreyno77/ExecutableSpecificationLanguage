import { describe, it } from 'vitest';
import { AcceptanceGenerationExamples } from '../../../dsl/project/typescript/acceptance-generation.js';

describe('generated tests explain the promised behavior', () => {
  it('keeps Dune and the authored expected quantity visible through domain operations', async () => {
    const project = await AcceptanceGenerationExamples.shoppingContract();
    await project.generate({ testRoot: 'test', domain: 'shopping' });
    await project.expectAcceptanceSteps([
      'await shopping.bookIsAvailable("Dune")', 'await shopping.startWithEmptyBasket()',
      'await shopping.addBook("Dune")', 'await shopping.expectBookQuantity("Dune", 1)',
    ]);
    await project.expectNoAcceptanceMechanics(['querySelector', 'localStorage', 'fetch', 'expect(']);
    await project.expectGeneratedCheck('expectBookQuantity', { observes: 'bookQuantity', expectedParameter: 'expected' });
  });
  it('passes for the actual basket and fails for the same application returning zero', async () => {
    const project = await AcceptanceGenerationExamples.shoppingContract();
    await project.connectRealBasketDriver();
    await project.generate({ domain: 'shopping' });
    await project.runGeneratedVitest();
    project.expectTestsPassed(['a shopper can add an available book']);
    await project.changeBasketObservationTo(0);
    await project.runGeneratedVitest();
    project.expectAssertionFailure({ expected: 1, actual: 0 });
  }, 60_000);
  it('fails when the application action becomes a no-op despite its invocation', async () => {
    const project = await AcceptanceGenerationExamples.shoppingContract();
    await project.connectRealBasketDriver();
    await project.generate({ domain: 'shopping' });
    await project.disableApplicationAddBook();
    await project.runGeneratedVitest();
    project.expectAssertionFailure({ expected: 1, actual: 0 });
  }, 60_000);
  it('compares actual multiply output with authored64 rather than computing an oracle', async () => {
    const project = await AcceptanceGenerationExamples.fromSource('function multiply(a: Number, b: Number) returns Number\nexamples { example "eight squared": multiply(8, 8) => 64 }');
    await project.mapApplicationFunction('multiply', 'math.ts', 'multiply');
    await project.file('math.ts', 'export function multiply(a: number, b: number) { return a * b; }');
    await project.generate({ domain: 'arithmetic' });
    await project.expectVisibleExampleValues([8, 8], 64);
    await project.runGeneratedVitest(); project.expectTestsPassed(['eight squared']);
    await project.file('math.ts', 'export function multiply() { return 63; }');
    await project.runGeneratedVitest(); project.expectAssertionFailure({ expected: 64, actual: 63 });
  }, 60_000);
  it('keeps prose without a real observation explicitly nonpassing', async () => {
    const project = await AcceptanceGenerationExamples.fromSource('function save() returns Nothing\nexamples { example "restart survives": save() => satisfies "The saved game survives restart" }');
    await project.mapApplicationFunction('save', 'game.ts', 'save');
    await project.file('game.ts', 'export function save() {}');
    await project.generate({ domain: 'game' });
    project.expectObligation('verification-required', 'The saved game survives restart');
    await project.runGeneratedVitest();
    project.expectVerificationFailure('The saved game survives restart');
    project.expectNoSkippedOrTodoTests();
  }, 60_000);
});
describe('mapping remains explicit', () => {
  it('gives repeated anonymous groups explicit readable filenames without guessing identities', async () => {
    const project = await AcceptanceGenerationExamples.fromSource('examples { example "one": 1 => 1 }\nexamples { example "two": 2 => 2 }');
    project.establishGroupIdentities(['first-group', 'second-group']);
    await project.generate({ domain: 'numbers' }); project.expectMappingProblem('ambiguous-group-name');
    await project.generate({ domain: 'numbers', names: [{ id: 'first-group', name: 'one-number' }, { id: 'second-group', name: 'two-numbers' }] });
    project.expectAcceptanceFiles(['test/acceptance/one-number.test.ts', 'test/acceptance/two-numbers.test.ts']);
    await project.runGeneratedVitest(); project.expectTestsPassed(['one', 'two']);
  }, 60_000);
  it('maps same-named operations by durable scope identity', async () => {
    const project = await AcceptanceGenerationExamples.fromSource(`examples { observation quantity() returns Number\nexample "books": quantity() => 1 }\nexamples { observation quantity() returns Number\nexample "boxes": quantity() => 2 }`);
    project.establishGroupIdentities(['books-group', 'boxes-group']); project.establishOperationIdentities(['book-quantity', 'box-quantity']);
    await project.generate({ domain: 'inventory', names: [
      { id: 'books-group', name: 'books' }, { id: 'boxes-group', name: 'boxes' },
      { id: 'book-quantity', name: 'bookQuantity' }, { id: 'box-quantity', name: 'boxQuantity' },
    ] });
    await project.replaceDriverStub('bookQuantity', 'return 1;'); await project.replaceDriverStub('boxQuantity', 'return 2;');
    await project.runGeneratedVitest(); project.expectTestsPassed(['books', 'boxes']); project.expectDistinctOperationTargets('book-quantity', 'box-quantity');
  }, 60_000);
});
describe('the generated DSL retains checked data and execution order', () => {
  it('passes captured action results to the later actual observation', async () => {
    const project = await AcceptanceGenerationExamples.fromSource('type Basket { id: Text }\nexamples { setup open() returns Basket\naction add(basket: Basket, title: Text) returns Nothing\nobservation quantity(basket: Basket) returns Number\nscenario "one basket" { given basket = open()\nwhen add(basket, "Dune")\nthen quantity(basket) == 1 } }');
    await project.connectBasketIdentityDriver(); await project.generate({ domain: 'shopping' });
    await project.runGeneratedVitest(); project.expectTestsPassed(['one basket']); await project.expectActualDriverUsedSameBasket();
  }, 60_000);
  it('awaits actual asynchronous setup and actions in source order', async () => {
    const project = await AcceptanceGenerationExamples.shoppingContract();
    await project.connectAsynchronousBasketDriver(); await project.generate({ domain: 'shopping' });
    await project.runGeneratedVitest(); await project.expectActualApplicationOrder(['available', 'empty', 'add', 'quantity']);
    project.expectTestsPassed(['a shopper can add an available book']);
  }, 60_000);
  it('compares independently allocated nested records and lists structurally', async () => {
    const project = await AcceptanceGenerationExamples.nestedBasketContract({ title: 'Dune', quantity: 1 });
    await project.connectNestedBasketDriver({ title: 'Dune', quantity: 1 }); await project.generate({ domain: 'shopping' });
    await project.runGeneratedVitest(); project.expectTestsPassed(['basket contents']);
    await project.connectNestedBasketDriver({ title: 'Dune', quantity: 0 });
    await project.runGeneratedVitest(); project.expectTestsFailed(['basket contents']);
  }, 60_000);
  it('keeps equality structural when nested in a Boolean assertion', async () => {
    const project = await AcceptanceGenerationExamples.structuralBooleanContract();
    await project.connectEquivalentIndependentRecords(); await project.generate({ domain: 'records' });
    await project.runGeneratedVitest(); project.expectTestsPassed(['equivalent records and flag']);
    await project.changeObservedFlag(false); await project.runGeneratedVitest(); project.expectTestsFailed(['equivalent records and flag']);
  }, 60_000);
  it('does not evaluate the right-hand observation after a true or-condition', async () => {
    const project = await AcceptanceGenerationExamples.shortCircuitContract('true or dangerous()');
    await project.connectDangerousObservationThatThrows(); await project.generate({ domain: 'conditions' });
    await project.runGeneratedVitest(); project.expectTestsPassed(['short circuit']); project.expectDangerousObservationNotInvoked();
  }, 60_000);
  it('generates the checked let/do/return composition without inventing behavior', async () => {
    const project = await AcceptanceGenerationExamples.fromSource('function normalize(title: Text) returns Text\nfunction persist(title: Text) returns Nothing\nexamples { action save(title: Text) returns Text { let normalized = normalize(title)\ndo persist(normalized)\nreturn normalized }\nscenario "normalized title" { when saved = save("Dune")\nthen saved == "DUNE" } }');
    await project.connectTitleApplication(); await project.generate({ domain: 'books' });
    await project.runGeneratedVitest(); project.expectTestsPassed(['normalized title']); await project.expectActuallyPersisted('DUNE');
  }, 60_000);
  it('creates independent mutable fixture data for each test', async () => {
    const project = await AcceptanceGenerationExamples.sharedDataFixtureContract();
    await project.connectDriverThatMutatesItsInput(); await project.generate({ domain: 'books' });
    await project.runGeneratedVitestConcurrently();
    project.expectTestsPassed(['first starts empty', 'second starts empty']); await project.expectIndependentDriverInstances();
  }, 60_000);
  it('retains ordered literal arguments and does not expand omitted fixture fields', async () => {
    const project = await AcceptanceGenerationExamples.explicitOptionalDataContract();
    await project.connectDriverObservingActualOwnKeys(); await project.generate({ domain: 'books' });
    await project.runGeneratedVitest(); await project.expectActualInputKeys(['title']); project.expectTestsPassed(['optional remains absent']);
  }, 60_000);
});
