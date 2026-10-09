import { promises as fs, type BigIntStats } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, sep } from 'node:path';
import { vi } from 'vitest';
import { ProjectFiles, type ObservedFile } from '../../../../src/project/connection/project-files.js';

export type FileFault = 'status' | 'repeated-status' | 'body' | 'mtime' | 'mode' | 'size' | 'name' | 'opening' | 'candidate';
export interface FileTuple { dev: string; ino: string; mode: string; size: string; mtimeNs: string; ctimeNs: string }
export interface FileEvent { kind: 'named' | 'opened' | 'open' | 'body' | 'close'; handle?: number; tuple?: FileTuple; actual?: FileTuple; bytes?: Buffer }
export interface FileAcquisition { path: string; phase: string; method: string; events: FileEvent[]; selected: boolean; base?: BigIntStats; status: number; handles: number[] }
type CapturingFiles = ProjectFiles & { capture?: (path: string, previous?: ObservedFile) => Promise<ObservedFile> };

/** Observes actual guarded acquisitions; only an authored metadata fact is changed. */
export class ProjectFileCaptureDriver {
  root = '';
  files!: ProjectFiles;
  readonly acquisitions: FileAcquisition[] = [];
  readonly handles: { path: string; closed: boolean; reads: number }[] = [];
  atReturn = { pending: 0, open: 0, closed: 0 };
  phaseReached = false;
  routeReplacement: { before: FileTuple; after: FileTuple; beforeBytes: Buffer; afterBytes: Buffer;
    parentBefore: FileTuple; parentAfter: FileTuple } | undefined;
  private pausePath: string | undefined;
  private releasePause: (() => void) | undefined;
  private pauseObserved: Promise<void> | undefined;
  private reachedPause: (() => void) | undefined;
  private pauseGate: Promise<void> | undefined;
  private readonly refusals: { path: string; phase: string; error: unknown }[] = [];
  private readonly refusalWaiters: { path: string; phase: string; resolve: (error: unknown) => void }[] = [];
  result: ObservedFile | undefined;
  error: unknown;
  previous: ObservedFile | undefined;
  phase = 'file';
  private target = '';
  private fault: FileFault | undefined;
  private selected: FileAcquisition | undefined;
  private choose: (acquisition: FileAcquisition) => boolean = () => true;
  private replacement: string | undefined;
  private closeFailure: 1 | 2 | undefined;
  private replaceRouteAtClose: 1 | 2 | undefined;
  private readonly active = new Map<string, FileAcquisition>();
  private readonly pending = new Set<Promise<unknown>>();
  private readonly restores: (() => void)[] = [];
  private readonly depths = new WeakMap<ProjectFiles, Set<string>>();

