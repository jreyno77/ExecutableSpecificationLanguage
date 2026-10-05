import { describe, it } from 'vitest';
import { AcceptanceGenerationExamples } from '../dsl/acceptance-generation.js';

describe('direct removal owns only generated tests', () => {
  it('deletes one generated callback while retaining its sibling and shared layers', async () => {
    const project = await AcceptanceGenerationExamples.fromSource('examples { example "one": 1 => 1\nexample "two": 2 => 2 }');
    await project.capturePinnedNativeDeclarations(); await project.generate({ domain: 'numbers' });
    await project.rememberFile('test/dsl/numbers.ts'); await project.deleteScenario('one');
    project.expectWriteStatus('applied'); project.expectNoConfirmedScenarioAssociation('one'); await project.expectRememberedFileUnchanged();
    await project.runGeneratedVitest(); project.expectTestsPassed(['two']);
    await project.deleteScenario('one'); project.expectWriteStatus('unchanged');
  }, 60_000);
  it('refuses to delete a generated callback containing handwritten work', async () => {
    const project = await AcceptanceGenerationExamples.generatedShoppingWithRealDriver();
    await project.addScenarioComment('a shopper can add an available book', 'Keep my explanation of the shopper action.');
    await project.rememberFiles(); await project.deleteScenario('a shopper can add an available book');
    project.expectMappingProblem('handwritten-removal'); await project.expectAllBytesUnchanged();
  }, 60_000);
  it('deletes an untouched examples file without removing the shared implementation', async () => {
    const project = await AcceptanceGenerationExamples.generatedShoppingWithRealDriver(); await project.rememberFile('test/driver/basket.ts');
    await project.deleteOnlyExamplesGroup(); project.expectWriteStatus('applied');
    await project.expectFileAbsent('test/acceptance/shopping.test.ts'); await project.expectRememberedFileUnchanged();
    project.expectNoConfirmedScenarioAssociation('a shopper can add an available book');
  }, 60_000);
});
