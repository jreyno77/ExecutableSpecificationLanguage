import { afterEach, beforeAll, describe, it } from 'vitest';
import { ConnectedBuild } from '../../dsl/cli/connected-build.js';

describe('native dependency evidence during output transition recovery', () => {
  let project: ConnectedBuild;
  beforeAll(() => ConnectedBuild.prepare(), 90_000);
  afterEach(async () => { if (project) await project.dispose(); });

  it('reconstructs contract-stage evidence before continuing native acceptance generation', async () => {
    project = await ConnectedBuild.create(); await project.nativeAcceptance();
    await project.source('main.expec', 'component Editor {}\nexamples { observation count() returns Number\nexample "one": count() => 1 }');
    await project.outputs([{ id: 'typescript', options: { directory: 'src', configFile: 'tsconfig.source.json' } },
      { id: 'acceptance', options: { domain: 'counts', configFile: 'tsconfig.json' } }]);
    project.failActualWrite('.expec/identity.json');
    await project.runNative(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(1); project.expectProblem('unconfirmed-state');
    await project.expectTransitionRetained(); await project.expectPendingBuildRetained();
    await project.rememberDirectory('src');

    project.clearActualWriteFailure();
    await project.runNative(['build', '--config', 'spec/expec.json', '--json']);

    project.expectExit(0); await project.expectRememberedDirectoryUnchanged('src');
    await project.expectGeneratedExampleNames(['one']);
    await project.expectNoPendingBuild(); await project.expectNoTransition();
    project.expectNoNativeExecution();
  }, 300_000);
});
