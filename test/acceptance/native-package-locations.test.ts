import { it } from 'vitest';
import { NativePackageExamples } from '../dsl/native-packages.js';

it('installs packages when the project parent contains a UUID', async () => {
  const packages = await NativePackageExamples.inDirectory('workspace-ac9f7484-6445-4166-82d0-d154b34699f2');
  await packages.publishLocalFixture('example-storage', '2.1.0');
  packages.require('storage', 'npm:example-storage', '^2', ['runtime']);
  await packages.install();
  packages.expectVersions('npm:example-storage', { requested: '^2', selected: '2.1.0', installed: '2.1.0' });
  packages.expectAvailability([{ name: 'npm:example-storage', version: '2.1.0' }]);
  await packages.importInstalledFixture('example-storage');
  packages.expectFixtureValue('storage-ready');
});

it('reads an installed scoped package offline in that same folder shape', async () => {
  const packages = await NativePackageExamples.inDirectory('workspace-ac9f7484-6445-4166-82d0-d154b34699f2');
  await packages.publishLocalFixture('@book/store', '2.1.0');
  packages.require('store', 'npm:@book/store', '^2', ['runtime']);
  await packages.install();
  packages.expectAvailability([{ name: 'npm:@book/store', version: '2.1.0' }]);
  await packages.read();
  packages.expectVersions('npm:@book/store', { requested: '^2', selected: '2.1.0', installed: '2.1.0' });
  packages.expectAvailability([{ name: 'npm:@book/store', version: '2.1.0' }]);
  packages.expectNoInstallOrRegistryRequestDuringRead();
});

it('retains an unrelated invalid native dependency while observing valid requested storage', async () => {
  const packages = await NativePackageExamples.create();
  await packages.publishLocalFixture('example-storage', '2.1.0');
  await packages.publishLocalFixture('unrelated', '1.0.0');
  await packages.nativeManifest({ private: true, dependencies: { unrelated: '^1' } });
  packages.require('storage', 'npm:example-storage', '^2', ['runtime']);
  await packages.install();
  packages.expectAvailability([{ name: 'npm:example-storage', version: '2.1.0' }]);
  await packages.nativeManifest({ private: true, dependencies: { 'example-storage': '^2', unrelated: '^2' } });
  await packages.read();
  packages.expectVersions('npm:example-storage', { requested: '^2', selected: '2.1.0', installed: '2.1.0' });
  packages.expectProblem('native-package-read-failed');
  packages.expectNoAvailability();
  packages.expectNoInstallOrRegistryRequestDuringRead();
}, 60_000);

it('keeps a lock selection distinct from installation in a UUID folder', async () => {
  const packages = await NativePackageExamples.inDirectory('workspace-ac9f7484-6445-4166-82d0-d154b34699f2');
  await packages.publishLocalFixture('example-storage', '2.1.0');
  packages.require('storage', 'npm:example-storage', '^2', ['runtime']);
  await packages.selectWithActualNpmWithoutInstalling();
  await packages.read();
  packages.expectVersions('npm:example-storage', { requested: '^2', selected: '2.1.0' });
  packages.expectProblem('package-not-installed');
  packages.expectNoAvailability();
  packages.expectNoInstallOrRegistryRequestDuringRead();
});
