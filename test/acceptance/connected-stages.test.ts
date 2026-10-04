import { afterEach, beforeAll, describe, it } from 'vitest';
import { ConnectedBuild } from '../dsl/connected-build.js';

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
});
