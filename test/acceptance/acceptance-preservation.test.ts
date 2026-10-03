import { describe, it } from 'vitest';
import { AcceptanceGenerationExamples } from '../dsl/acceptance-generation.js';

describe('existing test layers remain deliberate project code', () => {
  it('creates one configured DSL and driver pair and repeats without churn', async () => {
    const project = await AcceptanceGenerationExamples.shoppingContract();
    await project.file('tests/manual.test.ts', 'import { it, expect } from "vitest"; it("manual", () => expect(8).toBe(8));');
    await project.generate({ testRoot: 'tests', domain: 'shopping' });
    project.expectWriteStatus('applied');
    await project.rememberFiles(); await project.generate({ testRoot: 'tests', domain: 'shopping' });
    project.expectWriteStatus('unchanged'); await project.expectAllBytesUnchanged();
  });

  it('retains mapped current driver bodies and scaffolds only the missing observation', async () => {
    const project = await AcceptanceGenerationExamples.fromSource(`examples {
      setup bookIsAvailable(title: Text) returns Nothing
      setup startWithEmptyBasket() returns Nothing
      action addBook(title: Text) returns Nothing
    }`);
    await project.capturePinnedNativeDeclarations();
    await project.file('test/driver/basket.ts', `export class BasketDriver {
      private readonly titles = new Set<string>();
      bookIsAvailable(title: string): void { this.titles.add(title); }
      startWithEmptyBasket(): void { /* Keep the established catalog. */ }
      addBook(title: string): void { /* Keep handwritten runtime work. */ if (!this.titles.has(title)) throw Error('Unknown book'); }
    }`);
    project.mapDriverClass('test/driver/basket.ts', 'BasketDriver');
    project.mapDriverMethods(['bookIsAvailable', 'startWithEmptyBasket', 'addBook']);
    await project.rememberDriverBody('addBook');
    await project.generate({ domain: 'shopping', adoptExisting: true });
    project.expectWriteStatus('applied'); await project.expectDriverBodyUnchanged('addBook');
    project.reviseToShoppingContract(); await project.update();
    project.expectWriteStatus('applied'); await project.expectDriverBodyUnchanged('addBook');
    await project.expectDriverSignature('bookQuantity', ['title: string'], 'Promise<number>');
    project.expectObligation('implementation-required', 'bookQuantity');
  }, 60_000);

  it('retains handwritten bodies when an established operation is renamed', async () => {
    const project = await AcceptanceGenerationExamples.generatedShoppingWithRealDriver();
    await project.rememberDriverBody('addBook'); project.renameOperation('addBook', 'putBook');
    await project.update(); project.expectWriteStatus('applied');
    await project.expectAcceptanceCall('shopping.putBook("Dune")'); await project.expectDriverBodyUnchanged('putBook');
    await project.runGeneratedVitest(); project.expectTestsPassed(['a shopper can add an available book']);
  }, 60_000);

  it('reports a handwritten generated-check edit before replacing its assertion', async () => {
    const project = await AcceptanceGenerationExamples.generatedShoppingWithRealDriver();
    await project.addHandwrittenCheckLogic('expectBookQuantity', 'console.log("keep reasoning");');
    project.changeExpectedCheckOperator('expectBookQuantity', '>=');
    await project.rememberFiles(); await project.update();
    project.expectMappingProblem('handwritten-check-conflict'); await project.expectAllBytesUnchanged();
  }, 60_000);

  it('retains unused handwritten driver work after retiring a scenario', async () => {
    const project = await AcceptanceGenerationExamples.generatedShoppingWithRealDriver();
    await project.rememberDriverBody('addBook'); project.retireScenario('a shopper can add an available book');
    await project.update(); project.expectWriteStatus('applied');
    await project.expectNoGeneratedScenario('a shopper can add an available book'); await project.expectDriverBodyUnchanged('addBook');
  }, 60_000);

  it('refuses missing current driver members during first adoption', async () => {
    const project = await AcceptanceGenerationExamples.shoppingContract();
    await project.capturePinnedNativeDeclarations();
    await project.file('test/driver/basket.ts', `export class BasketDriver {
      bookIsAvailable(title: string): void {}
      startWithEmptyBasket(): void {}
      addBook(title: string): void {}
    }`);
    project.mapDriverClass('test/driver/basket.ts', 'BasketDriver');
    project.mapDriverMethods(['bookIsAvailable', 'startWithEmptyBasket', 'addBook']);
    await project.rememberFiles(); await project.generate({ domain: 'shopping', adoptExisting: true });
    project.expectMappingProblem('adoption-contract-mismatch'); await project.expectAllBytesUnchanged();
  }, 60_000);
});
