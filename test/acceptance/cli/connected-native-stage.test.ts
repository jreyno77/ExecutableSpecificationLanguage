import { afterEach, beforeAll, describe, it } from 'vitest';
import { ConnectedBuild } from '../../dsl/cli/connected-build.js';

describe('native capture during one finite file stage', () => {
  let project: ConnectedBuild;
  beforeAll(() => ConnectedBuild.prepare(), 90_000);
  afterEach(async () => { if (project) await project.dispose(); });

  it('builds mutually importing local types through a guarded stage', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'type Left { right: Right? }\ntype Right { left: Left? }\n');
    await project.outputs([{ id: 'typescript', options: { directory: 'src' } }]);
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(0);
    await project.expectNativeType('Left', { right: 'Right | undefined' }, ['right']);
    await project.expectNativeType('Right', { left: 'Left | undefined' }, ['left']);
    await project.expectNoPendingBuild();
  }, 60_000);

  it('resumes the original capture after the first half of a local cycle', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'type Left { right: Right? }\ntype Right { left: Left? }\n');
    await project.outputs([{ id: 'typescript', options: { directory: 'src' } }]);
    project.failActualWrite('src/Right.ts');
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(1);
    await project.rememberPendingIdentities(['Left', 'Right']);
    project.clearActualWriteFailure();
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(0);
    await project.expectPendingIdentitiesBecameConfirmed();
    await project.expectNativeType('Left', { right: 'Right | undefined' }, ['right']);
    await project.expectNativeType('Right', { left: 'Left | undefined' }, ['left']);
    await project.expectNoPendingBuild();
  }, 90_000);

  it('rejects an unexpected native configuration edit between file effects', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'type Left { right: Right? }\ntype Right { left: Left? }\n');
    await project.file('tsconfig.json', '{"compilerOptions":{"target":"ES2022","types":[]}}');
    await project.outputs([{ id: 'typescript', options: { directory: 'src', configFile: 'tsconfig.json' } }]);
    project.changeAfterOutputWrite('src/Left.ts', 'tsconfig.json', '{"compilerOptions":{"target":"ES2022","types":["missing-package"]}}');
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(1);
    await project.expectNoDestinationFile('project/.expec/identity.json');
    await project.expectPendingBuildRetained();
    await project.expectDestinationText('project/tsconfig.json', '{"compilerOptions":{"target":"ES2022","types":["missing-package"]}}');
  }, 60_000);

  it('reacquires the actual installed declaration bytes during a partial stage', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'type Left { right: Right? }\ntype Right { left: Left? }\n');
    await project.file('node_modules/@types/native-lib/package.json', '{"name":"@types/native-lib","version":"1.0.0","types":"index.d.ts"}');
    await project.file('node_modules/@types/native-lib/index.d.ts', 'declare const marker: number;');
    await project.file('src/original.ts', 'const original: typeof marker = 1;');
    await project.file('tsconfig.json', '{"compilerOptions":{"target":"ES2022","types":["native-lib"]}}');
    await project.outputs([{ id: 'typescript', options: { directory: 'src', configFile: 'tsconfig.json' } }]);
    project.changeAfterOutputWrite('src/Left.ts', 'node_modules/@types/native-lib/index.d.ts', 'declare const marker: string;');
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(1);
    project.expectProblem('stale-project');
    await project.expectNoDestinationFile('project/.expec/identity.json');
    await project.expectPendingBuildRetained();
    await project.expectDestinationText('project/node_modules/@types/native-lib/index.d.ts', 'declare const marker: string;');
  }, 60_000);

  it('requires the actual completed program before confirming generated identities', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'concept StoreGame {}\n');
    await project.registerOutputs([{ id: 'new-import', stage: 'contracts', file: 'src/new-import.ts', text: 'import { missing } from "not-installed"; export const value = missing;\n' }]);
    await project.outputs([{ id: 'typescript', options: { directory: 'src' } }, { id: 'new-import', options: {} }]);
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(1);
    project.expectProblem('recovery-conflict');
    await project.expectNativeClass('StoreGame');
    await project.expectDestinationText('project/src/new-import.ts', 'import { missing } from "not-installed"; export const value = missing;\n');
    await project.expectNoDestinationFile('project/.expec/identity.json');
    await project.expectPendingBuildRetained();
  }, 60_000);

});
