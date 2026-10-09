import { describe, it } from 'vitest';
import { CapturedPackages } from '../../dsl/cli/captured-packages.js';

describe('confirmed package admission', () => {
  it('package evidence confirms a status-only transition using two identical actual bodies', async () => {
    const packages = await CapturedPackages.withPackage('catalog', '{"name":"catalog","version":"1.0.0"}');
    packages.statusSettlesDuringPackageRead();
    await packages.collect();
    packages.expectSuppliedPackage('npm:catalog', '1.0.0');
    packages.expectConfirmedManifest('node_modules/catalog/package.json', '{"name":"catalog","version":"1.0.0"}');
  }, 30000);
  it('later package verification also confirms a single settled status change', async () => {
    const packages = await CapturedPackages.withPackage('catalog', '{"name":"catalog","version":"1.0.0"}');
    packages.statusSettlesDuringVerification();
    await packages.collect();
    packages.expectSuppliedPackage('npm:catalog', '1.0.0');
    packages.expectConfirmedManifest('node_modules/catalog/package.json', '{"name":"catalog","version":"1.0.0"}');
  }, 30000);
  it('different manifest bytes during confirmation remain refused', async () => {
    const packages = await CapturedPackages.withPackage('catalog', '{"name":"catalog","version":"1.0.0"}');
    packages.replaceDuringConfirmation('{"name":"catalog","version":"2.0.0"}');
    await packages.collect();
    packages.expectRefused('stale-build-input');
    packages.expectClosedDescriptors();
  }, 30000);
  it('another status transition during confirmation remains refused', async () => {
    const packages = await CapturedPackages.withPackage('catalog', '{"name":"catalog","version":"1.0.0"}');
    packages.statusChangesDuringBothReads();
    await packages.collect();
    packages.expectRefused('stale-build-input');
    packages.expectOnlyTwoBodiesInConfirmation();
  }, 30000);
  it('stable package evidence keeps one body read per guarded acquisition', async () => {
    const packages = await CapturedPackages.withPackage('catalog', '{"name":"catalog","version":"1.0.0"}');
    await packages.collect();
    packages.expectSuppliedPackage('npm:catalog', '1.0.0');
    packages.expectOneBodyReadPerAcquisition();
  }, 30000);
  it('native package admission also confirms the settled installed manifest', async () => {
    const packages = await CapturedPackages.withPackage('catalog', '{"name":"catalog","version":"1.0.0"}');
    packages.statusSettlesDuringNativeAdmission();
    await packages.collect();
    packages.expectSuppliedPackage('npm:catalog', '1.0.0');
    packages.expectConfirmedManifest('node_modules/catalog/package.json', '{"name":"catalog","version":"1.0.0"}');
  }, 30000);
  it('native package final verification confirms the same actual manifest bytes', async () => {
    const packages = await CapturedPackages.withPackage('catalog', '{"name":"catalog","version":"1.0.0"}');
    packages.statusSettlesDuringNativeVerification();
    await packages.collect();
    packages.expectSuppliedPackage('npm:catalog', '1.0.0');
    packages.expectConfirmedManifest('node_modules/catalog/package.json', '{"name":"catalog","version":"1.0.0"}');
  }, 30000);
  it('installation keeps its strict manifest acquisition', async () => {
    const packages = await CapturedPackages.withPackage('catalog', '{"name":"catalog","version":"1.0.0"}');
    packages.rootManifestStatusChangesDuringRead();
    await packages.install();
    packages.expectRefused('stale-project');
    packages.expectNoNativeInstallation();
    packages.expectClosedDescriptors();
  }, 30000);
  it('package capture confirms the actual root manifest', async () => {
    const packages = await CapturedPackages.withPackage('catalog', '{"name":"catalog","version":"1.0.0"}');
    packages.statusSettlesInRootManifest();
    await packages.collect();
    packages.expectSuppliedPackage('npm:catalog', '1.0.0');
    packages.expectConfirmedNativeAcquisition('package.json');
    packages.expectClosedDescriptors();
  }, 30000);
  it('package capture confirms the actual lockfile', async () => {
    const packages = await CapturedPackages.withPackage('catalog', '{"name":"catalog","version":"1.0.0"}');
    packages.statusSettlesInLockfile();
    await packages.collect();
    packages.expectSuppliedPackage('npm:catalog', '1.0.0');
    packages.expectConfirmedNativeAcquisition('package-lock.json');
    packages.expectClosedDescriptors();
  }, 30000);
  it('package refusal waits for already opened sibling capture to close', async () => {
    const packages = await CapturedPackages.withPackage('catalog', '{"name":"catalog","version":"1.0.0"}');
    packages.pauseRootManifestRead();
    packages.packageModificationTimeChangesDuringRead();
    const collected = packages.collect();
    await packages.expectCollectionPendingAfterPackageRefusal();
    packages.releaseRootManifestRead();
    await collected;
    packages.expectRefused('stale-build-input');
    packages.expectClosedDescriptors();
  }, 30000);
});
