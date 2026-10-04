import { afterEach, beforeAll, describe, it } from 'vitest';
import { ConnectedBuild } from '../dsl/connected-build.js';

describe('building selected contracts', () => {
  let project: ConnectedBuild;
  beforeAll(() => ConnectedBuild.prepare(), 90_000);
  afterEach(async () => { if (project) await project.dispose(); });

  it('writes the selected contracts into the manifest project from another cwd', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'concept StoreGame {\n  public save\n  capability save() returns Nothing\n}\n');
    await project.outputs([{ id: 'typescript', options: { directory: 'src' } }, { id: 'markdown', options: { directory: 'docs' } }]);
    await project.runFrom('unrelated', ['build', '--config', '../spec/expec.json', '--json']);
    project.expectExit(0);
    await project.expectNativeMethod('StoreGame', 'save', 'void');
    await project.expectDocumentation('StoreGame', 'save() returns Nothing');
    await project.expectNoOutputUnder('unrelated');
    project.expectNoNativeExecution();
  }, 60_000);

  it('reports a throwing scaffold as unfinished behavior after a successful build', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'function save() returns Nothing\n');
    await project.outputs([{ id: 'typescript', options: { directory: 'src' } }]);
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(0);
    project.expectStatus('built');
    project.expectObligation('implementation-required', 'save');
    await project.expectNativeInvocationThrows('save', 'Not implemented');
    project.expectNoNativeExecution();
  }, 60_000);

  it('reports actual retained implementations without an unfinished-body claim', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'concept StoreGame { capability save() returns Nothing }');
    await project.outputs([{ id: 'typescript', options: { directory: 'src' } }]);
    await project.run(['build', '--config', 'spec/expec.json', '--json']); project.expectExit(0);
    project.expectObligation('implementation-required', 'save');
    await project.implementMethod('StoreGame', 'save', 'console.log("saved");');
    await project.run(['build', '--config', 'spec/expec.json', '--json']); project.expectExit(0);
    project.expectNoObligations(); await project.expectMethodBody('StoreGame', 'save', 'console.log("saved");');
  }, 60_000);

  it('prints the connected destination, actual written path and unfinished work for a human', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'function save() returns Nothing');
    await project.outputs([{ id: 'typescript', options: { directory: 'src' } }]);
    await project.run(['build', '--config', 'spec/expec.json']); project.expectExit(0);
    project.expectReportedProjectRoot(); project.expectMessageContains('src/save.ts');
    project.expectMessageContains('implementation-required'); project.expectMessageContains('save');
  }, 60_000);

  it('does not allocate identities or rewrite files for an unchanged build', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'concept StoreGame {\n  public save\n  capability save() returns Nothing\n}\n');
    await project.outputs([{ id: 'typescript', options: { directory: 'src' } }]);
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(0);
    await project.rememberIdentities();
    await project.rememberAllBytes();
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(0);
    project.expectStage('contracts', 'unchanged');
    await project.expectIdentitiesUnchanged();
    await project.expectAllBytesUnchanged();
    await project.expectNoPendingBuild();
  }, 60_000);

  it('keeps identity across an authored version change', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'concept StoreGame {\n  public save\n  capability save() returns Nothing\n}\n');
    await project.outputs([{ id: 'typescript', options: { directory: 'src' } }]);
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(0);
    await project.rememberIdentities();
    await project.version('0.2.0');
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(0);
    project.expectReportedVersion('0.2.0');
    await project.expectIdentitiesUnchanged();
    await project.expectNativeMethod('StoreGame', 'save', 'void');
  }, 60_000);

  it('requires explicit rename correspondence and then preserves the implementation', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'concept StoreGame {\n  public save\n  capability save() returns Nothing\n}\n');
    await project.outputs([{ id: 'typescript', options: { directory: 'src' } }]);
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(0);
    const saveId = await project.identity('StoreGame.save');
    await project.implementMethod('StoreGame', 'save', 'console.log("saved game");');
    await project.source('main.expec', 'concept StoreGame {\n  public saveGame\n  capability saveGame() returns Nothing\n}\n');
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(3);
    project.expectProblem('identity-correspondence');
    await project.expectNativeMethod('StoreGame', 'save', 'void');
    await project.decisions({ format: 1, matches: [{ id: saveId, to: { source: 'main.expec', line: 3, column: 3 } }], retire: [] });
    await project.run(['build', '--config', 'spec/expec.json', '--decisions', 'changes.json', '--json']);
    project.expectExit(0);
    await project.expectMethodBody('StoreGame', 'saveGame', 'console.log("saved game");');
    await project.expectIdentity('StoreGame.saveGame', saveId);
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(0);
    project.expectStage('contracts', 'unchanged');
  }, 100_000);

  it('keeps Unicode scalar coordinates in an explicit rename decision', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'type `📚` { title: Text }\n');
    await project.outputs([{ id: 'typescript', options: { directory: 'src', names: [{ declaration: ['📚'], name: 'Books' }] } }]);
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(0);
    const titleId = await project.identity('📚.title');
    await project.source('main.expec', 'type `📚` { name: Text }\n');
    await project.decisions({ format: 1, matches: [{ id: titleId, to: { source: 'main.expec', line: 1, column: 12 } }], retire: [] });
    await project.run(['build', '--config', 'spec/expec.json', '--decisions', 'changes.json', '--json']);
    project.expectExit(0);
    await project.expectIdentity('📚.name', titleId);
  }, 80_000);

  it('emits two independent roots without making their names globally visible', async () => {
    project = await ConnectedBuild.create();
    await project.entries(['left.expec', 'right.expec']);
    await project.outputs([{ id: 'typescript', options: { directory: 'src' } }]);
    await project.source('left.expec', 'type Left { value: Number }\n');
    await project.source('right.expec', 'type Right { value: Text }\n');
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(0);
    await project.expectNativeType('Left', { value: 'number' });
    await project.expectNativeType('Right', { value: 'string' });
    await project.source('right.expec', 'function copy(value: Left) returns Nothing\n');
    await project.rememberAllBytes();
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(1);
    await project.expectLocatedProblem('unresolved-reference', 'right.expec', 'Left');
    await project.expectAllBytesUnchanged();
  }, 60_000);
  it('shares an imported Book once across entries and their reordering', async () => {
    project = await ConnectedBuild.create();
    await project.entries(['left.expec', 'right.expec']);
    await project.outputs([{ id: 'typescript', options: { directory: 'src' } }]);
    await project.source('book.expec', 'type Book { title: Text }\n');
    await project.source('left.expec', 'use Book from "./book.expec"\nfunction left(book: Book) returns Nothing\n');
    await project.source('right.expec', 'use Book from "./book.expec"\nfunction right(book: Book) returns Nothing\n');
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(0);
    const bookId = await project.identity('Book');
    await project.expectNativeType('Book', { title: 'string' });
    await project.entries(['right.expec', 'left.expec']);
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(0);
    await project.expectIdentity('Book', bookId);
    await project.expectNativeType('Book', { title: 'string' });
  }, 90_000);

  it('does not partially build when a later entry is invalid', async () => {
    project = await ConnectedBuild.create();
    await project.entries(['left.expec', 'right.expec']);
    await project.outputs([{ id: 'typescript', options: { directory: 'src' } }]);
    await project.source('left.expec', 'concept Left {}\n');
    await project.source('right.expec', 'concept Right { public saveGame\ncapability save() returns Nothing }\n');
    await project.rememberAllBytes();
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(1);
    await project.expectLocatedProblem('unresolved-reference', 'right.expec', 'saveGame');
    await project.expectAllBytesUnchanged();
  }, 40_000);

  it('does not confirm retirement while handwritten behavior prevents removal', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'concept StoreGame { public save\ncapability save() returns Nothing }\n');
    await project.outputs([{ id: 'typescript', options: { directory: 'src' } }]);
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(0);
    const saveId = await project.identity('StoreGame.save');
    await project.implementMethod('StoreGame', 'save', 'console.log("saved game");');
    await project.rememberIdentities();
    await project.source('main.expec', 'concept StoreGame {}\n');
    await project.decisions({ format: 1, matches: [], retire: [saveId] });
    await project.run(['build', '--config', 'spec/expec.json', '--decisions', 'changes.json', '--json']);
    project.expectExit(1);
    project.expectProblem('handwritten-removal');
    await project.expectMethodBody('StoreGame', 'save', 'console.log("saved game");');
    await project.expectIdentitiesUnchanged();
    await project.expectIdentity('StoreGame.save', saveId);
    await project.expectNoPendingBuild();
  }, 90_000);

  it('retains unselected documentation and catches it up when selected again', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'concept StoreGame { public save\ncapability save() returns Nothing }\n');
    const typescript = { id: 'typescript', options: { directory: 'src' } }, markdown = { id: 'markdown', options: { directory: 'docs' } };
    await project.outputs([typescript, markdown]);
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(0);
    const storeId = await project.identity('StoreGame');
    await project.rememberDirectory('docs');
    await project.outputs([typescript]);
    await project.source('main.expec', 'concept StoreGame { public save, reset\ncapability save() returns Nothing\ncapability reset() returns Nothing }\n');
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(0);
    await project.expectRememberedDirectoryUnchanged('docs');
    await project.outputs([typescript, markdown]);
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(0);
    await project.expectDocumentation('StoreGame', 'reset() returns Nothing');
    await project.expectIdentity('StoreGame', storeId);
  }, 100_000);

  it('does not replace corrupt identity with an unrelated history', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'concept StoreGame {}\n');
    await project.outputs([{ id: 'typescript', options: { directory: 'src' } }]);
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(0);
    await project.file('.expec/identity.json', '{"format":999}');
    await project.rememberAllBytes();
    await project.run(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(1);
    project.expectProblem('identity-format');
    await project.expectAllBytesUnchanged();
  }, 60_000);

});
