import childProcess from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { vi } from 'vitest';
import { readPackages } from '../../../src/cli/cli-packages.js';
import { ConfigurationReader, type Configuration } from '../../../src/project/connection/configuration.js';
import { NpmDependencies, type PackageRead } from '../../../src/project/dependencies/npm-dependencies.js';
import { ProjectFileCaptureDriver, type FileAcquisition, type FileFault } from '../project/connection/project-file-capture.js';

/** Tiny installed npm project: actual read-only admission, without registry or installation setup. */
export class CapturedPackagesDriver {
  readonly files = new ProjectFileCaptureDriver();
  readonly initial = new Map<string, string>();
  result: (PackageRead & { inputs?: { uri: string; version: string }[] }) | undefined;
  nativeStarts = 0;
  unchangedAfterInstall = false;
  collectionSettled = false;
  private collection: Promise<void> | undefined;
  private packages!: Configuration['packages'];
  private packagePath = '';
  private readonly restores: (() => void)[] = [];

  async setup(name: string, manifest: string): Promise<void> {
    this.packagePath = 'node_modules/' + name + '/package.json';
    const rootManifest = JSON.stringify({ name: 'capture-consumer', version: '1.0.0', private: true, dependencies: { [name]: '1.0.0' } });
    const lock = JSON.stringify({ name: 'capture-consumer', version: '1.0.0', lockfileVersion: 3, requires: true, packages: {
      '': { name: 'capture-consumer', version: '1.0.0', dependencies: { [name]: '1.0.0' } },
      ['node_modules/' + name]: { name, version: '1.0.0' },
    } });
    this.initial.set('package.json', rootManifest); this.initial.set('package-lock.json', lock); this.initial.set(this.packagePath, manifest);
    await this.files.setup(Object.fromEntries(this.initial)); this.files.phase = 'outer-initial';
    const configuration = new ConfigurationReader([]).read({ sourceId: 'capture-settings', text: JSON.stringify({ formatVersion: 1, version: '0.1.0',
      project: { root: this.files.root }, build: { entries: ['catalog.expec'] }, packages: [{ alias: name, name: 'npm:' + name, version: '1.0.0', phases: ['build'] }] }) });
    if (!configuration.value || configuration.problems.length || configuration.deferred.length) throw Error('Invalid authored package fixture.');
    this.packages = configuration.value.packages;
    const read = NpmDependencies.prototype.read, driver = this;
    const reading = vi.spyOn(NpmDependencies.prototype, 'read').mockImplementation(async function (this: NpmDependencies, ...args) {
      driver.files.phase = 'native';
      try { return await Reflect.apply(read, this, args); } finally { driver.files.phase = 'outer-final'; }
    });
    this.restores.push(() => reading.mockRestore());
    const spawn = childProcess.spawn.bind(childProcess);
    const starting = vi.spyOn(childProcess, 'spawn').mockImplementation((...args) => { this.nativeStarts++; return Reflect.apply(spawn, childProcess, args); });
    this.restores.push(() => starting.mockRestore());
  }
  status(phase: 'outer-initial' | 'outer-final' | 'native-admission' | 'native-verification'): void {
    this.files.arm(this.packagePath, 'status', acquisition => this.matches(acquisition, phase));
  }
  fault(fault: FileFault, replacement?: string): void { this.files.arm(this.packagePath, fault, acquisition => acquisition.phase === 'outer-initial', replacement); }
  rootStatus(install = false): void {
    this.files.arm('package.json', 'status', acquisition => acquisition.phase === (install ? 'install' : 'native'));
  }
  lockStatus(): void { this.files.arm('package-lock.json', 'status', acquisition => acquisition.phase === 'native'); }
  pauseRootRead(): void { this.files.pauseBody('package.json'); }
  packageMtimeChanges(): void { this.fault('mtime'); }
  releaseRootRead(): void { this.files.releasePausedBody(); }
  async waitForPackageRefusal(): Promise<unknown> {
    await this.files.waitForPausedBody();
    const error = await this.files.waitForRefusal(this.packagePath, 'outer-initial');
    // One event-loop turn drains propagation from the actual rejected acquisition to the caller promise.
    await new Promise<void>(resolve => setImmediate(resolve));
    return error;
  }
  private matches(acquisition: FileAcquisition, phase: string): boolean {
    if (phase === 'outer-initial' || phase === 'outer-final') return acquisition.phase === phase;
    if (acquisition.phase !== 'native') return false;
    const previous = this.files.acquisitions.filter(record => record.phase === 'native' && record.path === this.packagePath).length;
    return previous === (phase === 'native-admission' ? 0 : 1);
  }
  collect(): Promise<void> {
    this.collectionSettled = false;
    this.collection = readPackages(this.files.files.root, this.packages).then(result => { this.result = result; })
      .finally(() => { this.files.markReturn(); this.collectionSettled = true; });
    return this.collection;
  }
  async install(): Promise<void> {
    this.files.phase = 'install';
    const before = await this.tree();
    this.result = await new NpmDependencies(this.files.root).install(this.packages); this.files.markReturn();
    this.unchangedAfterInstall = JSON.stringify(await this.tree()) === JSON.stringify(before);
  }
  private async tree(): Promise<{ path: string; kind: string; bytes?: string }[]> {
    const rows: { path: string; kind: string; bytes?: string }[] = [];
    const visit = async (absolute: string, path: string): Promise<void> => {
      const info = await fs.lstat(absolute);
      if (info.isSymbolicLink()) { rows.push({ path, kind: 'link', bytes: await fs.readlink(absolute) }); return; }
      if (info.isFile()) { rows.push({ path, kind: 'file', bytes: (await fs.readFile(absolute)).toString('base64') }); return; }
      rows.push({ path, kind: info.isDirectory() ? 'directory' : 'other' });
      if (info.isDirectory()) for (const name of (await fs.readdir(absolute)).sort()) await visit(join(absolute, name), path ? path + '/' + name : name);
    };
    await visit(this.files.root, ''); return rows;
  }
  async dispose(): Promise<void> {
    this.releaseRootRead(); await this.collection;
    for (const restore of this.restores.reverse()) restore(); await this.files.dispose();
  }
}
