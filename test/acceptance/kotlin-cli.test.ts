import { afterEach, beforeAll, describe, it } from 'vitest';
import { KotlinCli } from '../dsl/kotlin-cli.js';

describe('the Kotlin project command line', () => {
  let project: KotlinCli;
  beforeAll(() => KotlinCli.prepare(), 90_000);
  afterEach(async () => { if (project) await project.dispose(); });

  it('persists an explicit Kotlin and JDK choice without installing or generating tests', async () => {
    project = await KotlinCli.create();
    await project.initialize();
    project.expectExit(0);
    project.expectStage('initialization', 'applied');
    project.expectStage('configuration', 'applied');
    await project.expectInitialized();
    await project.expectNoNativeBuildOrTests();
  }, 90_000);

  it('uses explicitly installed native packages in a later guarded contract build', async () => {
    project = await KotlinCli.create();
    await project.starter();
    await project.source('class StoreGame { public save\ncapability save() returns Nothing }');
    await project.install();
    project.expectExit(0);
    await project.expectInstalledPackage('maven:org.jetbrains.kotlin:kotlin-stdlib', '2.4.10');
    await project.rememberBuildInputs();
    await project.build();
    project.expectExit(0);
    project.expectStage('contracts', 'applied');
    project.expectNoGradleLaunch();
    await project.expectContract('StoreGame.kt', 'fun save(): Unit');
    await project.expectNativeBuildInputsUnchanged();
    await project.rememberProjectBytes();
    await project.build(); project.expectExit(0);
    project.expectStage('contracts', 'unchanged'); await project.expectProjectBytesUnchanged();
  }, 360_000);
  it('executes only the confirmed Kotlin example and detects the real wrong application', async () => {
    project = await KotlinCli.create();
    await project.starter(); await project.acceptance();
    await project.source('function multiply(a: Number, b: Number) returns Number\nexamples { example "eight squared": multiply(8, 8) => 64 }');
    await project.install(); project.expectExit(0);
    await project.build(); project.expectExit(0);
    await project.implement('return a * b');
    await project.addFailingNeighbor();
    await project.rememberProjectBytes();
    await project.test(); project.expectExit(0);
    project.expectTests([{ title: 'eight squared', state: 'passed' }]);
    project.expectNoGradleLaunch(); await project.expectProjectBytesUnchanged();
    await project.implement('return a + b');
    await project.rememberProjectBytes();
    await project.test(); project.expectExit(1);
    project.expectTests([{ title: 'eight squared', state: 'failed' }]);
    project.expectFailure('64'); project.expectFailure('16');
    project.expectNoGradleLaunch(); await project.expectProjectBytesUnchanged();
  }, 360_000);
  it('does not verify only one case when another current example has no confirmed artifact', async () => {
    project = await KotlinCli.create();
    await project.starter(); await project.acceptance();
    await project.source('examples { example "one": 1 => 1\nexample "two": 2 => 2 }');
    await project.install(); project.expectExit(0);
    await project.build(); project.expectExit(0);
    await project.test(); project.expectExit(0);
    project.expectTests([{ title: 'one', state: 'passed' }, { title: 'two', state: 'passed' }]);
    await project.forgetExampleArtifact('two');
    await project.rememberProjectBytes();
    await project.test(); project.expectExit(1);
    project.expectProblem('generated-tests-not-executed'); project.expectNoExecutedTests();
    await project.expectProjectBytesUnchanged();
  }, 360_000);
  it('refuses a disabled selected native example without claiming verification', async () => {
    project = await KotlinCli.create();
    await project.starter(); await project.acceptance();
    await project.source('examples { example "one": 1 => 1 }');
    await project.install(); project.expectExit(0);
    await project.build(); project.expectExit(0);
    await project.disableExample(); await project.rememberProjectBytes();
    await project.test(); project.expectExit(1);
    project.expectProblem('output-conflict'); project.expectNoExecutedTests();
    await project.expectProjectBytesUnchanged();
  }, 360_000);
});
