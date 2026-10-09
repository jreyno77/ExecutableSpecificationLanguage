import { beforeEach, describe, it } from 'vitest';
import { EditorBuildHost } from '../../dsl/cli/editor-build-host.js';

describe('editor-controlled connected generation', () => {
  let generation: EditorBuildHost;
  beforeEach(async () => { generation = await EditorBuildHost.create(); });

  it('a host receives the real configured build without global output capture', async () => {
    await generation.projectWithEntries('type Book { title: Text }', 'type Shelf { copies: Number }');
    await generation.buildWithHost();
    generation.expectExitCode(0);
    generation.expectReportedCommand('build', 'built');
    await generation.expectGeneratedDeclaration('Book');
    await generation.expectGeneratedDeclaration('Shelf');
    generation.expectProcessOutputUntouched();
  });

  it('an already cancelled host starts no acquisition or writes', async () => {
    await generation.projectWithEntries('type Book { title: Text }');
    generation.cancelBeforeBuild();
    await generation.buildWithHost();
    generation.expectExitCode(130);
    generation.expectReportedCommand('build', 'cancelled');
    await generation.expectCompleteProjectTreeUnchanged();
    generation.expectNoOutputProviderInvocations();
    generation.expectNoInputAcquisitions();
  });

  it('a dirty target introduced during planning blocks subsequent writes', async () => {
    await generation.projectWithEntries('type Book { title: Text }');
    generation.holdRealOutputPlanning();
    const building = generation.buildWithHost();
    await generation.awaitHeldPlan();
    generation.refuseCurrentWrites('src/Book.ts', 'Unsaved editor changes');
    generation.releasePlan();
    await building;
    generation.expectReportedProblem('dirty-editor-buffer', 'src/Book.ts');
    await generation.expectCompleteProjectTreeUnchanged();
  });

  it('a cancelled pending permission query does not apply its later approval', async () => {
    await generation.projectWithEntries('type Book { title: Text }');
    generation.holdWritePermission();
    const building = generation.buildWithHost();
    await generation.awaitHeldPermission();
    generation.cancelBuild();
    await building;
    generation.expectExitCode(130);
    await generation.expectCompleteProjectTreeUnchanged();
    generation.releasePermission();
    await generation.drainOwnedWork();
    await generation.expectCompleteProjectTreeUnchanged();
    generation.expectNoOutputProviderInvocations();
  });

  it('later clean generation preserves the handwritten implementation', async () => {
    generation.selectTypeScriptOutput();
    await generation.projectWithEntries('component Library { capability count() returns Number }');
    await generation.buildWithHost();
    await generation.keepImplementation('src/Library.ts', 'return 41;');
    await generation.replaceAuthored('component Library {\n capability count() returns Number\n capability title() returns Text\n}');
    await generation.buildWithHost();
    generation.expectExitCode(0);
    await generation.expectFileContains('src/Library.ts', 'title(): string');
    await generation.expectFileContains('src/Library.ts', 'return 41;');
  }, 30_000);

  it('a throwing result sink rejects once and releases its listeners', async () => {
    await generation.projectWithEntries('type Book { title: Text }');
    generation.throwOnResult('consumer sink failed');
    await generation.expectBuildRejects('consumer sink failed');
    generation.expectResultSinkInvocations(1);
    generation.expectOwnedListenerCount(0);
  });
});

