import { afterEach, beforeAll, describe, it } from 'vitest';
import { ConnectedBuild } from '../../dsl/cli/connected-build.js';

describe('explicit replanning after an authored-source correction', () => {
  let project: ConnectedBuild;
  beforeAll(() => ConnectedBuild.prepare(), 90_000);
  afterEach(async () => { if (project) await project.dispose(); });

  async function correctedSourceAfterRefusedTests(): Promise<string> {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'function save(source: Text) returns Nothing');
    await project.registerOutputs([
      { id: 'contracts', stage: 'contracts', file: 'contracts.txt', text: 'source contract' },
      { id: 'checks', stage: 'tests', file: 'tests.txt', text: 'source expectations' },
    ]);
    await project.outputs([{ id: 'contracts', options: {} }, { id: 'checks', options: {} }]);
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(0);
    const parameter = await project.identity('save.source');
    await project.source('main.expec', 'function save(document: Text) returns Nothing');
    await project.decisions({ format: 1, matches: [{ id: parameter, to: { source: 'main.expec', line: 1, column: 15 } }], retire: [] });
    await project.registerOutputs([
      { id: 'contracts', stage: 'contracts', file: 'contracts.txt', text: 'document contract' },
      { id: 'checks', stage: 'tests', malformedPlan: true },
    ]);
    await project.run(['build', '--config', 'spec/expec.json', '--decisions', 'changes.json', '--json']);
    project.expectExit(1); project.expectStage('contracts', 'applied'); project.expectStage('tests', 'stopped');
    await project.expectNoPendingBuild(); await project.expectTransitionRetained();
    await project.source('main.expec', 'function save(payload: Text) returns Nothing');
    await project.registerOutputs([
      { id: 'contracts', stage: 'contracts', file: 'contracts.txt', text: 'payload contract', trace: true },
      { id: 'checks', stage: 'tests', file: 'tests.txt', text: 'payload expectations', trace: true },
    ]);
    return parameter;
  }

  it('replans confirmed contracts from document while unfinished tests retain source as their rename basis', async () => {
    const parameter = await correctedSourceAfterRefusedTests();

    await project.run(['build', '--replan', '--config', 'spec/expec.json', '--decisions', 'changes.json', '--json']);

    project.expectExit(0);
    await project.expectPlannedRename('contracts', parameter, 'document', 'payload');
    await project.expectPlannedRename('checks', parameter, 'source', 'payload');
    await project.expectIdentity('save.payload', parameter);
    await project.expectDestinationText('project/contracts.txt', 'payload contract');
    await project.expectDestinationText('project/tests.txt', 'payload expectations');
    await project.expectNoPendingBuild(); await project.expectNoTransition();
    project.expectNoNativeExecution();
  }, 60_000);

  it('retains strict default recovery after the authored source changes', async () => {
    await correctedSourceAfterRefusedTests();
    await project.rememberAllBytes();

    await project.run(['build', '--config', 'spec/expec.json', '--json']);

    project.expectExit(1); project.expectProblem('recovery-conflict');
    await project.expectAllBytesUnchanged(); await project.expectTransitionRetained();
  }, 60_000);

  it('requires original physical write recovery before any explicit replan', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'function save(source: Text) returns Nothing');
    await project.registerOutputs([
      { id: 'contracts', stage: 'contracts', file: 'contracts.txt', text: 'source contract' },
      { id: 'checks', stage: 'tests', file: 'tests.txt', text: 'source expectations' },
    ]);
    await project.outputs([{ id: 'contracts', options: {} }, { id: 'checks', options: {} }]);
    project.failActualWrite('.expec/identity.json');
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(1); await project.expectPendingBuildRetained();
    await project.rememberAllBytes();

    await project.run(['build', '--replan', '--config', 'spec/expec.json', '--json']);

    project.expectExit(1); project.expectProblem('recovery-required');
    await project.expectAllBytesUnchanged(); await project.expectPendingBuildRetained();
  }, 60_000);

  it('lets ordinary same-input recovery finish a replanned write with both actual stage bases', async () => {
    const parameter = await correctedSourceAfterRefusedTests();
    project.failActualWrite('.expec/identity.json');
    await project.run(['build', '--replan', '--config', 'spec/expec.json', '--decisions', 'changes.json', '--json']);
    project.expectExit(1); await project.expectPendingBuildRetained();
    project.clearActualWriteFailure();

    await project.run(['build', '--config', 'spec/expec.json', '--json']);

    project.expectExit(0);
    await project.expectIdentity('save.payload', parameter);
    await project.expectDestinationText('project/contracts.txt', 'payload contract');
    await project.expectDestinationText('project/tests.txt', 'payload expectations');
    await project.expectPlannedRename('checks', parameter, 'source', 'payload');
    await project.expectNoPendingBuild(); await project.expectNoTransition();
  }, 60_000);

  it('uses ordinary guarded build when explicit replan has no retained transition', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'function save(source: Text) returns Nothing');
    await project.registerOutputs([{ id: 'contracts', stage: 'contracts', file: 'contracts.txt', text: 'source contract' }]);
    await project.outputs([{ id: 'contracts', options: {} }]);

    await project.run(['build', '--replan', '--config', 'spec/expec.json', '--json']);

    project.expectExit(0); await project.expectDestinationText('project/contracts.txt', 'source contract');
    await project.expectNoPendingBuild(); await project.expectNoTransition();
  }, 30_000);
});

// The actual TypeScript adapter still owns admission of the generated native signature.

it('does not let explicit replanning overwrite a handwritten native contract edit', async () => {
  const project = await ConnectedBuild.create();
  try {
    await project.source('main.expec', 'function save(source: Text) returns Nothing');
    await project.registerOutputs([{ id: 'checks', stage: 'tests', file: 'tests.txt', text: 'source expectations' }]);
    await project.outputs([{ id: 'typescript', options: { directory: 'src' } }, { id: 'checks', options: {} }]);
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(0);
    const parameter = await project.identity('save.source');
    await project.source('main.expec', 'function save(document: Text) returns Nothing');
    await project.decisions({ format: 1, matches: [{ id: parameter, to: { source: 'main.expec', line: 1, column: 15 } }], retire: [] });
    await project.registerOutputs([{ id: 'checks', stage: 'tests', malformedPlan: true }]);
    await project.run(['build', '--config', 'spec/expec.json', '--decisions', 'changes.json', '--json']);
    project.expectExit(1); project.expectStage('contracts', 'applied'); project.expectStage('tests', 'stopped');
    await project.source('main.expec', 'function save(payload: Text) returns Nothing');
    await project.registerOutputs([{ id: 'checks', stage: 'tests', file: 'tests.txt', text: 'payload expectations' }]);
    await project.file('src/save.ts', 'export function save(document: number): void { void document; }\n');
    await project.rememberAllBytes();

    await project.run(['build', '--replan', '--config', 'spec/expec.json', '--decisions', 'changes.json', '--json']);

    project.expectExit(1); project.expectProblem('contract-drift');
    await project.expectAllBytesUnchanged(); await project.expectTransitionRetained();
  } finally { await project.dispose(); }
}, 60_000);
