import { beforeEach, describe, it } from 'vitest';
import { EditorBuildHost } from '../../dsl/cli/editor-build-host.js';

describe('host admission to real build effects', () => {
  let generation: EditorBuildHost;
  beforeEach(async () => {
    generation = await EditorBuildHost.create();
    await generation.projectWithEntries('type Book { title: Text }');
  });

  it('refuses an invalid host callback field instead of accepting generation', async () => {
    generation.invalidWriteCallback();
    await generation.buildWithHost();
    generation.expectVisibleRefusal();
    await generation.expectCompleteProjectTreeUnchanged();
  });

  it('refuses a non-array permission response instead of approving writes', async () => {
    generation.returnInvalidPermission({ permitted: true });
    await generation.buildWithHost();
    generation.expectWritePermissionWasQueried();
    generation.expectVisibleRefusal();
    await generation.expectCompleteProjectTreeUnchanged();
  });

  it('refuses a malformed located diagnostic instead of approving writes', async () => {
    generation.returnInvalidPermission([{ code: 'dirty-editor-buffer', message: 'Unsaved editor changes', at: {}, related: [] }]);
    await generation.buildWithHost();
    generation.expectWritePermissionWasQueried();
    generation.expectVisibleRefusal();
    await generation.expectCompleteProjectTreeUnchanged();
  });

  it('retains a valid located refusal without unrelated cyclic or BigInt metadata', async () => {
    const metadata: Record<string, unknown> = { sequence: 1n };
    metadata.self = metadata;
    generation.returnInvalidPermission([{
      code: 'dirty-editor-buffer', message: 'Unsaved editor changes',
      at: { kind: 'dependency', path: ['project', 'src/Book.ts'], metadata },
      related: [], metadata,
    }]);
    await generation.buildWithHost();
    generation.expectWritePermissionWasQueried();
    generation.expectVisibleRefusal();
    generation.expectReportedProblem('dirty-editor-buffer', 'src/Book.ts');
    await generation.expectCompleteProjectTreeUnchanged();
  });
  it('reports a permission callback failure without applying files', async () => {
    generation.throwOnPermission('Editor state is unavailable');
    await generation.buildWithHost();
    generation.expectWritePermissionWasQueried();
    generation.expectVisibleRefusal();
    await generation.expectCompleteProjectTreeUnchanged();
  });

  it('retains the result callback supplied when the invocation started', async () => {
    generation.holdRealOutputPlanning();
    const building = generation.buildWithHost();
    await generation.awaitHeldPlan();
    generation.replaceResultSink();
    generation.releasePlan();
    await building;
    generation.expectReportedCommand('build', 'built');
    generation.expectResultSinkInvocations(1);
  });

  it('observes a late permission rejection without later output or writes', async () => {
    generation.holdWritePermission();
    const building = generation.buildWithHost();
    await generation.awaitHeldPermission();
    generation.cancelBuild();
    await building;
    generation.expectExitCode(130);
    const returned = generation.receivedOutput();
    await generation.rejectPermission('Editor query ended after cancellation');
    await generation.drainOwnedWork();
    generation.expectNoLateOutput(returned);
    await generation.expectCompleteProjectTreeUnchanged();
    generation.expectNoOutputProviderInvocations();
    generation.expectOwnedListenerCount(0);
  });
});

