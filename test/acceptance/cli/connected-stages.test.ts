import { afterEach, beforeAll, describe, it } from 'vitest';
import { ConnectedBuild } from '../../dsl/cli/connected-build.js';

describe('each connected output stage keeps its actual boundaries', () => {
  let project: ConnectedBuild;
  beforeAll(() => ConnectedBuild.prepare(), 90_000);
  afterEach(async () => { if (project) await project.dispose(); });

  it('rejects competing output destinations before either output writes', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'concept StoreGame {}\n');
    await project.registerOutputs([{ id: 'first', stage: 'contracts', file: 'same.txt', text: 'first' }, { id: 'second', stage: 'contracts', file: 'same.txt', text: 'second' }]);
    await project.outputs([{ id: 'first', options: {} }, { id: 'second', options: {} }]);
    await project.rememberAllBytes();
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(1);
    project.expectProblem('output-path-conflict');
    await project.expectAllBytesUnchanged();
    await project.expectNoPendingBuild();
  }, 40_000);

  it('refuses a source changed after planning before application', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'concept StoreGame {}\n');
    await project.registerOutputs([{ id: 'concurrent-edit', stage: 'contracts', afterPlan: { path: 'spec/main.expec', text: 'concept Replacement {}\n' } }]);
    await project.outputs([{ id: 'typescript', options: { directory: 'src' } }, { id: 'concurrent-edit', options: {} }]);
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(1);
    project.expectProblem('stale-build-input');
    await project.expectNoDestinationFile('project/src/StoreGame.ts');
    await project.expectDestinationText('spec/main.expec', 'concept Replacement {}\n');
    await project.expectNoPendingBuild();
  }, 50_000);

  it('refuses a handwritten edit after planning without discarding the new work', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'concept StoreGame { capability save() returns Nothing }');
    await project.outputs([{ id: 'typescript', options: { directory: 'src' } }]);
    await project.run(['build', '--config', 'spec/expec.json', '--json']); project.expectExit(0);
    await project.source('main.expec', 'concept StoreGame { capability save() returns Nothing\ncapability reset() returns Nothing }');
    await project.afterPlanningEditMethod('StoreGame', 'save', 'console.log("new work");');
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(1); project.expectProblem('stale-project');
    await project.expectMethodBody('StoreGame', 'save', 'console.log("new work");');
    await project.expectNoNativeMethod('StoreGame', 'reset');
    await project.expectNoPendingBuild();
  }, 60_000);

  it('keeps the observed installed package facts stable even for an unused declared package', async () => {
    project = await ConnectedBuild.create();
    await project.file('package.json', '{"name":"store-game","private":true,"version":"1.0.0"}');
    await project.source('main.expec', 'concept StoreGame {}');
    await project.requirePackage('storage', 'npm:example-storage', '1.2.0', ['runtime']);
    await project.serveRealPackage('example-storage', '1.2.0');
    await project.run(['install', '--config', 'spec/expec.json', '--json']); project.expectExit(0);
    await project.afterPlanningChangePackageVersion('example-storage', '1.2.1');
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(1); project.expectProblem('stale-build-input');
    await project.expectNoDestinationFile('project/package-note.txt');
    await project.expectInstalledMetadataVersion('example-storage', '1.2.1');
    await project.expectNoPendingBuild();
  }, 80_000);

  it('asks each contract output only about the identities it actually owns', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'concept First {}\nconcept Second {}');
    await project.registerOutputs([{ id: 'first', stage: 'contracts', subject: 'First', file: 'first.txt', text: 'First contract' },
      { id: 'second', stage: 'contracts', subject: 'Second', file: 'second.txt', text: 'Second contract' },
      { id: 'tests', stage: 'tests', file: 'selected-tests.txt', text: 'Test mapping' }]);
    await project.outputs([{ id: 'first', options: {} }, { id: 'second', options: {} }, { id: 'tests', options: {} }]);
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(0); project.expectStage('contracts', 'applied'); project.expectStage('tests', 'applied');
    await project.expectDestinationText('project/first.txt', 'First contract');
    await project.expectDestinationText('project/second.txt', 'Second contract');
    await project.expectDestinationText('project/selected-tests.txt', 'Test mapping');
  }, 40_000);

  it('protects an unchanged contract artifact from a newly selected test output', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'concept StoreGame {}\n');
    await project.registerOutputs([{ id: 'contract-example', stage: 'contracts', file: 'same.txt', text: 'contract' }, { id: 'test-example', stage: 'tests', file: 'same.txt', text: 'test' }]);
    await project.outputs([{ id: 'contract-example', options: {} }]);
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(0);
    await project.outputs([{ id: 'contract-example', options: {} }, { id: 'test-example', options: {} }]);
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(1);
    project.expectStage('contracts', 'unchanged');
    project.expectStage('tests', 'stopped');
    project.expectProblem('output-path-conflict');
    await project.expectDestinationText('project/same.txt', 'contract');
  }, 50_000);

  it('prevents a test output from overwriting the just-completed contract artifact', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'concept StoreGame {}\n');
    await project.registerOutputs([{ id: 'contract-example', stage: 'contracts', file: 'same.txt', text: 'contract' }, { id: 'test-example', stage: 'tests', file: 'same.txt', text: 'test' }]);
    await project.outputs([{ id: 'contract-example', options: {} }, { id: 'test-example', options: {} }]);
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(1);
    project.expectStage('contracts', 'applied');
    project.expectStage('tests', 'stopped');
    project.expectProblem('output-path-conflict');
    await project.expectDestinationText('project/same.txt', 'contract');
  }, 50_000);
  it('retains completed contracts and obligations when a later adapter returns a malformed plan', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'concept StoreGame { capability save() returns Nothing }');
    await project.registerOutputs([{ id: 'broken-tests', stage: 'tests', malformedPlan: true }]);
    await project.outputs([{ id: 'typescript', options: { directory: 'src' } }, { id: 'broken-tests', options: {} }]);
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(1); project.expectProblem('host-failure');
    project.expectStage('contracts', 'applied'); project.expectStage('tests', 'stopped');
    project.expectFileOutcome('src/StoreGame.ts', 'applied'); project.expectObligation('implementation-required', 'save');
    await project.expectNativeClass('StoreGame'); await project.expectNoPendingBuild();
  }, 60_000);
  it('retains completed contracts when their later read throws before test planning', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'concept StoreGame {}');
    await project.registerOutputs([{ id: 'contract', stage: 'contracts', file: 'contract.txt', text: 'StoreGame contract', readFailure: 'Native read failed after application' },
      { id: 'tests', stage: 'tests', file: 'test.txt', text: 'Never written' }]);
    await project.outputs([{ id: 'contract', options: {} }, { id: 'tests', options: {} }]);
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(1); project.expectProblem('host-failure');
    project.expectStage('contracts', 'applied'); project.expectStage('tests', 'stopped'); project.expectFileOutcome('contract.txt', 'applied');
    await project.expectDestinationText('project/contract.txt', 'StoreGame contract');
    await project.expectNoDestinationFile('project/test.txt'); await project.expectNoPendingBuild();
  }, 40_000);

});
