import { afterEach, beforeAll, describe, it } from 'vitest';
import { ConnectedBuild } from '../../dsl/cli/connected-build.js';

async function givenAppliedConfirmationOnlyRefresh(): Promise<ConnectedBuild> {
  const project = await ConnectedBuild.create();
  await project.nativeAcceptance();
  await project.source('main.expec', 'examples { observation count() returns Number\nexample "one": count() => 1 }');
  await project.outputs([{ id: 'acceptance', options: { domain: 'counts', configFile: 'tsconfig.json' } }]);
  await project.runNative(['build', '--config', 'spec/expec.json', '--json']);
  project.expectExit(0);
  await project.implementDriverMethod('CountsDriver', 'count', 'return 1;');
  project.failPendingRemoval();
  await project.runNative(['build', '--config', 'spec/expec.json', '--json']);
  project.expectExit(1);
  await project.expectPendingConfirmationOnly();
  project.clearActualWriteFailure();
  return project;
}

describe('continuing after completed acceptance bookkeeping', () => {
  let project: ConnectedBuild;
  beforeAll(() => ConnectedBuild.prepare(), 90_000);
  afterEach(async () => { if (project) await project.dispose(); });

  it('preserves later handwriting after an applied confirmation-only refresh', async () => {
    project = await givenAppliedConfirmationOnlyRefresh();
    await project.implementDriverMethod('CountsDriver', 'count', 'return 2;');
    await project.rememberIdentities();

    await project.runNative(['build', '--config', 'spec/expec.json', '--json']);

    project.expectExit(0);
    await project.expectDriverMethodBody('CountsDriver', 'count', 'return 2;');
    await project.expectGeneratedExampleNames(['one']);
    await project.expectIdentitiesUnchanged();
    await project.expectNoPendingBuild();
    project.expectNoNativeExecution();
  }, 180_000);

  it('freshly plans current source after cancellation follows completed cleanup', async () => {
    project = await givenAppliedConfirmationOnlyRefresh();
    await project.rememberIdentities();
    project.cancelAfterPendingRemoval();

    await project.runNative(['build', '--config', 'spec/expec.json', '--json']);

    project.expectExit(130);
    project.expectStoppedCleanupWithAppliedRemoval();
    await project.expectNoPendingBuild();
    await project.expectIdentitiesUnchanged();
    await project.source('main.expec', 'examples { observation count() returns Number\nexample "one": count() => 1\nexample "two": count() => 2 }');
    project.clearActualWriteFailure();

    await project.runNative(['build', '--config', 'spec/expec.json', '--json']);

    project.expectExit(0);
    await project.expectGeneratedExampleNames(['one', 'two']);
    await project.expectDriverMethodBody('CountsDriver', 'count', 'return 1;');
    await project.expectNoPendingBuild();
    project.expectNoNativeExecution();
  }, 180_000);

  it('plans newer authored examples after retiring completed bookkeeping', async () => {
    project = await givenAppliedConfirmationOnlyRefresh();
    await project.source('main.expec', 'examples { observation count() returns Number\nexample "one": count() => 1\nexample "two": count() => 2 }');

    await project.source('extra.expec', 'type ExtraExamples {}\nexamples for ExtraExamples { observation anotherCount() returns Number\nexample "three": anotherCount() => 3 }');
    await project.entries(['main.expec', 'extra.expec']);

    await project.runNative(['build', '--config', 'spec/expec.json', '--json']);

    project.expectExit(0);
    await project.expectGeneratedExampleNames(['one', 'two', 'three'], { inAnyFileOrder: true });
    await project.expectDriverMethodBody('CountsDriver', 'count', 'return 1;');
    await project.expectNoPendingBuild();
    project.expectNoNativeExecution();
  }, 180_000);
});
