import { afterEach, beforeEach, describe, it } from 'vitest';
import { PackageMetadata } from '../../dsl/cli/package-metadata.js';
describe('initial connected package metadata', () => {
  let metadata: PackageMetadata;
  beforeEach(async () => {
    metadata = await PackageMetadata.connected({
      'package.json': '{"name":"a","version":"1.0.0"}\n',
      'package-lock.json': '{"lockfileVersion":3}\n',
    }, { modifiedAt: '2020-01-01T00:00:00.000Z' });
  });
  afterEach(async () => { await metadata.dispose(); });

  it('admits an unchanged root manifest after one initial status settling read', async () => {
    metadata.onlyCtimeChanges('package.json', 'initial');
    await metadata.readRequestedPackages([]);
    metadata.expectMetadataInputs({
      'package.json': '{"name":"a","version":"1.0.0"}\n',
      'package-lock.json': '{"lockfileVersion":3}\n',
    });
    metadata.expectSettlingEvidence('package.json', { initialReads: 2, finalReads: 1 });
    metadata.expectClosedWithoutNativeProcess();
  });

  it('admits an unchanged root lock after one initial status settling read', async () => {
    metadata.onlyCtimeChanges('package-lock.json', 'initial');
    await metadata.readRequestedPackages([]);
    metadata.expectMetadataInputs({
      'package.json': '{"name":"a","version":"1.0.0"}\n',
      'package-lock.json': '{"lockfileVersion":3}\n',
    });
    metadata.expectSettlingEvidence('package-lock.json', { initialReads: 2, finalReads: 1 });
    metadata.expectClosedWithoutNativeProcess();
  });

  it('reads stable metadata once initially and once for strict final verification', async () => {
    await metadata.readRequestedPackages([]);
    metadata.expectMetadataInputs({
      'package.json': '{"name":"a","version":"1.0.0"}\n',
      'package-lock.json': '{"lockfileVersion":3}\n',
    });
    metadata.expectActualReads('package.json', { initial: 1, final: 1 });
    metadata.expectActualReads('package-lock.json', { initial: 1, final: 1 });
    metadata.expectClosedWithoutNativeProcess();
  });

  it('returns the fresh second observation to the initial-capture caller', async () => {
    metadata.onlyCtimeChanges('package.json', 'initial');
    await metadata.captureInitial('package.json');
    metadata.expectCapturedBytes('{"name":"a","version":"1.0.0"}\n');
    metadata.expectFreshInfoFromSecondRead();
    metadata.expectSettlingEvidence('package.json', { initialReads: 2, finalReads: 0 });
    metadata.expectClosedWithoutNativeProcess();
  });

  it('refuses equal-size different bytes even when both candidate and second tuples agree', async () => {
    metadata.replaceBetweenInitialReads('package.json', '{"name":"b","version":"1.0.0"}\n');
    await metadata.readRequestedPackages([]);
    metadata.expectComparedActualBodies([
      '{"name":"a","version":"1.0.0"}\n',
      '{"name":"b","version":"1.0.0"}\n',
    ]);
    metadata.expectEligibleFirstAndStableSecondTuples();
    metadata.expectRefused('stale-build-input');
    metadata.expectActualReads('package.json', { initial: 2, final: 0 });
    metadata.expectClosedWithoutNativeProcess();
  });

  it('refuses another ctime change in the strict second read without a third attempt', async () => {
    metadata.onlyCtimeChanges('package.json', 'initial-and-second');
    await metadata.readRequestedPackages([]);
    metadata.expectRefused('stale-build-input');
    metadata.expectActualReads('package.json', { initial: 2, final: 0 });
    metadata.expectClosedWithoutNativeProcess();
  });

  it('keeps default ProjectFiles.read strict for the same ctime-only event', async () => {
    metadata.onlyCtimeChanges('package.json', 'initial');
    await metadata.readStrict('package.json');
    metadata.expectDirectReadRefused('stale-project');
    metadata.expectActualReads('package.json', { initial: 1, final: 0 });
    metadata.expectClosedWithoutNativeProcess();
  });

  it('keeps later metadata verification strict after successful initial admission', async () => {
    metadata.onlyCtimeChanges('package.json', 'final-verification');
    await metadata.readRequestedPackages([]);
    metadata.expectStableInitialAdmission('package.json');
    metadata.expectRefused('stale-build-input');
    metadata.expectActualReads('package.json', { initial: 1, final: 1 });
    metadata.expectClosedWithoutNativeProcess();
  });

  it('refuses actual replacement between named-before and open without settling', async () => {
    metadata.replaceBeforeOpen('package.json');
    await metadata.readRequestedPackages([]);
    metadata.expectActualIdentityDisagreement('named-before', 'opened-before');
    metadata.expectRefused('stale-build-input');
    metadata.expectActualOpens('package.json', 1);
    metadata.expectClosedWithoutNativeProcess();
  });

  it('refuses named-after replacement even when the open descriptor has eligible ctime drift', async () => {
    metadata.replaceNameAfterInitialBody('package.json');
    await metadata.readRequestedPackages([]);
    metadata.expectEligibleDescriptorButDifferentNamedIdentity();
    metadata.expectRefused('stale-build-input');
    metadata.expectActualOpens('package.json', 1);
    metadata.expectClosedWithoutNativeProcess();
  });

  it('refuses an actual mode change while the first file body is read', async () => {
    metadata.changeModeAfterBody('package.json', 'read-only');
    await metadata.readRequestedPackages([]);
    metadata.expectActualChangedField('mode');
    metadata.expectRefused('stale-build-input');
    metadata.expectActualOpens('package.json', 1);
    metadata.expectClosedWithoutNativeProcess();
  });

  it('refuses an actual modified-time change while the first file body is read', async () => {
    metadata.changeModifiedTimeAfterBody('package.json', '2020-01-01T00:00:02.000Z');
    await metadata.readRequestedPackages([]);
    metadata.expectActualChangedField('mtimeNs');
    metadata.expectRefused('stale-build-input');
    metadata.expectActualOpens('package.json', 1);
    metadata.expectClosedWithoutNativeProcess();
  });

  it('refuses an actual size change while the first file body is read', async () => {
    metadata.appendAfterBody('package.json', ' ');
    await metadata.readRequestedPackages([]);
    metadata.expectActualChangedField('size');
    metadata.expectRefused('stale-build-input');
    metadata.expectActualOpens('package.json', 1);
    metadata.expectClosedWithoutNativeProcess();
  });

  it('refuses a stable equal-byte second read whose ctime differs from the settled candidate', async () => {
    metadata.secondCtimeDiffersFromCandidate('package.json');
    await metadata.readRequestedPackages([]);
    metadata.expectComparedActualBodies([
      '{"name":"a","version":"1.0.0"}\n',
      '{"name":"a","version":"1.0.0"}\n',
    ]);
    metadata.expectEligibleFirstAndStableSecondWithDifferentCtime();
    metadata.expectRefused('stale-build-input');
    metadata.expectActualReads('package.json', { initial: 2, final: 0 });
    metadata.expectPackageReaderEntered(0);
    metadata.expectClosedWithoutNativeProcess();
  });

  it('does not reopen after an eligible first read reports a close error despite physical closure', async () => {
    metadata.onlyCtimeChanges('package.json', 'initial');
    metadata.failFirstCloseAfterPhysicalClosure('package.json', { code: 'EIO', message: 'first close unavailable' });
    await metadata.readRequestedPackages([]);
    metadata.expectEligibleInitialCtime('package.json');
    metadata.expectSuccessfulBodies('package.json', 1);
    metadata.expectActualOpens('package.json', 1);
    metadata.expectPhysicalCloses('package.json', 1);
    metadata.expectRefused('stale-build-input', 'first close unavailable');
    metadata.expectPackageReaderEntered(0);
    metadata.expectClosedWithoutNativeProcess();
  });
  it('does not retry a second-read error and closes both owned descriptors', async () => {
    metadata.onlyCtimeChanges('package.json', 'initial');
    metadata.failSecondBody('package.json', { code: 'EIO', message: 'second body unavailable' });
    await metadata.readRequestedPackages([]);
    metadata.expectRefused('stale-build-input', 'second body unavailable');
    metadata.expectActualOpens('package.json', 2);
    metadata.expectSuccessfulBodies('package.json', 1);
    metadata.expectClosedWithoutNativeProcess();
  });

  it('waits for a held sibling descriptor to close before returning an initial refusal', async () => {
    metadata.holdLockBodyAndFailManifest({ code: 'EIO', message: 'manifest unavailable' });
    await metadata.readRequestedPackages([]);
    metadata.expectRefused('stale-build-input', 'manifest unavailable');
    metadata.expectReturnedWithOpenDescriptors(0);
    metadata.expectPackageReaderEntered(0);
    metadata.expectClosedWithoutNativeProcess();
  });

  it('reports the first authored failure after settlement rather than the first completion', async () => {
    metadata.failLockBeforeManifest({ lock: 'lock unavailable', manifest: 'manifest unavailable' });
    await metadata.readRequestedPackages([]);
    metadata.expectObservedFailureOrder(['package-lock.json', 'package.json']);
    metadata.expectRefused('stale-build-input', 'manifest unavailable');
    metadata.expectReturnedWithOpenDescriptors(0);
    metadata.expectPackageReaderEntered(0);
    metadata.expectClosedWithoutNativeProcess();
  });
});

