import { afterEach, beforeAll, describe, it } from 'vitest';
import { ConnectedBuild } from '../../dsl/cli/connected-build.js';

describe('an interrupted connected build reports its actual effects', () => {
  let project: ConnectedBuild;
  beforeAll(() => ConnectedBuild.prepare(), 90_000);
  afterEach(async () => { if (project) await project.dispose(); });
  it('returns the signal status with the written prefix and pending intent retained', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'concept First {}\nconcept Second {}');
    await project.outputs([{ id: 'typescript', options: { directory: 'src' } }]);
    project.interruptAfterOutputWrite('src/First.ts');
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(130); project.expectStatus('cancelled'); project.expectStage('contracts', 'stopped');
    project.expectFileOutcome('src/First.ts', 'applied');
    await project.expectNativeClass('First'); await project.expectNoDestinationFile('project/src/Second.ts');
    await project.expectNoDestinationFile('project/.expec/identity.json'); await project.expectPendingBuildRetained();
  }, 60_000);
});
