import { afterAll, beforeAll, describe, it } from 'vitest';
import { PackageDriver } from '../driver/installed-package.js';
import { ExporterAuthor } from '../dsl/exporter-author.js';
beforeAll(() => PackageDriver.prepare());
afterAll(() => PackageDriver.finish());

describe('an independent output author', { timeout: 180_000 }, () => {
  it('adds an ordinary output module through installed public imports', async () => {
    const extension = await ExporterAuthor.installPackedProduct();
    await extension.writeIndependentSignaturesOutput();
    await extension.compilePublicTypes();
    await extension.source('function save(snapshot: Text) returns Nothing');
    await extension.runCustomLauncher({ contracts: ['signatures'], destination: 'contracts.ndjson' });
    extension.expectBuildSucceeded();
    await extension.expectSignatureRecord('contracts.ndjson', 'save(snapshot: Text) returns Nothing');
    await extension.expectNoCompilerChangesOrPrivateImports();
    await extension.rememberProjectFiles();
    await extension.runCustomLauncher({ contracts: ['signatures'], destination: 'contracts.ndjson' });
    extension.expectBuildSucceeded();
    await extension.expectProjectFilesUnchanged();
  });
  it('reads and searches the extension format from current files', async () => {
    const extension = await ExporterAuthor.generatedSignatures();
    await extension.appendAuthoredNote('save', 'Keep this note.');
    await extension.addFormatLink('checkout.ndjson', 'save');
    await extension.readAndSearch('save');
    await extension.expectCurrentReadContains('Keep this note.');
    await extension.expectActualFormatReference('checkout.ndjson', 'save');
    extension.expectCoverageLimitedToDocumentedFormat();
  });
  it('preserves an authored note through a successful signature rename', async () => {
    const extension = await ExporterAuthor.generatedSignatures();
    await extension.appendAuthoredNote('save', 'Keep this note.');
    await extension.rememberSignatureIdentity('save');
    await extension.renameFunction('save', 'saveGame');
    await extension.runCustomLauncher({ contracts: ['signatures'], destination: 'contracts.ndjson' });
    extension.expectBuildSucceeded();
    await extension.expectSignatureRecord('contracts.ndjson', 'saveGame(snapshot: Text) returns Nothing');
    await extension.expectSameSignatureIdentity('saveGame');
    await extension.expectExactRetainedNote('Keep this note.');
  });
  it('reports malformed extension data without hiding a genuine use', async () => {
    const extension = await ExporterAuthor.generatedSignatures();
    await extension.addFormatLink('checkout.ndjson', 'save');
    await extension.writeCapturedFile('broken.ndjson', '{"kind":"use","id":17}\n');
    await extension.search('save');
    await extension.expectActualFormatReference('checkout.ndjson', 'save');
    extension.expectIncompleteCoverageAt('broken.ndjson', 1);
  });
  it('rejects duplicate output registration without artifact writes', async () => {
    const extension = await ExporterAuthor.generatedSignatures();
    await extension.rememberProjectFiles();
    await extension.registerDuplicateOutput('signatures');
    extension.expectDuplicateRegistrationRejected();
    await extension.expectProjectFilesUnchanged();
  });
  it('rejects an unsupported interaction without artifact writes', async () => {
    const extension = await ExporterAuthor.generatedSignatures();
    await extension.rememberProjectFiles();
    await extension.addCheckedInteraction();
    await extension.runCustomLauncher({ contracts: ['signatures'], destination: 'contracts.ndjson' });
    await extension.expectUnsupportedInteraction();
    await extension.expectProjectFilesUnchanged();
  });
  it('stops a library-host plan when a handwritten note changes afterward', async () => {
    const extension = await ExporterAuthor.generatedSignatures({ host: 'library' });
    await extension.prepareRenamePlan('save', 'saveGame');
    await extension.appendAuthoredNote('save', 'Written after planning.');
    await extension.rememberProjectFiles();
    await extension.applyPreparedPlan();
    extension.expectStoppedStaleWrite();
    await extension.expectProjectFilesUnchanged();
  });
  it('reports competing definitions without hiding a genuine format use', async () => {
    const extension = await ExporterAuthor.generatedSignatures();
    await extension.addFormatLink('checkout.ndjson', 'save');
    await extension.copySignatureDefinition('save', 'duplicate.ndjson');
    await extension.search('save');
    extension.expectCompetingDefinitions(['contracts.ndjson', 'duplicate.ndjson']);
    await extension.expectActualFormatReference('checkout.ndjson', 'save');
    extension.expectIncompleteCoverageAt('duplicate.ndjson', 1);
  });
});
