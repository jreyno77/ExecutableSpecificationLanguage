import { afterEach, beforeAll, describe, it } from 'vitest';
import { ConnectedBuild } from '../../dsl/cli/connected-build.js';

describe('connected outputs with declared capture boundaries', () => {
  let project: ConnectedBuild;
  beforeAll(() => ConnectedBuild.prepare(), 90_000);
  afterEach(async () => { if (project) await project.dispose(); });

  it('preserves application code diagrams and acceptance assertions when unrelated artifacts are excluded', async () => {
    project = await ConnectedBuild.create();
    await project.source('main.expec', 'concept Library { public count\ncapability count() returns Number }\nexamples { observation count() returns Number\nexample "one book": count() => 1 }');
    await project.nativeAcceptance();
    await project.outputs([
      { id: 'typescript', options: { directory: 'src', configFile: 'tsconfig.source.json' } },
      { id: 'uml', options: { directory: 'diagrams' } },
      { id: 'acceptance', options: { domain: 'books', configFile: 'tsconfig.json' } },
    ]);
    await project.file('dist/bundle.txt', 'Unrelated compiled application.');
    await project.file('.local-docs/note.txt', 'Keep this private delivery note.');
    await project.file('generation/tooling/archive.bin', 'Keep this SDK archive.');
    await project.runNative(['build', '--config', 'spec/expec.json', '--json']);
    project.expectExit(0);
    await project.expectGeneratedExampleNames(['one book']);
    await project.expectDiagramLabels(['Library', 'count']);

    await project.implementMethod('Library', 'count', 'return 1;');
    await project.implementDriverMethod('BooksDriver', 'count', 'return 1;');
    await project.rememberDirectory('src');
    await project.rememberDirectory('test');
    await project.rememberDirectory('diagrams');
    await project.excludePaths(['dist', '.local-docs', 'generation/tooling']);

    await project.runNative(['build', '--config', 'spec/expec.json', '--json']);

    project.expectExit(0);
    await project.expectRememberedDirectoryUnchanged('src');
    await project.expectRememberedDirectoryUnchanged('test');
    await project.expectRememberedDirectoryUnchanged('diagrams');
    await project.expectMethodBody('Library', 'count', 'return 1;');
    await project.expectGeneratedExampleNames(['one book']);
    await project.expectDiagramLabels(['Library', 'count']);
    await project.expectDestinationText('project/dist/bundle.txt', 'Unrelated compiled application.');
    await project.expectDestinationText('project/.local-docs/note.txt', 'Keep this private delivery note.');
    await project.expectDestinationText('project/generation/tooling/archive.bin', 'Keep this SDK archive.');
    project.expectNoNativeExecution();
  }, 180_000);
});
