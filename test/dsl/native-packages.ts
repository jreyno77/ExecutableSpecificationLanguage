import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, onTestFinished } from 'vitest';
import type { Configuration, PackageObservation } from '../../src/index.js';
import { NativePackageDriver } from '../driver/native-packages.js';

export class NativePackageExamples {
  private constructor(readonly driver: NativePackageDriver) {}
  static async create(kind: 'project' | 'empty' | 'absent' = 'project'): Promise<NativePackageExamples> {
    const driver = new NativePackageDriver(); await driver.initialize(kind); onTestFinished(() => driver.dispose());
    return new NativePackageExamples(driver);
  }
  static withAbsentDirectory() { return this.create('absent'); }
  static withEmptyDirectory() { return this.create('empty'); }
  static async withInstalled(name: string, version: string, range?: string): Promise<NativePackageExamples> {
    const project = await this.create(); await project.driver.seed(name, version, range); return project;
  }
  static async withInstalledDevDependency(name: string, version: string, range: string): Promise<NativePackageExamples> {
    const project = await this.create(); await project.driver.seed(name, version, range, true); return project;
  }
  require(alias: string, name: string, range: string, phases: Configuration['packages'][number]['phases']) { this.driver.require(alias, name, range, phases); }
  publishLocalFixture(name: string, version: string) { return this.driver.publish(name, version); }
  publishFixtureWithInstallCanary(name: string, version: string, canary: string) { return this.driver.publish(name, version, canary); }
  nativeManifest(manifest: object) { return this.driver.setManifest(manifest); }
  selectWithActualNpmWithoutInstalling() { return this.driver.select(); }
  read() { return this.driver.read(); }
  install() { return this.driver.install(); }
  importInstalledFixture(name: string) { return this.driver.importFixture(name); }
  replaceInstalledFixture(name: string, version: string) { return this.driver.replace(name, { version }); }
  changeInstalledManifestName(name: string, actual: string) { return this.driver.replace(name, { name: actual }); }
  async registryRespondsNotFound(name: string) { expect(this.driver.packages.has(name)).toBe(false); }
  expectVersions(name: string, versions: Omit<PackageObservation, 'name'>) {
    expect(this.driver.result.packages.find(item => item.name === name), JSON.stringify(this.driver.result)).toEqual({ name, ...versions });
  }
  expectAvailability(items: { name: string; version: string }[]) {
    expect(this.driver.result.problems).toEqual([]); expect(this.driver.result.deferred).toEqual([]); expect(this.driver.result.value).toEqual(items);
  }
  expectObservations(items: PackageObservation[]) { expect(this.driver.result.packages).toEqual(items); }
  expectNoAvailability() { expect(this.driver.result.value).toBeUndefined(); }
  expectProblem(code: string) { expect(this.driver.result.problems, JSON.stringify(this.driver.result)).toEqual(expect.arrayContaining([expect.objectContaining({ code })])); }
  expectProblemMentions(...texts: string[]) { for (const text of texts) expect(this.driver.result.problems.map(item => item.message).join('\n')).toContain(text); }
  expectNoNativeProcess() { expect(this.driver.spawned).not.toHaveBeenCalled(); }
  expectNoNativeInstall() { expect(this.driver.spawned.mock.calls.some(call => (call[1] as string[] | undefined)?.some(arg => arg === 'install'))).toBe(false); }
  async expectDestinationAbsent() { await expect(access(this.driver.root)).rejects.toMatchObject({ code: 'ENOENT' }); }
  expectNoInstallOrRegistryRequestDuringRead() { this.expectNoNativeInstall(); expect(this.driver.requests).toHaveLength(this.driver.requestCount); this.expectProjectUnchanged(); }
  expectNativeLockVersion(name: string, version: string) { expect(this.driver.lock.packages?.['node_modules/' + name]?.version).toBe(version); }
  expectFixtureValue(value: unknown) { expect(this.driver.fixtureValue).toEqual(value); }
  expectInstalledPackageStillExists(name: string, version: string) { expect(this.driver.installed[name]).toMatchObject({ name, version }); }
  expectNativeDependency(group: string, name: string, version: string) { expect(this.driver.manifest[group]?.[name]).toBe(version); }
  expectNoNativeDependency(group: string, name: string) { expect(this.driver.manifest[group]?.[name]).toBeUndefined(); }
  expectNativeManifestFields(fields: object) { expect(this.driver.manifest).toMatchObject(fields); }
  expectNativeLockUnchanged() { expect(this.driver.initialLock).toBeDefined(); expect(this.driver.currentLock).toBe(this.driver.initialLock); }
  expectProjectUnchanged() { expect(this.driver.after).toEqual(this.driver.before); }
  expectObservationsMatchActualInstalledFiles() {
    expect(this.driver.result.packages.length).toBeGreaterThan(0);
    for (const item of this.driver.result.packages) expect(item.installed).toBe(this.driver.installed[item.name.slice(4)]?.version);
  }
  expectNoRollbackClaim() { expect(Object.keys(this.driver.result).sort()).toEqual(['deferred', 'packages', 'problems']); }
  expectInstalledVersion(name: string, version: string) { this.expectInstalledPackageStillExists(name, version); }
  async expectFileAbsent(file: string) { await expect(access(join(this.driver.root, file))).rejects.toMatchObject({ code: 'ENOENT' }); }
  expectNoRuntimeOrLifecycleSuccessClaim() { expect(Object.keys(this.driver.result).sort()).toEqual(['deferred', 'packages', 'problems', 'value']); }
}
