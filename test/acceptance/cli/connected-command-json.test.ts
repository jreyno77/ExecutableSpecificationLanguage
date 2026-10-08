import { afterEach, beforeAll, describe, it } from 'vitest';
import { ConnectedBuild } from '../../dsl/cli/connected-build.js';

describe('reading concise actual command receipts', () => {
  let project: ConnectedBuild;
  beforeAll(() => ConnectedBuild.prepare(), 90_000);
  afterEach(async () => { if (project) await project.dispose(); });
  it('reports a completed contracts-and-tests build without private transition bodies', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'concept Book {}');
    await project.registerOutputs([
      { id: 'contract', stage: 'contracts', file: 'generated/Book.txt', text: 'Book\n' },
      { id: 'test-data', stage: 'tests', file: 'test/Book.txt', text: 'Book example\n' },
    ]);
    await project.outputs([{ id: 'contract', options: {} }, { id: 'test-data', options: {} }]);
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(0);
    project.expectFileOutcome('generated/Book.txt', 'applied');
    project.expectFileOutcome('test/Book.txt', 'applied');
    project.expectNoPrivateCoordinationBodies();
    project.expectUserByteReceipt('generated/Book.txt', 'Book\n');
    await project.expectDestinationText('project/generated/Book.txt', 'Book\n');
    await project.expectDestinationText('project/test/Book.txt', 'Book example\n');
    await project.expectNoTransition();
    await project.expectNoPendingBuild();
  });

  it('retains honest partial file effects and recoverable private intent on refusal', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'concept First {}\nconcept Second {}');
    await project.registerOutputs([
      { id: 'first', stage: 'contracts', file: 'generated/First.txt', text: 'First\n' },
      { id: 'second', stage: 'tests', file: 'generated/Second.txt', text: 'Second\n' },
    ]);
    await project.outputs([{ id: 'first', options: {} }, { id: 'second', options: {} }]);
    project.failActualWrite('generated/Second.txt');
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(1);
    project.expectFileOutcome('generated/First.txt', 'applied');
    project.expectFileOutcome('generated/Second.txt', 'not-applied');
    project.expectNoPrivateCoordinationBodies();
    project.expectUserByteReceipt('generated/First.txt', 'First\n');
    await project.expectPendingBuildRetained();
    await project.rememberPendingIdentities();
    project.clearActualWriteFailure();
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(0);
    await project.expectPendingIdentitiesBecameConfirmed();
    await project.expectNoPendingBuild();
  });
});
