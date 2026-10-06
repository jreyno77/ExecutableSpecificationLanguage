import { describe, it } from 'vitest';
import { AcceptanceGenerationExamples } from '../../../dsl/project/typescript/acceptance-generation.js';

describe('existing test layers remain deliberate project code', () => {
  it('calls an explicitly mapped driver member with a different native name', async () => {
    const project = await AcceptanceGenerationExamples.shoppingContract();
    await project.connectRealBasketDriver(); await project.mapDifferentDriverName('bookQuantity', 'copies');
    await project.rememberFile('test/driver/basket.ts'); await project.generate({ domain: 'shopping' });
    project.expectWriteStatus('applied'); await project.expectRememberedFileUnchanged();
    await project.runGeneratedVitest(); project.expectTestsPassed(['a shopper can add an available book']);
    await project.generate({ domain: 'shopping' }); project.expectWriteStatus('unchanged');
  }, 60_000);
  it('requires update when create would change an existing generated assertion', async () => {
    const project = await AcceptanceGenerationExamples.fromSource('examples { example "one": 1 => 1 }');
    await project.capturePinnedNativeDeclarations(); await project.generate({ domain: 'numbers' }); await project.rememberFiles();
    project.revise('examples { example "one": 1 => 2 }'); await project.generate({ domain: 'numbers' });
    project.expectMappingProblem('use-update'); await project.expectAllBytesUnchanged();
  }, 60_000);
  it('rejects insert when the supplied transition changes an existing assertion', async () => {
    const project = await AcceptanceGenerationExamples.fromSource('examples { example "one": 1 => 1 }');
    await project.capturePinnedNativeDeclarations(); await project.generate({ domain: 'numbers' }); await project.rememberFiles();
    project.revise('examples { example "one": 1 => 2 }'); await project.insert();
    project.expectMappingProblem('not-addition-only'); await project.expectAllBytesUnchanged();
  }, 60_000);
  it('does not silently change a retained operation mapping', async () => {
    const project = await AcceptanceGenerationExamples.fromSource('examples { observation count() returns Number }');
    await project.capturePinnedNativeDeclarations(); await project.generate({ domain: 'inventory', names: [{ declaration: ['count'], name: 'bookCount' }] });
    project.revise('examples { observation count() returns Number }');
    await project.rememberFiles(); project.reopen({ names: [{ declaration: ['count'], name: 'boxCount' }] }); await project.update();
    project.expectMappingProblem('native-mapping-conflict'); await project.expectAllBytesUnchanged();
  }, 60_000);
  it('allows a new operation to receive its first explicit native name', async () => {
    const project = await AcceptanceGenerationExamples.fromSource('examples { observation count() returns Number }');
    await project.capturePinnedNativeDeclarations(); await project.generate({ domain: 'inventory' });
    project.revise('examples { observation count() returns Number\nobservation `new count`() returns Number }');
    project.reopen({ names: [{ declaration: ['new count'], name: 'newCount' }] }); await project.update(); project.expectWriteStatus('applied');
    await project.expectDriverSignature('newCount', [], 'Promise<number>'); project.expectObligation('implementation-required', 'new count');
  }, 60_000);
  it('retains an explicitly associated native fixture and its manual code', async () => {
    const project = await AcceptanceGenerationExamples.shoppingContract();
    await project.establishHandwrittenFixtureProject(); await project.rememberFile('test/dsl/existing-test.ts');
    await project.generate({ domain: 'shopping', adoptExisting: true, fixture: {
      outputId: 'acceptance', format: 'typescript-symbol-1', value: {
        file: 'test/dsl/existing-test.ts', declaration: [{ kind: 'variable', name: 'test' }],
      },
    } });
    project.expectWriteStatus('applied'); await project.expectRememberedFileUnchanged();
    project.expectNoAcceptanceOwnershipOf('test/dsl/existing-test.ts');
    await project.runGeneratedVitest(); project.expectTestsPassed(['a shopper can add an available book']);
    await project.readScenario('a shopper can add an available book'); project.expectReadComplete();
    project.expectReadFiles(['test/acceptance/shopping.test.ts', 'test/dsl/shopping.ts', 'test/driver/basket.ts', 'test/dsl/existing-test.ts', 'test/dsl/comparison.ts']);
  }, 60_000);
  it('creates one configured DSL and driver pair and repeats without churn', async () => {
    const project = await AcceptanceGenerationExamples.shoppingContract();
    await project.capturePinnedNativeDeclarations();
    await project.file('tests/manual.test.ts', 'import { it, expect } from "vitest"; it("manual", () => expect(8).toBe(8));');
    await project.generate({ testRoot: 'tests', domain: 'shopping' });
    project.expectWriteStatus('applied');
    await project.rememberFiles(); await project.generate({ testRoot: 'tests', domain: 'shopping' });
    project.expectWriteStatus('unchanged'); await project.expectAllBytesUnchanged();
  }, 60_000);

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
    await project.runGeneratedVitest(); project.expectThrownMessage('Not implemented: shopping.bookQuantity');
  }, 60_000);

  it('retains handwritten bodies when an established operation is renamed', async () => {
    const project = await AcceptanceGenerationExamples.generatedShoppingWithRealDriver();
    await project.rememberDriverBody('addBook'); project.renameOperation('addBook', 'putBook');
    await project.update(); project.expectWriteStatus('applied');
    await project.expectAcceptanceCall('shopping.putBook("Dune")'); await project.expectDriverBodyUnchanged('putBook');
    await project.searchOperation('putBook'); project.expectCompleteSearch(); project.expectIncomingScenario('a shopper can add an available book');
    await project.expectActualUse('test/acceptance/shopping.test.ts', 'putBook', 'incoming');
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
