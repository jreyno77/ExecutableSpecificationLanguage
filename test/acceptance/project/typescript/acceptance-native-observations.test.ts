import { describe, it } from 'vitest';
import { AcceptanceGenerationExamples } from '../../../dsl/project/typescript/acceptance-generation.js';

describe('native scenario identity and live references', () => {
  it('keeps an arbitrary durable identity inside a valid native marker', async () => {
    const project = await AcceptanceGenerationExamples.fromSource('examples { example "one": 1 => 1 }');
    project.establishScenarioIdentity('scenario*/one'); await project.capturePinnedNativeDeclarations();
    await project.generate({ domain: 'numbers' }); await project.searchScenario('one');
    project.expectCompleteSearch(); project.expectScenarioDefinition('one', 'test/acceptance/numbers.test.ts');
    await project.runGeneratedVitest(); project.expectTestsPassed(['one']);
  }, 60_000);
  it('separates two callbacks that share an acceptance file', async () => {
    const project = await AcceptanceGenerationExamples.fromSource(`examples {
      observation books() returns Number
      observation boxes() returns Number
      example "book count": books() => 1
      example "box count": boxes() => 2
    }`);
    await project.capturePinnedNativeDeclarations(); await project.generate({ domain: 'inventory' });
    await project.searchScenario('book count'); project.expectCompleteSearch();
    project.expectScenarioDefinition('book count', 'test/acceptance/inventory.test.ts');
    project.expectOutgoingOperation('books'); project.expectNoOutgoingOperation('boxes');
    await project.readScenario('book count'); project.expectReadComplete();
    project.expectReadFiles(['test/acceptance/inventory.test.ts', 'test/dsl/inventory.ts', 'test/driver/inventory.ts', 'test/dsl/inventory-test.ts', 'test/dsl/comparison.ts']);
  }, 60_000);
  it('observes a changed native callback instead of replaying its saved dependency list', async () => {
    const project = await AcceptanceGenerationExamples.fromSource(`examples {
      observation books() returns Number
      observation boxes() returns Number
      example "book count": books() => 1
      example "box count": boxes() => 2
    }`);
    await project.capturePinnedNativeDeclarations(); await project.generate({ domain: 'inventory' });
    await project.changeActualScenarioCall('book count', 'books', 'boxes'); await project.searchScenario('book count');
    project.expectOutgoingOperation('boxes'); project.expectNoOutgoingOperation('books');
    await project.expectActualUse('test/acceptance/inventory.test.ts', 'boxes', 'outgoing');
    project.expectSearchProblem('generated-test-drift');
  }, 60_000);
  it('retains a scenario identity when its authored title changes', async () => {
    const project = await AcceptanceGenerationExamples.generatedShoppingWithRealDriver();
    project.rememberScenarioIdentity('a shopper can add an available book');
    project.renameScenario('a shopper can add an available book', 'a shopper adds Dune');
    await project.update(); project.expectWriteStatus('applied'); await project.searchScenario('a shopper adds Dune');
    project.expectScenarioIdentityUnchanged('a shopper adds Dune');
    project.expectScenarioDefinition('a shopper adds Dune', 'test/acceptance/shopping.test.ts'); project.expectCompleteSearch();
    await project.runGeneratedVitest(); project.expectTestsPassed(['a shopper adds Dune']);
  }, 60_000);
  it('does not confuse a same-titled call to an unrelated local test function', async () => {
    const project = await AcceptanceGenerationExamples.generatedShoppingWithRealDriver();
    await project.file('manual.ts', `function test(title: string, body: () => void) { body(); }
      test('a shopper can add an available book', () => {});`);
    await project.searchScenario('a shopper can add an available book'); project.expectCompleteSearch();
    project.expectDefinitionFiles(['test/acceptance/shopping.test.ts']);
  }, 60_000);
  it('reports copied identity markers as ambiguous instead of selecting the first test', async () => {
    const project = await AcceptanceGenerationExamples.generatedShoppingWithRealDriver();
    await project.copyActualScenarioWithMarker('a shopper can add an available book');
    await project.searchScenario('a shopper can add an available book'); project.expectSearchProblem('ambiguous-native-test');
    await project.rememberFiles(); project.renameScenario('a shopper can add an available book', 'add Dune');
    await project.update(); project.expectMappingProblem('ambiguous-native-test'); await project.expectAllBytesUnchanged();
  }, 60_000);
  it('reports an actual project-only consumer through native read and search', async () => {
    const project = await AcceptanceGenerationExamples.generatedShoppingWithRealDriver();
    await project.file('manual.ts', `import { BasketDriver } from './test/driver/basket.js';
      // Keep this manual diagnostic helper.
      export function inspect() { return new BasketDriver().bookQuantity('Dune'); }`);
    await project.searchOperation('bookQuantity'); project.expectCompleteSearch();
    await project.expectActualUse('manual.ts', 'bookQuantity', 'incoming', 'project');
    await project.readScenario('a shopper can add an available book'); project.expectReadComplete();
  }, 60_000);
  it('refuses to certify or rename references with missing Vitest declarations', async () => {
    const project = await AcceptanceGenerationExamples.generatedShoppingWithRealDriver();
    await project.removeActualVitestDeclaration(); await project.searchOperation('addBook'); project.expectIncompleteNativeSearch();
    project.renameOperation('addBook', 'putBook'); await project.rememberFiles(); await project.update();
    project.expectMappingProblem('incomplete-project'); await project.expectAllBytesUnchanged();
  }, 60_000);
  it('does not apply a plan after its handwritten driver changed', async () => {
    const project = await AcceptanceGenerationExamples.generatedShoppingWithRealDriver();
    project.renameOperation('addBook', 'putBook'); await project.prepareUpdate();
    await project.changeBasketObservationTo(0); await project.rememberFiles(); await project.applyPreparedUpdate();
    project.expectStaleWriteStopped(); await project.expectAllBytesUnchanged();
  }, 60_000);
  it('includes a changed generated check in the scenario integrity findings', async () => {
    const project = await AcceptanceGenerationExamples.generatedShoppingWithRealDriver(); await project.emptyGeneratedCheck('expectBookQuantity');
    await project.readScenario('a shopper can add an available book'); await project.expectReadProblemAt('generated-test-drift', 'test/dsl/shopping.ts', '{}');
    await project.searchOperation('expectBookQuantity'); project.expectSearchProblem('generated-test-drift');
  }, 60_000);
});
