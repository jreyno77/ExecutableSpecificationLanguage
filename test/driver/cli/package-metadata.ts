import { AsyncLocalStorage } from 'node:async_hooks';
import childProcess from 'node:child_process';
import { promises as fs, lstatSync, mkdtempSync, realpathSync, type BigIntStats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { vi } from 'vitest';
import { readPackages } from '../../../src/cli/cli-packages.js';
import { ProjectConnector, type ProjectRoot } from '../../../src/project/connection/project-connection.js';
import type { Configuration } from '../../../src/project/connection/configuration.js';
import { ProjectFiles, type ObservedFile } from '../../../src/project/connection/project-files.js';
import { NpmDependencies } from '../../../src/project/dependencies/npm-dependencies.js';

export type MetadataPath = 'package.json' | 'package-lock.json';
export type StatusChange = 'initial' | 'initial-and-second' | 'final-verification' | 'anchor';
export type FileChange = 'before-open' | 'named-after' | 'mode' | 'mtime' | 'append' | 'bytes';
type ReadError = { code: 'EIO'; message: string };
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
export interface StatObservation { actual: BigIntStats; delivered: BigIntStats }
export interface MetadataRead {
  path: MetadataPath; number: number; initial: boolean; openOrder: number;
  before: StatObservation | undefined; opened?: StatObservation; after?: StatObservation; named?: StatObservation;
  body?: Buffer; readAttempts: number; physicallyClosed: boolean; closeAttempts: number; closeOrder?: number;
  settled: ReturnType<typeof gate>; stats: number;
}
type CaptureBoundary = { capture(path: string): Promise<ObservedFile> };
const statusOnly = (actual: BigIntStats, ctimeNs: bigint): BigIntStats =>
  Object.assign(Object.create(Object.getPrototypeOf(actual)) as BigIntStats, actual, { ctimeNs });

/** Finite faults on two actual metadata files. Successful bytes and FS operations are never substituted. */
export class PackageMetadataDriver {
  readonly parent = realpathSync.native(tmpdir());
  readonly directory = realpathSync.native(mkdtempSync(join(this.parent, 'expec-package-metadata-')));
  readonly rootPath = join(this.directory, 'project');
  private readonly directoryInfo = lstatSync(this.directory, { bigint: true });
  private readonly authored = new Map<MetadataPath, string>();
  readonly reads: MetadataRead[] = [];
  readonly statObservations: StatObservation[] = [];
  readonly failures: MetadataPath[] = [];
  selected: MetadataPath = 'package.json';
  status: StatusChange | undefined;
  change: FileChange | undefined;
  changedText = '';
  changedDate = '';
  firstCloseError: ReadError | undefined;
  secondBodyError: ReadError | undefined;
  heldSiblingError: ReadError | undefined;
  orderedFailures: { lock: string; manifest: string } | undefined;
  report: Awaited<ReturnType<typeof readPackages>> | undefined;
  captured: ObservedFile | undefined;
  directError: unknown;
  returnedOpen: number | undefined;
  packageReaderEntries = 0;
  nativeProcesses = 0;
  heldBodyReached = false;
  lockHeldAtManifestRefusal: boolean | undefined;
  private lockBodyHeld = false;
  private lockFallbackReleased = false;
  mutationPerformed = false;
  private root!: ProjectRoot;
  private readonly scope = new AsyncLocalStorage<PackageMetadataDriver>();
  private readonly active = new Map<MetadataPath, MetadataRead>();
  private readonly namedBefore = new Map<MetadataPath, StatObservation>();
  private readonly originals = { open: fs.open.bind(fs), lstat: fs.lstat.bind(fs) };
  private readonly restore: (() => void)[] = [];
  private readonly operations = new Set<Promise<unknown>>();
  private readonly acquisitions = new Set<Promise<ObservedFile>>();
  private readonly children = new Set<Promise<void>>();
  private readonly lockBody = gate();
  private readonly releaseLock = gate();
  private readonly lockClosed = gate();
  private readonly modifiedAt: Date;
  private hooked = false;
  private disposed = false;
  private order = 0;
  private drain: NodeJS.Timeout | undefined;

  constructor(modifiedAt: string) { this.modifiedAt = new Date(modifiedAt); }
  path(name: MetadataPath): string { return join(this.rootPath, name); }
  async setup(files: Record<MetadataPath, string>): Promise<void> {
    await fs.mkdir(this.rootPath);
    for (const [name, text] of Object.entries(files)) {
      if (name !== 'package.json' && name !== 'package-lock.json') throw Error('Only owned root metadata belongs in this fixture.');
      this.authored.set(name, text);
      await fs.writeFile(this.path(name), text); await fs.utimes(this.path(name), this.modifiedAt, this.modifiedAt);
    }
    const configuration: Configuration = { formatVersion: 1, version: '1.0.0', sourceId: 'package-metadata',
      project: { root: 'project' }, build: { entries: ['unused.expec'] }, outputs: [], libraries: [], packages: [] };
    const connected = await new ProjectConnector(join(this.directory, 'expec.json')).connect(configuration);
    if (connected.problems.length || connected.deferred.length || connected.value?.status !== 'connected') {
      throw Error('Expected actual metadata project connection: ' + JSON.stringify(connected));
    }
    this.root = connected.value.context.root;
  }
  private selectedPath(value: unknown): MetadataPath | undefined {
    if (typeof value !== 'string') return undefined;
    return value === this.path('package.json') ? 'package.json' : value === this.path('package-lock.json') ? 'package-lock.json' : undefined;
  }
  private count(path: MetadataPath): number { return this.reads.filter(row => row.path === path).length; }
  private first(path: MetadataPath): MetadataRead | undefined { return this.reads.find(row => row.path === path && row.initial); }
  private deliver(actual: BigIntStats, path: MetadataPath, number: number, phase: 'before' | 'opened' | 'after' | 'named', initial: boolean): StatObservation {
    let delivered = actual;
    if (path === this.selected) {
      const first = this.first(path), before = first?.before?.delivered.ctimeNs;
      if (initial && number === 1 && phase !== 'before' && phase !== 'opened' && before !== undefined
        && (this.status === 'initial' || this.status === 'initial-and-second' || this.status === 'anchor' || this.change === 'named-after')) {
        delivered = statusOnly(actual, before + 1n);
      } else if (initial && number === 2 && first?.after
        && (this.status === 'initial' || this.status === 'initial-and-second' || this.status === 'anchor')) {
        const candidate = first.after.delivered.ctimeNs;
        delivered = statusOnly(actual, candidate + (this.status === 'anchor' || this.status === 'initial-and-second' && phase !== 'before' && phase !== 'opened' ? 1n : 0n));
      } else if (!initial && this.status === 'final-verification' && phase !== 'before' && phase !== 'opened') {
        const row = this.active.get(path), observed = row?.before?.delivered.ctimeNs;
        if (observed !== undefined) delivered = statusOnly(actual, observed + 1n);
      }
    }
    const observation = { actual, delivered }; this.statObservations.push(observation); return observation;
  }
  private observeAcquisition(files: ProjectFiles, path: string, query: Promise<ObservedFile>): Promise<ObservedFile> {
    if (this.scope.getStore() === this && files.root.path === this.root.path && files.root.identity === this.root.identity
      && (path === 'package.json' || path === 'package-lock.json')) {
      this.acquisitions.add(query);
      void query.then(() => this.acquisitions.delete(query), () => this.acquisitions.delete(query));
    }
    return query;
  }
  private async drainAcquisitions(): Promise<void> {
    while (this.acquisitions.size) await Promise.allSettled([...this.acquisitions]);
  }
  private hooks(): void {
    if (this.hooked) return; this.hooked = true;
    const driver = this, read = NpmDependencies.prototype.read, spawn = childProcess.spawn;
    const actualRead = ProjectFiles.prototype.read, prototype = ProjectFiles.prototype as ProjectFiles & Partial<CaptureBoundary>;
    const actualCapture = prototype.capture;
    this.restore.push(vi.spyOn(ProjectFiles.prototype, 'read').mockImplementation(function (this: ProjectFiles, path: string) {
      return driver.observeAcquisition(this, path, actualRead.call(this, path));
    }).mockRestore);
    if (actualCapture) {
      this.restore.push(vi.spyOn(prototype as ProjectFiles & CaptureBoundary, 'capture').mockImplementation(function (this: ProjectFiles, path: string) {
        return driver.observeAcquisition(this, path, actualCapture.call(this, path));
      }).mockRestore);
    }
    this.restore.push(vi.spyOn(NpmDependencies.prototype, 'read').mockImplementation(function (this: NpmDependencies, packages: Configuration['packages']) {
      if (driver.scope.getStore() === driver) driver.packageReaderEntries++;
      return read.call(this, packages);
    }).mockRestore);
    this.restore.push(vi.spyOn(childProcess, 'spawn').mockImplementation(((...args: Parameters<typeof childProcess.spawn>) => {
      const child = spawn(...args);
      if (driver.scope.getStore() === driver) {
        driver.nativeProcesses++;
        const closing = new Promise<void>(resolve => { child.once('close', () => resolve()); });
        driver.children.add(closing); void closing.then(() => driver.children.delete(closing));
      }
      return child;
    }) as typeof childProcess.spawn).mockRestore);
    this.restore.push(vi.spyOn(fs, 'lstat').mockImplementation((async (...args: Parameters<typeof fs.lstat>) => {
      const actual = await this.originals.lstat(...args), path = this.selectedPath(args[0]);
      if (!path || this.scope.getStore() !== this || !('mtimeNs' in actual)) return actual;
      const active = this.active.get(path), number = active?.number ?? this.count(path) + 1;
      const phase = active ? 'named' : 'before', initial = active?.initial ?? this.packageReaderEntries === 0;
      const observation = this.deliver(actual as BigIntStats, path, number, phase, initial);
      if (active) active.named = observation; else this.namedBefore.set(path, observation);
      return observation.delivered;
    }) as typeof fs.lstat).mockRestore);
    this.restore.push(vi.spyOn(fs, 'open').mockImplementation((async (...args: Parameters<typeof fs.open>) => {
      const path = this.selectedPath(args[0]);
      if (!path || args[1] !== 'r' || this.scope.getStore() !== this) return this.originals.open(...args);
      if (path === this.selected && this.change === 'before-open' && this.count(path) === 0) await this.replace(path);
      const handle = await this.originals.open(...args);
      const row: MetadataRead = { path, number: this.count(path) + 1, initial: this.packageReaderEntries === 0,
        openOrder: ++this.order, before: this.namedBefore.get(path), readAttempts: 0, physicallyClosed: false,
        closeAttempts: 0, settled: gate(), stats: 0 };
      this.reads.push(row); this.active.set(path, row); this.observeHandle(handle, row); return handle;
    }) as typeof fs.open).mockRestore);
  }
  private observeHandle(handle: FileHandle, row: MetadataRead): void {
    const stat = handle.stat.bind(handle), read = handle.readFile.bind(handle), close = handle.close.bind(handle);
    this.restore.push(vi.spyOn(handle, 'stat').mockImplementation((async (...args: Parameters<FileHandle['stat']>) => {
      const actual = await stat(...args); if (!('mtimeNs' in actual)) return actual;
      const phase = ++row.stats === 1 ? 'opened' : 'after';
      const observation = this.deliver(actual as BigIntStats, row.path, row.number, phase, row.initial);
      if (phase === 'opened') row.opened = observation; else row.after = observation;
      return observation.delivered;
    }) as FileHandle['stat']).mockRestore);
    this.restore.push(vi.spyOn(handle, 'readFile').mockImplementation((async (...args: Parameters<FileHandle['readFile']>) => {
      row.readAttempts++;
      if (row.path === this.selected && row.initial && row.number === 2 && this.secondBodyError) throw Object.assign(Error(this.secondBodyError.message), { code: this.secondBodyError.code });
      const value = await read(...args);
      if (!Buffer.isBuffer(value)) throw Error('The metadata acquisition must return actual unencoded bytes.');
      row.body = Buffer.from(value);
      if (row.initial && row.number === 1) {
        if (this.heldSiblingError) {
          if (row.path === 'package-lock.json') {
            this.heldBodyReached = true; this.lockBodyHeld = true; this.lockBody.release();
            this.drain = setTimeout(() => { this.lockFallbackReleased = true; this.lockBodyHeld = false; this.releaseLock.release(); }, 100);
            await this.releaseLock.promise; this.lockBodyHeld = false;
          } else {
            await this.lockBody.promise;
            this.lockHeldAtManifestRefusal = this.lockBodyHeld && !this.lockFallbackReleased
              && this.active.get('package-lock.json')?.physicallyClosed === false;
            throw Object.assign(Error(this.heldSiblingError.message), { code: this.heldSiblingError.code });
          }
        }
        if (this.orderedFailures) {
          if (row.path === 'package.json') await this.lockClosed.promise;
          this.failures.push(row.path);
          throw Object.assign(Error(row.path === 'package.json' ? this.orderedFailures.manifest : this.orderedFailures.lock), { code: 'EIO' });
        }
        if (row.path === this.selected) {
          if (this.change === 'named-after') await this.replace(row.path);
          if (this.change === 'mode') { await fs.chmod(this.path(row.path), 0o444); this.mutationPerformed = true; }
          if (this.change === 'mtime') { await fs.utimes(this.path(row.path), this.modifiedAt, new Date(this.changedDate)); this.mutationPerformed = true; }
          if (this.change === 'append') { await fs.appendFile(this.path(row.path), this.changedText); this.mutationPerformed = true; }
        }
      }
      return value;
    }) as FileHandle['readFile']).mockRestore);
    this.restore.push(vi.spyOn(handle, 'close').mockImplementation(async () => {
      row.closeAttempts++;
      try {
        await close(); row.physicallyClosed = true; row.closeOrder = ++this.order; this.active.delete(row.path);
        if (this.orderedFailures && row.path === 'package-lock.json') this.lockClosed.release();
        if (row.path === this.selected && row.initial && row.number === 1) {
          if (this.change === 'bytes') {
            await fs.writeFile(this.path(row.path), this.changedText); await fs.utimes(this.path(row.path), this.modifiedAt, this.modifiedAt);
            this.mutationPerformed = true;
          }
          if (this.firstCloseError) throw Object.assign(Error(this.firstCloseError.message), { code: this.firstCloseError.code });
        }
      } finally { row.settled.release(); }
    }).mockRestore);
  }
  private async replace(path: MetadataPath): Promise<void> {
    const text = this.first(path)?.body ?? this.authored.get(path);
    if (text === undefined) throw Error('Missing authored replacement body.');
    await fs.rename(this.path(path), join(this.rootPath, 'retired-' + path));
    await fs.writeFile(this.path(path), text); await fs.utimes(this.path(path), this.modifiedAt, this.modifiedAt);
    this.mutationPerformed = true;
  }
  private async run(work: () => Promise<void>): Promise<void> {
    this.hooks();
    const operation = this.scope.run(this, work); this.operations.add(operation);
    try { await operation; }
    finally {
      if (this.returnedOpen !== undefined && this.heldSiblingError) this.releaseLock.release();
      await this.drainAcquisitions();
      await Promise.all(this.reads.map(row => row.settled.promise));
      this.operations.delete(operation);
      if (this.drain) { clearTimeout(this.drain); this.drain = undefined; }
    }
  }
  async readRequestedPackages(packages: Configuration['packages']): Promise<void> {
    await this.run(async () => {
      this.report = await readPackages(this.root, packages);
      this.returnedOpen = this.reads.filter(row => !row.physicallyClosed).length;
    });
  }
  async readStrict(path: MetadataPath): Promise<void> {
    await this.run(async () => {
      try { this.captured = await new ProjectFiles(this.root).read(path); }
      catch (error) { this.directError = error; }
      this.returnedOpen = this.reads.filter(row => !row.physicallyClosed).length;
    });
  }
  async captureInitial(path: MetadataPath): Promise<void> {
    await this.run(async () => {
      const files = new ProjectFiles(this.root);
      const capture = (files as ProjectFiles & Partial<CaptureBoundary>).capture;
      if (!capture) throw Error('Proposed ProjectFiles.capture seam is not implemented; this is setup failure, not behavioral RED.');
      this.captured = await capture.call(files, path);
      this.returnedOpen = this.reads.filter(row => !row.physicallyClosed).length;
    });
  }
  async dispose(): Promise<void> {
    if (this.disposed) return; this.disposed = true;
    this.lockBody.release(); this.releaseLock.release(); this.lockClosed.release();
    if (this.drain) clearTimeout(this.drain);
    const errors: unknown[] = [];
    await Promise.allSettled([...this.operations]); await this.drainAcquisitions();
    await Promise.all(this.reads.map(row => row.settled.promise));
    await Promise.allSettled([...this.children]);
    for (const restore of this.restore.reverse()) try { restore(); } catch (error) { errors.push(error); }
    try {
      if (this.reads.some(row => !row.physicallyClosed)) throw Error('Actual owned metadata descriptor closure is unknown; fixture retained.');
      const directory = await this.originals.lstat(this.directory, { bigint: true });
      if (!directory.isDirectory() || directory.isSymbolicLink() || directory.dev !== this.directoryInfo.dev || directory.ino !== this.directoryInfo.ino
        || dirname(await fs.realpath(this.directory)) !== this.parent) throw Error('Owned metadata directory identity changed; fixture retained.');
      if (this.root) {
        const connected = await new ProjectConnector(join(this.directory, 'expec.json')).connect({ formatVersion: 1, version: '1.0.0', sourceId: 'metadata-cleanup',
          project: { root: 'project' }, build: { entries: ['unused.expec'] }, outputs: [], libraries: [], packages: [] });
        if (connected.value?.status !== 'connected' || connected.value.context.root.identity !== this.root.identity) {
          throw Error('Owned metadata project identity changed; fixture retained.');
        }
      }
      for (const name of this.authored.keys()) await fs.chmod(this.path(name), 0o600);
      await fs.rm(this.directory, { recursive: true, force: true });
    } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, 'Metadata fixture cleanup failed.');
  }
}


