import { createHash } from 'node:crypto';
import { afterEach, beforeAll, describe, it } from 'vitest';
import { ConnectedBuild } from '../../dsl/cli/connected-build.js';

describe('compact connected-build recovery records', () => {
  let project: ConnectedBuild;
  beforeAll(() => ConnectedBuild.prepare(), 90_000);
  afterEach(async () => { if (project) await project.dispose(); });

  it('guards an unrelated archive without copying its body and completes the original pending build', async () => {
    project = await ConnectedBuild.create();
    const archive = new Uint8Array(8 * 1024 * 1024).fill(0x5a);
    const archiveHash = createHash('sha256').update(archive).digest('hex');
    await project.binaryFile('tool/archive.bin', archive);
    await project.source('main.expec', 'concept First {}\nconcept Second {}');
    await project.registerOutputs([
      { id: 'first', stage: 'contracts', file: 'generated/First.txt', text: 'First\n' },
      { id: 'second', stage: 'contracts', file: 'generated/Second.txt', text: 'Second\n' },
    ]);
    await project.outputs([{ id: 'first', options: {} }, { id: 'second', options: {} }]);
    project.failActualWrite('generated/Second.txt');
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(1);
    project.expectFileOutcome('generated/First.txt', 'applied');
    await project.expectPendingRecordBelow(64 * 1024);
    await project.expectPendingFileFact('tool/archive.bin', { version: archiveHash, preimage: false });
    await project.expectBinaryFile('tool/archive.bin', archive);
    await project.expectNoDestinationFile('project/.expec/identity.json');
    await project.rememberPendingIdentities();
    project.clearActualWriteFailure();
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(0);
    await project.expectDestinationText('project/generated/First.txt', 'First\n');
    await project.expectDestinationText('project/generated/Second.txt', 'Second\n');
    await project.expectBinaryFile('tool/archive.bin', archive);
    await project.expectPendingIdentitiesBecameConfirmed();
    await project.expectNoPendingBuild();
  });

  it('refuses replay after unrelated archive bytes changed', async () => {
    project = await ConnectedBuild.create();
    await project.binaryFile('tool/archive.bin', new Uint8Array(1024).fill(0x5a));
    await project.source('main.expec', 'concept First {}\nconcept Second {}');
    await project.registerOutputs([
      { id: 'first', stage: 'contracts', file: 'generated/First.txt', text: 'First\n' },
      { id: 'second', stage: 'contracts', file: 'generated/Second.txt', text: 'Second\n' },
    ]);
    await project.outputs([{ id: 'first', options: {} }, { id: 'second', options: {} }]);
    project.failActualWrite('generated/Second.txt');
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(1);
    project.clearActualWriteFailure();
    await project.binaryFile('tool/archive.bin', new Uint8Array(1024).fill(0x6b));
    await project.rememberAllBytes();
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(1);
    project.expectProblem('recovery-conflict');
    await project.expectAllBytesUnchanged();
    await project.expectPendingBuildRetained();
    await project.expectNoDestinationFile('project/generated/Second.txt');
  });
});
