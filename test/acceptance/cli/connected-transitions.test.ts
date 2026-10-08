import { afterEach, beforeAll, describe, it } from 'vitest';
import { ConnectedBuild } from '../../dsl/cli/connected-build.js';

describe('unfinished connected output transitions', () => {
  let project: ConnectedBuild;
  beforeAll(() => ConnectedBuild.prepare(), 90_000);
  afterEach(async () => { if (project) await project.dispose(); });

  it('resumes a rename after repairing a refused acceptance stage', async () => {
    project = await ConnectedBuild.create();
    await project.nativeAcceptance();
    await project.source('main.expec', 'component Editor {\n  public save\n  capability save(source: Text) returns Nothing\n}\nexamples { observation count() returns Number\nexample "one": count() => 1 }');
    await project.outputs([{ id: 'typescript', options: { directory: 'src', configFile: 'tsconfig.source.json' } },
      { id: 'acceptance', options: { domain: 'counts', configFile: 'tsconfig.json' } }]);
    await project.runNative(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(0);
    const parameter = await project.identity('Editor.save.source');
    await project.implementMethod('Editor', 'save', 'void source;');
    await project.source('main.expec', 'component Editor {\n  public save\n  capability save(document: Text) returns Nothing\n}\nexamples { observation count() returns Number\nexample "one": count() => 1\nexample "two": count() => 2 }');
    await project.decisions({ format: 1, matches: [{ id: parameter, to: { source: 'main.expec', line: 3, column: 19 } }], retire: [] });
    await project.implementDriverMethod('CountsDriver', 'count', 'return "many";');
    await project.runNative(['build', '--config', 'spec/expec.json', '--decisions', 'changes.json', '--json']);
    project.expectExit(1); project.expectStage('contracts', 'applied'); project.expectStage('tests', 'stopped');
    project.expectProblem('typescript-2322');
    await project.expectIdentity('Editor.save.document', parameter);
    await project.expectMethodBody('Editor', 'save', 'void document;');
    await project.rememberDirectory('src');
    const repaired = 'return 1;';
    await project.implementDriverMethod('CountsDriver', 'count', repaired);

    await project.runNative(['build', '--config', 'spec/expec.json', '--json']);

    project.expectExit(0); project.expectStage('tests', 'applied');
    await project.expectRememberedDirectoryUnchanged('src');
    await project.expectDriverMethodBody('CountsDriver', 'count', repaired);
    await project.expectGeneratedExampleNames(['one', 'two']);
    await project.rememberAllBytes();
    await project.runNative(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(0); await project.expectAllBytesUnchanged();
    project.expectNoNativeExecution();
  }, 300_000);
  it('retains the transition in the stage journal before identity confirmation', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'concept Editor {}');
    await project.registerOutputs([{ id: 'contracts', stage: 'contracts', file: 'contracts.txt', text: 'editor contract' },
      { id: 'checks', stage: 'tests', file: 'tests.txt', text: 'editor expectations' }]);
    await project.outputs([{ id: 'contracts', options: {} }, { id: 'checks', options: {} }]);
    project.failActualWrite('.expec/identity.json');
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(1); project.expectProblem('unconfirmed-state');
    await project.expectTransitionRetained(); await project.expectPendingBuildRetained();
    await project.expectNoDestinationFile('project/.expec/identity.json');

    project.clearActualWriteFailure();
    await project.run(['build', '--config', 'spec/expec.json', '--json']);

    project.expectExit(0);
    await project.expectDestinationText('project/contracts.txt', 'editor contract');
    await project.expectDestinationText('project/tests.txt', 'editor expectations');
    await project.expectNoPendingBuild(); await project.expectNoTransition();
  }, 60_000);

  it('finishes cleanup after the final stage removed its transition', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'concept Editor {}');
    await project.registerOutputs([{ id: 'contracts', stage: 'contracts', file: 'contracts.txt', text: 'editor contract' },
      { id: 'checks', stage: 'tests', file: 'tests.txt', text: 'editor expectations' }]);
    await project.outputs([{ id: 'contracts', options: {} }, { id: 'checks', options: {} }]);
    project.failPendingRemoval(1);
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(1); project.expectStage('tests', 'applied');
    await project.expectPendingBuildRetained(); await project.expectNoTransition();
    await project.rememberIdentities();

    project.clearActualWriteFailure();
    await project.run(['build', '--config', 'spec/expec.json', '--json']);

    project.expectExit(0); await project.expectIdentitiesUnchanged();
    await project.expectNoPendingBuild(); await project.expectNoTransition();
    await project.expectDestinationText('project/tests.txt', 'editor expectations');
  }, 60_000);

  it('reserves the retained transition path from output writes', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'concept Editor {}');
    await project.registerOutputs([{ id: 'intruder', stage: 'contracts', file: '.expec/build-transition.json', text: '{}' }]);
    await project.outputs([{ id: 'intruder', options: {} }]);

    await project.run(['build', '--config', 'spec/expec.json', '--json']);

    project.expectExit(1); project.expectProblem('output-path-conflict');
    await project.expectNoTransition(); await project.expectNoPendingBuild();
  }, 30_000);});
