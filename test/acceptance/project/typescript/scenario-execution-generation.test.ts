import { describe, it } from 'vitest';
import { ExecutionExamples } from '../../../dsl/project/typescript/scenario-execution.js';

describe('execution remains separate from generation and project editing', { timeout: 90_000 }, () => {
  it('connects an authored HTTP fixture after generating the DSL it imports', async () => {
    const project = await ExecutionExamples.shoppingProject();
    project.expectDefaultDslAndDriverGenerated();
    await project.rememberDefaultFixture();
    await project.connectHttpShopFixture({ requiresConstructorArgument: 'serverUrl' });
    await project.generateAcceptance();
    await project.expectSelectedFixture('test/dsl/http-shopping-test.ts', 'test');
    await project.expectDefaultFixtureUnchanged();
    project.expectDefaultScaffoldsReportedAsUnselected();
    await project.runNativeVitest(); project.expectPassed('a shopper can add an available book');
    project.expectAllAcquiredServersClosed();
  });

  it('does not rewrite a handwritten caller while connecting generated tests', async () => {
    const project = await ExecutionExamples.shoppingProject();
    await project.authorManualCallerOfDefaultFixture(); await project.rememberManualCaller();
    await project.connectHttpShopFixture(); await project.generateAcceptance();
    await project.expectManualCallerUnchanged();
    await project.expectGeneratedTestsImport('test/dsl/http-shopping-test.ts');
    await project.runNativeVitest({ generatedOnly: true }); project.expectPassed('a shopper can add an available book');
  });

  it('refuses fixture selection when a generated test import was manually changed', async () => {
    const project = await ExecutionExamples.shoppingProject();
    await project.authorCompatibleAlternateFixture();
    await project.changeGeneratedFixtureImport('test/dsl/alternate-test.ts');
    await project.connectHttpShopFixture(); await project.rememberProjectBytes();
    await project.generateAcceptance();
    project.expectFixtureImportConflict(); await project.expectProjectBytesUnchanged();
  });

  it('keeps the same explicit fixture selection unchanged on replay', async () => {
    const project = await ExecutionExamples.shoppingProject();
    await project.connectHttpShopFixture(); await project.generateAcceptance();
    await project.rememberProjectBytes(); await project.generateAcceptance();
    project.expectUnchangedReceipt(); await project.expectProjectBytesUnchanged();
  });

  it('does not open the configured fixture during compilation or regeneration', async () => {
    const project = await ExecutionExamples.shoppingProject();
    await project.connectHttpShopFixture(); await project.denyRuntimeStarts();
    await project.generateAcceptance(); await project.regenerateAcceptance();
    await project.expectNoRuntimeStart(); project.expectGeneratedFilesUnchanged();
  });

  it('preserves authored lifecycle and driver code while regenerating a scenario title', async () => {
    const project = await ExecutionExamples.shoppingProject();
    await project.connectHttpShopFixture(); await project.generateAcceptance();
    await project.rememberFixtureAndDriverBytes(); project.renameScenario('a shopper adds Dune');
    await project.regenerateAcceptance(); await project.expectFixtureAndDriverBytesUnchanged();
    await project.runNativeVitest(); project.expectPassed('a shopper adds Dune');
    project.expectAllAcquiredServersClosed();
  });

  it('refuses a missing fixture without claiming an executable connection', async () => {
    const project = await ExecutionExamples.shoppingProject();
    await project.mapMissingNativeFixture(); await project.rememberProjectBytes();
    await project.generateAcceptance(); project.expectLocatedFixtureMappingProblem();
    await project.expectProjectBytesUnchanged(); await project.expectNoRuntimeStart();
  });

});
