import { describe, it } from 'vitest';
import { AcceptanceGenerationExamples } from '../dsl/acceptance-generation.js';

describe('generation reports facts without claiming execution', () => {
  it('keeps provider operations external unless explicit workspace ownership permits output', async () => {
    const project = await AcceptanceGenerationExamples.importedOperationContract();
    await project.file('application.ts', 'export function availableCopies(): number { return 1; }');
    await project.mapApplicationFunction('availableCopies', 'application.ts', 'availableCopies');
    await project.generate({ domain: 'shopping' }); project.expectNoVendoredProviderDeclarations();
    await project.runGeneratedVitest(); project.expectTestsPassed(['imported actual result']);
  }, 60_000);
  it('retains planned obligations when a real partial write stops', async () => {
    const project = await AcceptanceGenerationExamples.shoppingContract();
    project.failRealWriteTo('test/driver/shopping.ts'); await project.generate({ domain: 'shopping' });
    await project.expectStoppedWithPartialFiles(); project.expectObligation('implementation-required', 'bookQuantity');
  });
  it('reassesses a replaced stub without claiming its new implementation is correct', async () => {
    const project = await AcceptanceGenerationExamples.shoppingContract();
    await project.capturePinnedNativeDeclarations();
    await project.generate({ domain: 'shopping' }); await project.implementActualBasketRuntimeExcept('bookQuantity');
    project.expectObligation('implementation-required', 'bookQuantity'); await project.runGeneratedVitest();
    project.expectThrownMessage('Not implemented: shopping.bookQuantity');
    await project.replaceDriverStub('bookQuantity', 'return 0;'); project.reviseToShoppingContract(); await project.update();
    project.expectNoImplementationObligation('bookQuantity');
    await project.runGeneratedVitest(); project.expectAssertionFailure({ expected: 1, actual: 0 });
  }, 60_000);
  it('keeps a bodyless named check as a failing implementation obligation', async () => {
    const project = await AcceptanceGenerationExamples.fromSource(`examples {
      check expectBookQuantity(title: Text, expected: Number)
      action begin() returns Nothing {}
      scenario "check needs implementation" { when begin()
      then expectBookQuantity("Dune", 1) }
    }`);
    await project.generate({ domain: 'shopping' }); project.expectObligation('implementation-required', 'expectBookQuantity');
    await project.runGeneratedVitest(); project.expectThrownMessage('Not implemented: shopping.expectBookQuantity');
    project.expectNoSkippedOrTodoTests();
  }, 60_000);
  it('rejects unsupported numeric literals rather than changing the expected value', async () => {
    const project = await AcceptanceGenerationExamples.fromSource('examples { example "exact literal": 9007199254740993 => 9007199254740993 }');
    await project.rememberFiles(); await project.generate({ domain: 'numbers' });
    project.expectMappingProblem('unsupported-number-literal'); await project.expectAllBytesUnchanged();
  });
  it('plans without installing or invoking the application, driver or runner', async () => {
    const project = await AcceptanceGenerationExamples.shoppingContract();
    project.denyProcessNetworkAndRuntimeCalls(); await project.generate({ domain: 'shopping' });
    project.expectWriteStatus('applied'); project.expectNoForbiddenEffects();
  });
  it('refuses a same-named unassociated handwritten driver', async () => {
    const project = await AcceptanceGenerationExamples.shoppingContract();
    await project.file('test/driver/shopping.ts', 'export class ShoppingDriver { addBook() { throw Error("keep my work"); } }');
    await project.rememberFiles(); await project.generate({ domain: 'shopping' });
    project.expectMappingProblem('unowned-project-artifact'); await project.expectAllBytesUnchanged();
  });
  it('reports an incompatible mapped result instead of wrapping it as a valid observation', async () => {
    const project = await AcceptanceGenerationExamples.shoppingContract(); await project.connectRealBasketDriver();
    await project.file('test/driver/basket.ts', `export class BasketDriver {
      bookIsAvailable(title: string): void {}
      startWithEmptyBasket(): void {}
      addBook(title: string): void {}
      bookQuantity(title: string): string { return 'many'; }
    }`);
    await project.rememberFiles(); await project.generate({ domain: 'shopping' });
    project.expectMappingProblem('incompatible-driver'); await project.expectAllBytesUnchanged();
  }, 60_000);
  it('does not retarget established test files after changing domain or root', async () => {
    const project = await AcceptanceGenerationExamples.generatedShoppingWithRealDriver();
    await project.rememberFiles(); await project.generate({ domain: 'purchases', testRoot: 'checks' });
    project.expectMappingProblem('output-options-changed'); await project.expectAllBytesUnchanged();
  }, 60_000);
});
