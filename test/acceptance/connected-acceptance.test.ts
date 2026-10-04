import { afterEach, beforeAll, describe, it } from 'vitest';
import { ConnectedBuild } from '../dsl/connected-build.js';

describe('connected application and acceptance stages', () => {
  let project: ConnectedBuild;
  beforeAll(() => ConnectedBuild.prepare(), 90_000);
  afterEach(async () => { if (project) await project.dispose(); });
  it('uses generated application declarations before reconciling acceptance layers', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'function multiply(a: Number, b: Number) returns Number\nexamples { example "eight squared": multiply(8, 8) => 64 }');
    await project.nativeAcceptance();
    await project.outputs([{ id: 'typescript', options: { directory: 'src', configFile: 'tsconfig.json' } }, { id: 'acceptance', options: { domain: 'arithmetic', configFile: 'tsconfig.json' } }]);
    await project.runNative(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(0);
    project.expectStage('contracts', 'applied'); project.expectStage('tests', 'applied');
    await project.expectGeneratedCall('multiply', [8, 8], 64);
    await project.expectLayerDirectories(['test/acceptance', 'test/dsl', 'test/driver']);
    project.expectNoNativeExecution();
  }, 300_000);
  it('retains the applied application stage when the actual selected driver is incompatible', async () => {
    project = await ConnectedBuild.create();
    await project.nativeAcceptance();
    await project.source('main.expec', 'concept StoreGame {}\nexamples { observation count() returns Number\nexample "one": count() => 1 }');
    await project.outputs([{ id: 'typescript', options: { directory: 'src', configFile: 'tsconfig.json' } },
      { id: 'acceptance', options: { domain: 'counts', configFile: 'tsconfig.json' } }]);
    await project.runNative(['build', '--config', 'spec/expec.json', '--json']); project.expectExit(0);
    await project.source('main.expec', 'concept StoreGame { capability reset() returns Nothing }\nexamples { observation count() returns Number\nexample "one": count() => 1 }');
    const driver = 'export class CountsDriver { count(): string { return "many"; } }';
    await project.file('test/driver/counts.ts', driver);
    await project.runNative(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(1); project.expectStage('contracts', 'applied'); project.expectStage('tests', 'stopped');
    project.expectProblem('typescript-2322');
    project.expectMessageContains("Type 'string' is not assignable to type 'number'.");
    await project.expectNativeMethod('StoreGame', 'reset', 'void');
    await project.expectDestinationText('project/test/driver/counts.ts', driver);
    project.expectNoNativeExecution();
  }, 300_000);

  it('catches changed native declaration bytes before the planned test stage writes', async () => {
    project = await ConnectedBuild.create(); await project.nativeAcceptance();
    await project.source('main.expec', 'examples { example "one": 1 => 1 }');
    await project.outputs([{ id: 'acceptance', options: { domain: 'numbers', configFile: 'tsconfig.json' } }]);
    await project.runNative(['build', '--config', 'spec/expec.json', '--json']); project.expectExit(0);
    await project.rememberDirectory('test'); await project.rememberIdentities();
    await project.source('main.expec', 'examples { example "one": 1 => 1\nexample "two": 2 => 2 }');
    await project.afterTestPlanningChangeVitestDeclaration();
    await project.runNative(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(1); project.expectStage('tests', 'stopped'); project.expectProblem('stale-project');
    await project.expectRememberedDirectoryUnchanged('test'); await project.expectIdentitiesUnchanged();
    await project.expectNoPendingBuild(); project.expectNoNativeExecution();
  }, 300_000);
  it('reports that a built specification has no executable examples without launching a runner', async () => {
    project = await ConnectedBuild.create(); await project.nativeAcceptance();
    await project.source('main.expec', 'concept StoreGame {}');
    await project.outputs([{ id: 'acceptance', options: { domain: 'store', configFile: 'tsconfig.json' } }]);
    await project.runNative(['build', '--config', 'spec/expec.json', '--json']); project.expectExit(0);
    await project.rememberAllBytes();
    await project.runNative(['test', '--config', 'spec/expec.json', '--json']);
    project.expectExit(1); project.expectProblem('no-executable-examples'); project.expectNoNativeExecution();
    await project.expectAllBytesUnchanged();
  }, 300_000);

});
