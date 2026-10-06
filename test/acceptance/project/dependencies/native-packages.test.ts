import { describe, it } from 'vitest';
import { NativePackageExamples } from '../../../dsl/project/dependencies/native-packages.js';

describe('native requested, selected and installed versions remain distinct', () => {
  it('reads an empty requirement list without requiring a project or native command', async () => {
    const packages = await NativePackageExamples.withAbsentDirectory();
    await packages.read();
    packages.expectAvailability([]);
    packages.expectObservations([]);
    packages.expectNoNativeProcess();
    await packages.expectDestinationAbsent();
  });

  it('installs nothing for an empty requirement list without creating a project', async () => {
    const packages = await NativePackageExamples.withAbsentDirectory();
    await packages.install();
    packages.expectAvailability([]);
    packages.expectObservations([]);
    packages.expectNoNativeProcess();
    await packages.expectDestinationAbsent();
  });

  it('reports a native lock selection without pretending the package is installed', async () => {
    const packages = await NativePackageExamples.create();
    await packages.publishLocalFixture('example-storage', '2.1.0');
    packages.require('storage', 'npm:example-storage', '^2', ['runtime']);
    await packages.selectWithActualNpmWithoutInstalling();
    await packages.read();
    packages.expectVersions('npm:example-storage', { requested: '^2', selected: '2.1.0' });
    packages.expectProblem('package-not-installed');
    packages.expectNoAvailability();
    packages.expectNoInstallOrRegistryRequestDuringRead();
  });

  it('installs explicitly and returns only actual configured availability', async () => {
    const packages = await NativePackageExamples.create();
    await packages.publishLocalFixture('example-storage', '2.1.0');
    packages.require('storage', 'npm:example-storage', '^2', ['runtime']);
    await packages.install();
    packages.expectVersions('npm:example-storage', { requested: '^2', selected: '2.1.0', installed: '2.1.0' });
    packages.expectAvailability([{ name: 'npm:example-storage', version: '2.1.0' }]);
    packages.expectNativeLockVersion('example-storage', '2.1.0');
    await packages.importInstalledFixture('example-storage');
    packages.expectFixtureValue('storage-ready');
  });

  it('does not include an unrequested installed package in compiler availability', async () => {
    const packages = await NativePackageExamples.withInstalled('unrelated', '1.0.0');
    await packages.publishLocalFixture('example-storage', '2.1.0');
    packages.require('storage', 'npm:example-storage', '^2', ['runtime']);
    await packages.install();
    packages.expectAvailability([{ name: 'npm:example-storage', version: '2.1.0' }]);
    packages.expectInstalledPackageStillExists('unrelated', '1.0.0');
  });

  it('keeps runtime dependencies and build/test tools in native manifest groups', async () => {
    const packages = await NativePackageExamples.create();
    await packages.publishLocalFixture('example-storage', '2.1.0');
    await packages.publishLocalFixture('example-check', '3.0.0');
    packages.require('storage', 'npm:example-storage', '^2', ['runtime', 'test']);
    packages.require('checks', 'npm:example-check', '^3', ['build', 'test']);
    await packages.nativeManifest({ private: true, scripts: { build: 'my-build' }, custom: { keep: true } });
    await packages.install();
    packages.expectNativeDependency('dependencies', 'example-storage', '^2');
    packages.expectNativeDependency('devDependencies', 'example-check', '^3');
    packages.expectNativeManifestFields({ private: true, scripts: { build: 'my-build' }, custom: { keep: true } });
  });

  it('reuses the selected native version when a newer compatible release appears', async () => {
    const packages = await NativePackageExamples.withInstalled('example-storage', '2.1.0', '^2');
    await packages.publishLocalFixture('example-storage', '2.2.0');
    packages.require('storage', 'npm:example-storage', '^2', ['runtime']);
    await packages.install();
    packages.expectVersions('npm:example-storage', { requested: '^2', selected: '2.1.0', installed: '2.1.0' });
    packages.expectNativeLockUnchanged();
  });

  it('moves a package to runtime without upgrading a compatible native selection', async () => {
    const packages = await NativePackageExamples.withInstalledDevDependency('example-storage', '2.1.0', '^2');
    await packages.publishLocalFixture('example-storage', '2.2.0');
    packages.require('storage', 'npm:example-storage', '^2', ['runtime', 'test']);
    await packages.install();
    packages.expectNativeDependency('dependencies', 'example-storage', '^2');
    packages.expectNoNativeDependency('devDependencies', 'example-storage');
    packages.expectVersions('npm:example-storage', { requested: '^2', selected: '2.1.0', installed: '2.1.0' });
    packages.expectAvailability([{ name: 'npm:example-storage', version: '2.1.0' }]);
  });

  it('selects a new native version when the author deliberately changes the range', async () => {
    const packages = await NativePackageExamples.withInstalled('example-storage', '2.1.0', '^2');
    await packages.publishLocalFixture('example-storage', '3.0.0');
    packages.require('storage', 'npm:example-storage', '^3', ['runtime']);
    await packages.install();
    packages.expectNativeDependency('dependencies', 'example-storage', '^3');
    packages.expectVersions('npm:example-storage', { requested: '^3', selected: '3.0.0', installed: '3.0.0' });
    packages.expectAvailability([{ name: 'npm:example-storage', version: '3.0.0' }]);
  });

  it('does not silently choose between conflicting requirements for one native package', async () => {
    const packages = await NativePackageExamples.create();
    packages.require('old-storage', 'npm:example-storage', '^1', ['runtime']);
    packages.require('new-storage', 'npm:example-storage', '^2', ['runtime']);
    await packages.install();
    packages.expectProblem('conflicting-package-requirements');
    packages.expectNoNativeInstall();
    packages.expectProjectUnchanged();
  });

  it('does not initialize a native project as a side effect of acquisition', async () => {
    const packages = await NativePackageExamples.withEmptyDirectory();
    packages.require('storage', 'npm:example-storage', '^2', ['runtime']);
    await packages.install();
    packages.expectProblem('native-project-unavailable');
    packages.expectNoNativeInstall();
    packages.expectProjectUnchanged();
  });

  it('does not treat a failed native install as successful availability', async () => {
    const packages = await NativePackageExamples.create();
    packages.require('storage', 'npm:missing-storage', '^2', ['runtime']);
    await packages.registryRespondsNotFound('missing-storage');
    await packages.install();
    packages.expectProblem('package-install-failed');
    packages.expectNoAvailability();
    packages.expectNativeDependency('dependencies', 'missing-storage', '^2');
    packages.expectObservationsMatchActualInstalledFiles();
    packages.expectNoRollbackClaim();
  });

  it('keeps lifecycle scripts unexecuted during ordinary acquisition', async () => {
    const packages = await NativePackageExamples.create();
    await packages.publishFixtureWithInstallCanary('example-storage', '2.1.0', 'lifecycle-ran.txt');
    packages.require('storage', 'npm:example-storage', '^2', ['runtime']);
    await packages.install();
    packages.expectInstalledVersion('example-storage', '2.1.0');
    await packages.expectFileAbsent('lifecycle-ran.txt');
    packages.expectNoRuntimeOrLifecycleSuccessClaim();
  });

  it('does not call an installed version reproducible when the native lock disagrees', async () => {
    const packages = await NativePackageExamples.withInstalled('example-storage', '2.1.0', '^2');
    await packages.replaceInstalledFixture('example-storage', '2.2.0');
    packages.require('storage', 'npm:example-storage', '^2', ['runtime']);
    await packages.read();
    packages.expectVersions('npm:example-storage', { requested: '^2', selected: '2.1.0', installed: '2.2.0' });
    packages.expectProblem('package-selection-mismatch');
    packages.expectNoAvailability();
    packages.expectProjectUnchanged();
  });

  it('does not trust a cached native version after the actual package name changes', async () => {
    const packages = await NativePackageExamples.withInstalled('example-storage', '2.1.0', '^2');
    await packages.changeInstalledManifestName('example-storage', 'another-package');
    packages.require('storage', 'npm:example-storage', '^2', ['runtime']);
    await packages.read();
    packages.expectProblem('package-name-mismatch');
    packages.expectProblemMentions('example-storage', 'another-package');
    packages.expectNoAvailability();
    packages.expectProjectUnchanged();
  });

}, 60000);