  async setup(files: Readonly<Record<string, string>>): Promise<void> {
    this.root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'expec-file-capture-')));
    try {
      for (const [path, text] of Object.entries(files)) await this.replace(path, text);
      const info = await fs.lstat(this.root, { bigint: true });
      this.files = new ProjectFiles({ path: this.root, identity: String(info.dev) + ':' + String(info.ino) + ':' + this.root });
      this.observe();
    } catch (error) { await this.dispose(); throw error; }
  }
  path(path: string): string {
    if (!path || path.split('/').some(part => !part || part === '.' || part === '..') || path.includes('\\') || path.includes(':')) throw Error('Invalid owned fixture path.');
    const result = join(this.root, ...path.split('/')), within = relative(this.root, result);
    if (!within || within === '..' || within.startsWith('..' + sep)) throw Error('Fixture path escapes its owned root.');
    return result;
  }
  async replace(path: string, text: string): Promise<void> {
    const target = this.path(path); await fs.mkdir(dirname(target), { recursive: true }); await fs.writeFile(target, text);
  }
  async remove(path: string): Promise<void> { await fs.unlink(this.path(path)); }
  async replaceIdentity(path: string, text: string): Promise<void> {
    await fs.rename(this.path(path), this.path(path + '.previous')); await this.replace(path, text);
  }
  async addHardLink(path: string): Promise<void> { await fs.link(this.path(path), this.path(path + '.linked')); }
  arm(path: string, fault: FileFault, choose: (acquisition: FileAcquisition) => boolean = () => true, replacement?: string): void {
    this.target = path; this.fault = fault; this.choose = choose; this.replacement = replacement; this.selected = undefined; this.phaseReached = false;
  }
  failClosure(ordinal: 1 | 2): void { this.closeFailure = ordinal; }
  replaceRouteAfterClose(ordinal: 1 | 2): void { this.replaceRouteAtClose = ordinal; }
  get triggered(): FileAcquisition | undefined { return this.selected; }
  pauseBody(path: string): void {
    this.pausePath = path;
    this.pauseObserved = new Promise(resolve => { this.reachedPause = resolve; });
    this.pauseGate = new Promise(resolve => { this.releasePause = resolve; });
  }
  async waitForPausedBody(): Promise<void> {
    if (!this.pauseObserved) throw Error('No actual body pause was arranged.');
    await this.pauseObserved;
  }
  releasePausedBody(): void { this.releasePause?.(); }
  async waitForRefusal(path: string, phase: string): Promise<unknown> {
    const completed = this.refusals.find(item => item.path === path && item.phase === phase);
    return completed ? completed.error : new Promise(resolve => { this.refusalWaiters.push({ path, phase, resolve }); });
  }
  markReturn(): void {
    this.atReturn = { pending: this.pending.size, open: this.handles.filter(handle => !handle.closed).length,
      closed: this.handles.filter(handle => handle.closed).length };
  }
  async capture(path: string, previous?: ObservedFile): Promise<ObservedFile> {
    const capture = (this.files as CapturingFiles).capture;
    // Signature-only bridge before production adds capture: retain the actual strict behavior for meaningful RED.
    return capture ? capture.call(this.files, path, previous) : previous ? this.files.verify(path, previous) : this.files.read(path);
  }
  async run(path: string, operation: 'capture' | 'read' | 'verify' | 'captured-verify'): Promise<void> {
    this.result = undefined; this.error = undefined;
    try {
      this.result = operation === 'read' ? await this.files.read(path) : operation === 'verify'
        ? await this.files.verify(path, this.previous!) : await this.capture(path, operation === 'captured-verify' ? this.previous : undefined);
    } catch (error) { this.error = error; }
    finally { this.markReturn(); }
  }
  async baseline(path: string): Promise<void> { this.previous = await this.capture(path); }
  private observe(): void {
    const methods = ['read', ...('capture' in ProjectFiles.prototype ? ['capture'] : [])] as ('read' | 'capture')[];
    for (const method of methods) {
      const prototype = ProjectFiles.prototype as CapturingFiles, original = prototype[method]!;
      const spy = vi.spyOn(prototype, method).mockImplementation(function (this: ProjectFiles, path: string, previous?: ObservedFile) {
        return driver.acquire(this, path, method, () => original.call(this, path, previous));
      });
      const driver = this; this.restores.push(() => spy.mockRestore());
    }
    const lstat = fs.lstat.bind(fs), open = fs.open.bind(fs);
    const named = vi.spyOn(fs, 'lstat').mockImplementation(async (...args) => {
      const info = await Reflect.apply(lstat, fs, args), acquisition = this.active.get(String(args[0]));
      if (!acquisition || typeof (info as BigIntStats).ctimeNs !== 'bigint') return info;
      if (!acquisition.base) acquisition.base = info as BigIntStats;
      const observed = this.view(acquisition, info as BigIntStats, true);
      acquisition.events.push({ kind: 'named', tuple: tuple(observed), actual: tuple(info as BigIntStats) }); return observed;
    });
    this.restores.push(() => named.mockRestore());
    const opening = vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const absolute = String(args[0]), within = relative(this.root, absolute), acquisition = this.active.get(absolute);
      const handle = await Reflect.apply(open, fs, args);
      if (!within || within === '..' || within.startsWith('..' + sep) || !acquisition) return handle;
      const index = this.handles.length, ordinal = acquisition.handles.length + 1;
      const row = { path: acquisition.path, closed: false, reads: 0 }; this.handles.push(row); acquisition.handles.push(index);
      acquisition.events.push({ kind: 'open', handle: index });
      const stat = handle.stat.bind(handle), read = handle.readFile.bind(handle), close = handle.close.bind(handle);
      let statCalls = 0;
      handle.stat = (async (...options) => {
        const info = await Reflect.apply(stat, handle, options) as BigIntStats; statCalls++;
        let observed = this.view(acquisition, info);
        if (acquisition.selected && this.fault === 'opening' && ordinal === 1 && statCalls === 1) {
          this.phaseReached = true; observed = clone(observed, { ctimeNs: observed.ctimeNs + 1n });
        }
        acquisition.events.push({ kind: 'opened', handle: index, tuple: tuple(observed), actual: tuple(info) }); return observed;
      }) as typeof handle.stat;
      handle.readFile = (async (...options) => {
        if (acquisition.path === this.pausePath && acquisition.phase === 'outer-initial' && ordinal === 1) {
          this.reachedPause?.(); await this.pauseGate;
        }
        const bytes = await Reflect.apply(read, handle, options) as Buffer; row.reads++;
        acquisition.events.push({ kind: 'body', handle: index, bytes: Buffer.from(bytes) });
        if (acquisition.selected && this.fault && (ordinal === 1 || this.fault === 'repeated-status')) {
          this.phaseReached = true; acquisition.status++;
        }
        return bytes;
      }) as typeof handle.readFile;
      handle.close = async () => {
        await close(); row.closed = true; acquisition.events.push({ kind: 'close', handle: index });
        if (!acquisition.selected) return;
        if (ordinal === 1 && this.fault === 'candidate') acquisition.status++;
        if (ordinal === 1 && this.fault === 'body') await this.replace(acquisition.path, this.replacement!);
        if (this.replaceRouteAtClose === ordinal) {
          const directory = dirname(this.path(acquisition.path)), retired = directory + '-retired';
          if (directory === this.root) throw Error('Route replacement needs an owned child directory.');
          const target = this.path(acquisition.path);
          const before = await lstat(target, { bigint: true }), parentBefore = await lstat(directory, { bigint: true });
          const beforeBytes = await fs.readFile(target);
          await fs.rename(directory, retired); await fs.mkdir(directory);
          await fs.rename(join(retired, basename(target)), target);
          const after = await lstat(target, { bigint: true }), parentAfter = await lstat(directory, { bigint: true });
          this.routeReplacement = { before: tuple(before), after: tuple(after), beforeBytes, afterBytes: await fs.readFile(target),
            parentBefore: tuple(parentBefore), parentAfter: tuple(parentAfter) };
        }
        if (this.closeFailure === ordinal) throw Object.assign(new Error('Authored close error after physical closure.'), { code: 'EIO' });
      };
      return handle;
    });
    this.restores.push(() => opening.mockRestore());
  }
  private acquire(files: ProjectFiles, path: string, method: string, action: () => Promise<ObservedFile>): Promise<ObservedFile> {
    if (files.root.path !== this.root) return action();
    const depths = this.depths.get(files) ?? new Set<string>(); this.depths.set(files, depths);
    if (depths.has(path)) return action();
    depths.add(path);
    const acquisition: FileAcquisition = { path, phase: this.phase, method, events: [], selected: false, status: 0, handles: [] };
    if (!this.selected && this.fault && path === this.target && this.choose(acquisition)) { acquisition.selected = true; this.selected = acquisition; }
    this.acquisitions.push(acquisition); const absolute = this.path(path); this.active.set(absolute, acquisition);
    const pending = action().catch(error => {
      this.refusals.push({ path, phase: acquisition.phase, error });
      for (const waiter of this.refusalWaiters) if (waiter.path === path && waiter.phase === acquisition.phase) waiter.resolve(error);
      throw error;
    }).finally(() => { depths.delete(path); this.active.delete(absolute); this.pending.delete(pending); });
    this.pending.add(pending); return pending;
  }
  private view(acquisition: FileAcquisition, info: BigIntStats, named = false): BigIntStats {
    if (!acquisition.selected || !acquisition.base) return info;
    const changes: Partial<BigIntStats> = { ctimeNs: acquisition.base.ctimeNs + BigInt(acquisition.status) };
    if (this.fault === 'body') changes.mtimeNs = acquisition.base.mtimeNs;
    if (acquisition.status && this.fault === 'mtime') changes.mtimeNs = info.mtimeNs + 1n;
    if (acquisition.status && this.fault === 'mode') changes.mode = info.mode ^ 0o100n;
    if (acquisition.status && this.fault === 'size') changes.size = info.size + 1n;
    if (acquisition.status && this.fault === 'name' && named) changes.ino = info.ino + 1n;
    return clone(info, changes);
  }
  async dispose(): Promise<void> {
    this.releasePausedBody();
    await Promise.allSettled([...this.pending]);
    for (const restore of this.restores.reverse()) restore();
    if (this.handles.some(handle => !handle.closed)) throw Error('The actual acquisition left an open file descriptor.');
    if (!this.root) return;
    if (dirname(this.root) !== await fs.realpath(tmpdir()) || !basename(this.root).startsWith('expec-file-capture-')) throw Error('Unsafe fixture cleanup.');
    await fs.rm(this.root, { recursive: true, force: true });
  }
}
function clone(info: BigIntStats, changes: Partial<BigIntStats>): BigIntStats {
  return Object.assign(Object.create(Object.getPrototypeOf(info)), info, changes) as BigIntStats;
}
function tuple(info: BigIntStats): FileTuple {
  return { dev: String(info.dev), ino: String(info.ino), mode: String(info.mode), size: String(info.size), mtimeNs: String(info.mtimeNs), ctimeNs: String(info.ctimeNs) };
}
