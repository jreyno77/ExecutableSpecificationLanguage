import { describe, it } from 'vitest';
import { AcceptanceGenerationExamples } from '../../../dsl/project/typescript/acceptance-generation.js';

describe('current generated tests remain inspectable native code', () => {
  it('includes shared implementation context when reading a whole examples group', async () => {
    const project = await AcceptanceGenerationExamples.generatedShoppingWithRealDriver();
    await project.readExamples(); project.expectReadComplete();
    project.expectReadFiles(['test/acceptance/shopping.test.ts', 'test/dsl/shopping.ts', 'test/driver/basket.ts', 'test/dsl/shopping-test.ts', 'test/dsl/comparison.ts']);
  }, 60_000);
  it('reads the actual scenario and shared implementation and follows its direct check', async () => {
    const project = await AcceptanceGenerationExamples.generatedShoppingWithRealDriver();
    await project.readScenario('a shopper can add an available book'); project.expectReadComplete();
    project.expectReadFiles(['test/acceptance/shopping.test.ts', 'test/dsl/shopping.ts', 'test/driver/basket.ts', 'test/dsl/shopping-test.ts', 'test/dsl/comparison.ts']);
    await project.searchScenario('a shopper can add an available book'); project.expectCompleteSearch();
    project.expectOutgoingOperation('expectBookQuantity'); project.expectNoOutgoingOperation('bookQuantity');
    await project.searchOperation('expectBookQuantity'); project.expectCompleteSearch(); project.expectIncomingScenario('a shopper can add an available book');
  }, 60_000);

  it('reports a changed generated expected quantity without accepting the edited assertion', async () => {
    const project = await AcceptanceGenerationExamples.generatedShoppingWithRealDriver();
    await project.editScenarioExpectedQuantity(0); await project.rememberFiles();
    await project.readScenario('a shopper can add an available book'); await project.expectReadProblemAt('generated-test-drift', 'test/acceptance/shopping.test.ts', '0');
    await project.searchScenario('a shopper can add an available book'); project.expectSearchProblem('generated-test-drift');
    project.reviseToShoppingContract(); await project.update(); project.expectMappingProblem('generated-test-drift');
    await project.expectAllBytesUnchanged();
  }, 60_000);

  it('refuses an empty generated callback even when its title and identity comment remain', async () => {
    const project = await AcceptanceGenerationExamples.generatedShoppingWithRealDriver();
    await project.emptyScenarioCallback();
    await project.readScenario('a shopper can add an available book'); await project.expectReadProblemAt('generated-test-drift', 'test/acceptance/shopping.test.ts', '{}');
    await project.searchScenario('a shopper can add an available book'); project.expectSearchProblem('generated-test-drift');
  }, 60_000);

  it('keeps formatting, comments and a supported import alias attached to the same native test', async () => {
    const project = await AcceptanceGenerationExamples.generatedShoppingWithRealDriver();
    await project.aliasAndFormatScenario();
    await project.readScenario('a shopper can add an available book'); project.expectReadComplete();
    await project.searchScenario('a shopper can add an available book'); project.expectCompleteSearch();
    await project.runGeneratedVitest(); project.expectTestsPassed(['a shopper can add an available book']);
  }, 60_000);
  it('refuses a same-spelled import redirected to a different native fixture', async () => {
    const project = await AcceptanceGenerationExamples.generatedShoppingWithRealDriver();
    await project.redirectScenarioFixture();
    await project.readScenario('a shopper can add an available book'); project.expectReadProblem('unsupported-native-test');
    await project.searchScenario('a shopper can add an available book'); project.expectSearchProblem('unsupported-native-test');
  }, 60_000);
});
