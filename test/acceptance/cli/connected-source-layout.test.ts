import { afterEach, beforeAll, describe, it } from 'vitest';
import { ConnectedBuild } from '../../dsl/cli/connected-build.js';

describe('source placement before acceptance generation', () => {
  let project: ConnectedBuild;
  beforeAll(() => ConnectedBuild.prepare(), 90_000);
  afterEach(async () => { if (project) await project.dispose(); });

  it('uses nested code associations for examples in the same source', async () => {
    project = await ConnectedBuild.create();
    await project.source('src/core/arithmetic.expec', 'function multiply(a: Number, b: Number) returns Number\nexamples { example "eight squared": multiply(8, 8) => 64 }');
    await project.entries(['src/core/arithmetic.expec']);
    await project.nativeAcceptance();
    await project.outputs([
      { id: 'typescript', options: { sourceRoot: '.', directory: '.', configFile: 'tsconfig.source.json' } },
      { id: 'acceptance', options: { domain: 'arithmetic', configFile: 'tsconfig.json' } },
    ]);
    await project.runNative(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(0);
    project.expectStage('contracts', 'applied');
    project.expectStage('tests', 'applied');
    await project.expectGeneratedCall('multiply', [8, 8], 64);
    await project.expectLayerDirectories(['test/acceptance', 'test/dsl', 'test/driver']);
    await project.expectGeneratedImport('test/acceptance', '../../src/core/multiply.js');
    project.expectNoNativeExecution();
  }, 90_000);
});
