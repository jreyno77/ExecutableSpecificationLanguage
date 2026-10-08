import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { promises as fs, mkdtempSync, realpathSync } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { vi } from 'vitest';
import { ConfigurationReader, ProjectConnector, type ProjectContext, type ProjectSnapshot } from '../../../../src/index.js';

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
type Gate = ReturnType<typeof gate>;
type OwnedHandle = { path: string; closed: boolean; close: () => Promise<void> };
export interface ReadObservation {
  mode: 'none' | 'first-body' | 'all-bodies';
  handles: OwnedHandle[];
  bodies: Map<string, { bytes: Uint8Array; version: string }>;
  pending: number;
  peak: number;
  chosen: string | undefined;
  progressed: boolean;
  released: boolean;
  pause: Gate;
  timer: NodeJS.Timeout | undefined;
  atReturn: { pending: number; open: number; closed: number } | undefined;
}
interface DirectoryChange {
  path: string;
  replacement: Record<string, string> | undefined;
  seen: number;
  stable: Gate;
  ran: boolean;
  before: string | undefined;
  after: string | undefined;
  missing: boolean;
  retired: Map<string, Uint8Array>;
  replaced: Map<string, Uint8Array>;
}

/** Only ordinary owned files and actual public snapshot calls; no compiler or native setup. */
export class SnapshotDriver {
  readonly directory = realpathSync.native(mkdtempSync(join(tmpdir(), 'expec-parallel-snapshot-')));
  readonly root = join(this.directory, 'project');
  readonly observations: ReadObservation[] = [];
  readonly initial: Record<string, string> = {};
  current!: ProjectSnapshot;
  earlier: ProjectSnapshot[] = [];
  change: DirectoryChange | undefined;
  private context!: ProjectContext;
  private readonly scope = new AsyncLocalStorage<ReadObservation>();
  private readonly pending = new Set<Promise<unknown>>();
  private readonly queries = new Set<Promise<ProjectSnapshot>>();
  private readonly restore: (() => void)[] = [];
  private readonly actual = { open: fs.open.bind(fs), lstat: fs.lstat.bind(fs) };

  path(name: string): string {
    const path = resolve(this.root, name), inside = relative(this.root, path);
    if (isAbsolute(inside) || inside === '..' || inside.startsWith('..' + sep)) throw new Error('Fixture path escaped its owned project.');
    return path;
  }
  async setup(files: Record<string, string>): Promise<void> {
    Object.assign(this.initial, files);
    await fs.mkdir(this.root);
    for (const [path, text] of Object.entries(files)) await this.write(path, text);
    const configuration = new ConfigurationReader([]).read({ sourceId: 'parallel-snapshot', text: JSON.stringify({
      formatVersion: 1, version: '0.2.0', project: { root: 'project' }, build: { entries: ['unused.expec'] },
    }) });
    if (!configuration.value) throw new Error('Invalid authored snapshot configuration.');
    const connection = await new ProjectConnector(join(this.directory, 'expec.json')).connect(configuration.value);
    if (connection.problems.length || connection.deferred.length || connection.value?.status !== 'connected') {
      throw new Error('Expected an ordinary connected fixture: ' + JSON.stringify(connection));
    }
    this.context = connection.value.context;
  }
  async write(path: string, text: string): Promise<void> {
    await fs.mkdir(dirname(this.path(path)), { recursive: true });
    await fs.writeFile(this.path(path), text);
  }
  arrangeDirectory(path: string, replacement?: Record<string, string>): void {
    this.change = { path, replacement, seen: 0, stable: gate(), ran: false, before: undefined, after: undefined,
      missing: false, retired: new Map(), replaced: new Map() };
  }
  async read(mode: ReadObservation['mode'] = 'none'): Promise<void> {
    await this.observe(async () => { this.current = await this.query(mode); });
  }
  async readSimultaneously(): Promise<void> {
    await this.observe(async () => {
      this.earlier = await Promise.all([this.query('none'), this.query('none')]);
      this.current = this.earlier[1]!;
    });
  }

  private query(mode: ReadObservation['mode']): Promise<ProjectSnapshot> {
    const observation: ReadObservation = { mode, handles: [], bodies: new Map(), pending: 0, peak: 0,
      chosen: undefined, progressed: false, released: false, pause: gate(), timer: undefined, atReturn: undefined };
    this.observations.push(observation);
    const query = this.scope.run(observation, async () => {
      const snapshot = await this.context.readSnapshot();
      observation.atReturn = { pending: observation.pending, open: observation.handles.filter(item => !item.closed).length,
        closed: observation.handles.filter(item => item.closed).length };
      return snapshot;
    });
    this.queries.add(query);
    void query.then(() => this.queries.delete(query), () => this.queries.delete(query));
    return query;
  }
  private tracked<T>(observation: ReadObservation, action: () => Promise<T>): Promise<T> {
    observation.pending++;
    let work: Promise<T>;
    try { work = action(); } catch (error) { observation.pending--; throw error; }
    const settled = work.finally(() => { observation.pending--; });
    this.pending.add(settled);
    void settled.then(() => this.pending.delete(settled), () => this.pending.delete(settled));
    return settled;
  }
  private release(observation: ReadObservation): void {
    observation.released = true;
    if (observation.timer) clearTimeout(observation.timer);
    observation.pause.release();
  }
  private async pauseBody(observation: ReadObservation, path: string): Promise<void> {
    if (observation.mode === 'none' || observation.released) return;
    if (observation.mode === 'first-body' && observation.chosen && observation.chosen !== path) {
      observation.progressed = true;
      this.release(observation);
      return;
    }
    observation.chosen ??= path;
    observation.timer ??= setTimeout(() => this.release(observation), 500);
    await observation.pause.promise;
  }

