import { afterEach, beforeAll, describe, it } from 'vitest';
import { ConnectedBuild } from '../../dsl/cli/connected-build.js';

describe('checking a connected specification', () => {
  let project: ConnectedBuild;
  beforeAll(() => ConnectedBuild.prepare(), 90_000);
  afterEach(async () => { if (project) await project.dispose(); });

  it('checks all source without changing the connected project', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'concept StoreGame {\n  public save\n  capability save() returns Nothing\n}\n');
    await project.file('notes.txt', 'handwritten notes');
    await project.file('vitest.config.ts', 'throw new Error("check must not execute native configuration");\n');
    await project.rememberAllBytes();

    await project.run(['check', '--config', 'spec/expec.json', '--json']);

    project.expectExit(0);
    project.expectStatus('checked');
    await project.expectAllBytesUnchanged();
    project.expectNoNativeExecution();
  }, 40_000);

  it('rejects saveGame when only save is declared before creating anything', async () => {
    project = await ConnectedBuild.create({ connected: false });
    await project.source('main.expec', 'concept StoreGame {\n  public saveGame\n  capability save() returns Nothing\n}\n');
    await project.rememberAllBytes();

    await project.run(['build', '--config', 'spec/expec.json', '--json']);

    project.expectExit(1);
    await project.expectLocatedProblem('unresolved-reference', 'main.expec', 'saveGame');
    project.expectNoInitializationPrompt();
    await project.expectAllBytesUnchanged();
  }, 40_000);

  it('rejects an unknown option rather than silently doing a different build', async () => {
    project = await ConnectedBuild.create();
    await project.rememberAllBytes();

    await project.run(['build', '--confg', 'other.json']);

    project.expectExit(2);
    project.expectMessageContains('--confg');
    await project.expectAllBytesUnchanged();
  }, 40_000);

  it('checks a later entry without lending names from an earlier entry', async () => {
    project = await ConnectedBuild.create({ connected: false });
    await project.entries(['left.expec', 'right.expec']);
    await project.source('left.expec', 'type Left { value: Number }\n');
    await project.source('right.expec', 'function copy(value: Left) returns Nothing\n');
    await project.rememberAllBytes();

    await project.run(['check', '--config', 'spec/expec.json', '--json']);

    project.expectExit(1);
    await project.expectLocatedProblem('unresolved-reference', 'right.expec', 'Left');
    await project.expectAllBytesUnchanged();
  }, 40_000);

  it('retains a source finding after an astral declaration name', async () => {
    project = await ConnectedBuild.create({ connected: false });
    await project.source('main.expec', 'type `📚` { item: Missing }\n');

    await project.run(['check', '--config', 'spec/expec.json', '--json']);

    project.expectExit(1);
    await project.expectLocatedProblem('unresolved-reference', 'main.expec', 'Missing');
  }, 40_000);
  it('reports a syntax error in the original later file', async () => {
    project = await ConnectedBuild.create({ connected: false });
    await project.entries(['left.expec', 'right.expec']);
    await project.source('left.expec', 'concept Left {}\n');
    await project.source('right.expec', 'concept Right {\n');

    await project.run(['check', '--config', 'spec/expec.json', '--json']);

    project.expectExit(1);
    project.expectSyntaxIn('right.expec');
    project.expectNoNativeExecution();
  }, 40_000);
});
