import { describe, it } from 'vitest';
import { AcceptanceGenerationExamples } from '../../../dsl/project/typescript/acceptance-generation.js';
import { OutputsExample } from '../../../dsl/project/output/outputs.js';

describe('acceptance generation composes with current application and output boundaries', () => {
  it('reads the completed application synchronization before locating an operation', async () => {
    const project = await AcceptanceGenerationExamples.shoppingContract();
    await project.captureOldApplication(); await project.connectRealBasketDriver();
    await project.generate({ domain: 'shopping' }); project.expectWriteStatus('applied');
    await project.expectDriverSignature('bookQuantity', ['title: string'], 'number');
    await project.expectOneDriverMethod('bookQuantity');
    await project.runGeneratedVitest(); project.expectTestsPassed(['a shopper can add an available book']);
  }, 60_000);
  it('keeps a mapped application function owned by its original output', async () => {
    const project = await AcceptanceGenerationExamples.fromSource('function multiply(a: Number, b: Number) returns Number\nexamples { example "eight squared": multiply(8, 8) => 64 }');
    await project.mapApplicationFunction('multiply', 'math.ts', 'multiply');
    await project.file('math.ts', 'export function multiply(a: number, b: number) { return a * b; }'); await project.rememberFile('math.ts');
    await project.generate({ domain: 'arithmetic' }); project.expectApplicationAssociation('multiply', 'typescript');
    project.expectNoAcceptanceOwnershipOf('math.ts'); await project.expectRememberedFileUnchanged();
    await project.runGeneratedVitest(); project.expectTestsPassed(['eight squared']);
  }, 60_000);
  it('accepts handwritten implementation and observes its actual result without changing the test', async () => {
    const project = await AcceptanceGenerationExamples.generatedShoppingWithRealDriver();
    await project.rememberFile('test/acceptance/shopping.test.ts');
    await project.readScenario('a shopper can add an available book'); project.expectReadComplete();
    await project.searchScenario('a shopper can add an available book'); project.expectCompleteSearch();
    await project.runGeneratedVitest(); project.expectTestsPassed(['a shopper can add an available book']);
    await project.disableApplicationAddBook();
    await project.readScenario('a shopper can add an available book'); project.expectReadComplete();
    await project.searchScenario('a shopper can add an available book'); project.expectCompleteSearch();
    await project.runGeneratedVitest(); project.expectAssertionFailure({ expected: 1, actual: 0 });
    await project.expectRememberedFileUnchanged();
  }, 60_000);
  it('rejects malformed obligations from an output adapter before writing', async () => {
    const project = await OutputsExample.connect(); await project.specify('concept Store {}');
    await project.registerAdapterReturningMalformedObligation(); await project.tryCreate();
    project.expectContractError(TypeError); project.expectWriterWasNotInvoked(); await project.expectNoFile('untrusted.txt');
  });
});
