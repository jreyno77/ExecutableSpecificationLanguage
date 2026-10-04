import { afterEach, beforeAll, describe, it } from 'vitest';
import { ConnectedBuild } from '../dsl/connected-build.js';

describe('recovering a partially applied connected build', () => {
  let project: ConnectedBuild;
  beforeAll(() => ConnectedBuild.prepare(), 90_000);
  afterEach(async () => { if (project) await project.dispose(); });

  it('reports an applied prefix without confirming the remaining artifacts', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'concept First {}\nconcept Second {}\n');
    await project.outputs([{ id: 'typescript', options: { directory: 'src' } }]);
    project.failActualWrite('src/Second.ts');
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(1);
    project.expectFileOutcome('src/First.ts', 'applied');
    project.expectFileOutcome('src/Second.ts', 'not-applied');
    await project.expectNativeClass('First');
    await project.expectNoDestinationFile('project/src/Second.ts');
    await project.expectNoDestinationFile('project/.expec/identity.json');
    await project.rememberPendingIdentities();
  }, 60_000);

  it('resumes a recognizable prefix with the original allocated identities', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'concept First {}\nconcept Second {}\n');
    await project.outputs([{ id: 'typescript', options: { directory: 'src' } }]);
    project.failActualWrite('src/Second.ts');
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(1);
    await project.rememberPendingIdentities();
    project.clearActualWriteFailure();
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(0);
    await project.expectNativeClass('First');
    await project.expectNativeClass('Second');
    await project.expectPendingIdentitiesBecameConfirmed();
    await project.expectNoPendingBuild();
  }, 90_000);

  it('refuses recovery over an edit made after partial application', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'concept First {}\nconcept Second {}\n');
    await project.outputs([{ id: 'typescript', options: { directory: 'src' } }]);
    project.failActualWrite('src/Second.ts');
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(1);
    project.clearActualWriteFailure();
    await project.file('src/First.ts', 'export class First { private learning = "keep"; }\n');
    await project.rememberAllBytes();
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(1);
    project.expectProblem('recovery-conflict');
    await project.expectAllBytesUnchanged();
    await project.expectNoDestinationFile('project/src/Second.ts');
  }, 90_000);

  it('retains execution intent when identity confirmation fails', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'concept StoreGame {}\n');
    await project.outputs([{ id: 'typescript', options: { directory: 'src' } }]);
    project.failActualWrite('.expec/identity.json');
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(1);
    project.expectProblem('unconfirmed-state');
    project.expectStage('contracts', 'applied');
    await project.expectNativeClass('StoreGame');
    await project.expectPendingBuildRetained();
    await project.expectNoDestinationFile('project/.expec/identity.json');
  }, 60_000);

  it('finishes only journal cleanup after the intended ledger was already confirmed', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'concept StoreGame {}\n');
    await project.outputs([{ id: 'typescript', options: { directory: 'src' } }]);
    project.failPendingRemoval();
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(1);
    project.expectStage('contracts', 'applied');
    await project.expectPendingBuildRetained();
    await project.rememberIdentities();
    project.clearActualWriteFailure();
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(0);
    await project.expectIdentitiesUnchanged();
    await project.expectNativeClass('StoreGame');
    await project.expectNoPendingBuild();
    project.expectStage('contracts', 'unchanged');
  }, 90_000);
  it('refuses to rebaseline a handwritten file created immediately after intent is saved', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'concept StoreGame {}\n');
    await project.outputs([{ id: 'typescript', options: { directory: 'src' } }]);
    project.changeAfterWriterRelease(1, 'src/StoreGame.ts', 'export class StoreGame { private learning = "keep"; }\n');
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(1);
    project.expectProblem('recovery-conflict');
    await project.expectDestinationText('project/src/StoreGame.ts', 'export class StoreGame { private learning = "keep"; }\n');
    await project.expectNoDestinationFile('project/.expec/identity.json');
    await project.expectPendingBuildRetained();
  }, 60_000);

  it('does not confirm outputs changed immediately after their actual receipt', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'concept StoreGame {}\n');
    await project.outputs([{ id: 'typescript', options: { directory: 'src' } }]);
    project.changeAfterWriterRelease(2, 'src/StoreGame.ts', 'export class StoreGame { private learning = "keep"; }\n');
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(1);
    project.expectProblem('recovery-conflict');
    project.expectStage('contracts', 'applied');
    await project.expectDestinationText('project/src/StoreGame.ts', 'export class StoreGame { private learning = "keep"; }\n');
    await project.expectNoDestinationFile('project/.expec/identity.json');
    await project.expectPendingBuildRetained();
  }, 60_000);

  it('retains intent if code changes immediately after confirmation and before cleanup', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'concept StoreGame {}\n');
    await project.outputs([{ id: 'typescript', options: { directory: 'src' } }]);
    project.changeAfterWriterRelease(3, 'src/StoreGame.ts', 'export class StoreGame { private learning = "keep"; }\n');
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(1);
    project.expectProblem('recovery-conflict');
    project.expectStage('contracts', 'applied');
    await project.expectDestinationText('project/src/StoreGame.ts', 'export class StoreGame { private learning = "keep"; }\n');
    await project.expectPendingBuildRetained();
  }, 60_000);

});