  private async observe(action: () => Promise<void>): Promise<void> {
    this.restore.push(vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const observation = this.scope.getStore();
      if (!observation || typeof args[0] !== 'string' || args[1] !== 'r' || !args[0].startsWith(this.root + sep)) {
        return this.actual.open(...args);
      }
      return this.tracked(observation, async () => {
        const handle = await this.actual.open(...args);
        this.watchHandle(observation, relative(this.root, args[0] as string).split(sep).join('/'), handle);
        return handle;
      });
    }).mockRestore);
    this.restore.push(vi.spyOn(fs, 'lstat').mockImplementation((async (...args: Parameters<typeof fs.lstat>) => {
      const observation = this.scope.getStore(), change = this.change;
      if (!observation) return this.actual.lstat(...args);
      if (change && String(args[0]) === this.path(change.path) && change.seen++ === 1) await this.changeDirectory(observation, change);
      try {
        const info = await this.tracked(observation, () => this.actual.lstat(...args));
        if (change && String(args[0]) === this.path(change.path)) {
          const identity = String(info.dev) + ':' + String(info.ino);
          if (!change.before) change.before = identity;
          else if (change.ran) change.after = identity;
        }
        return info;
      } catch (error) {
        if (change?.ran && String(args[0]) === this.path(change.path) && (error as NodeJS.ErrnoException).code === 'ENOENT') change.missing = true;
        throw error;
      }
    }) as typeof fs.lstat).mockRestore);
    try { await action(); }
    finally {
      for (const observation of this.observations) this.release(observation);
      this.change?.stable.release();
      await Promise.allSettled([...this.queries]);
      while (this.pending.size) await Promise.allSettled([...this.pending]);
      const failures: unknown[] = [];
      for (const restore of this.restore.splice(0).reverse()) { try { restore(); } catch (error) { failures.push(error); } }
      if (failures.length) throw new AggregateError(failures, 'Snapshot observer restoration failed.');
    }
  }
  private watchHandle(observation: ReadObservation, path: string, handle: FileHandle): void {
    const read = handle.readFile.bind(handle), stat = handle.stat.bind(handle), close = handle.close.bind(handle);
    const owned: OwnedHandle = { path, closed: false, close };
    observation.handles.push(owned);
    observation.peak = Math.max(observation.peak, observation.handles.filter(item => !item.closed).length);
    this.restore.push(vi.spyOn(handle, 'stat').mockImplementation(((...args: Parameters<typeof handle.stat>) => this.tracked(observation, () => stat(...args))) as typeof handle.stat).mockRestore);
    this.restore.push(vi.spyOn(handle, 'readFile').mockImplementation((async (...args: Parameters<typeof handle.readFile>) =>
      this.tracked(observation, async () => {
        const bytes = await read(...args), observed = Uint8Array.from(typeof bytes === 'string' ? Buffer.from(bytes) : bytes);
        observation.bodies.set(path, { bytes: observed, version: createHash('sha256').update(observed).digest('hex') });
        await this.pauseBody(observation, path);
        return bytes;
      })) as typeof handle.readFile).mockRestore);
    this.restore.push(vi.spyOn(handle, 'close').mockImplementation(() => this.tracked(observation, async () => {
      await close();
      owned.closed = true;
      if (path === 'a-stable/item.txt') this.change?.stable.release();
    })).mockRestore);
  }
  private async changeDirectory(observation: ReadObservation, change: DirectoryChange): Promise<void> {
    const children = observation.handles.filter(item => item.path.startsWith(change.path + '/'));
    if (!children.length || children.some(item => !item.closed)) return;
    const fallback = setTimeout(() => change.stable.release(), 500);
    try { await change.stable.promise; } finally { clearTimeout(fallback); }
    if (!observation.handles.some(item => item.path === 'a-stable/item.txt' && item.closed)) return;
    await fs.rename(this.path(change.path), join(this.directory, 'retired'));
    change.ran = true;
    for (const path of Object.keys(this.initial).filter(path => path.startsWith(change.path + '/'))) {
      change.retired.set(path, await fs.readFile(join(this.directory, 'retired', path.slice(change.path.length + 1))));
    }
    if (change.replacement) {
      await fs.mkdir(this.path(change.path));
      for (const [name, text] of Object.entries(change.replacement)) {
        const path = change.path + '/' + name;
        await this.write(path, text);
        change.replaced.set(path, await fs.readFile(this.path(path)));
      }
    }
  }
  async dispose(): Promise<void> {
    for (const observation of this.observations) this.release(observation);
    this.change?.stable.release();
    await Promise.allSettled([...this.queries]);
    while (this.pending.size) await Promise.allSettled([...this.pending]);
    const failures: unknown[] = [];
    for (const restore of this.restore.splice(0).reverse()) { try { restore(); } catch (error) { failures.push(error); } }
    for (const observation of this.observations) for (const handle of observation.handles.filter(item => !item.closed)) {
      try { await handle.close(); } catch (error) { failures.push(error); }
    }
    if (dirname(this.directory) !== realpathSync.native(tmpdir()) || !basename(this.directory).startsWith('expec-parallel-snapshot-')) {
      throw new Error('Refusing to remove an unowned snapshot fixture.');
    }
    try { await fs.rm(this.directory, { recursive: true, force: true }); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, 'Snapshot fixture cleanup failed.');
  }
}


