import { promises as fs, type BigIntStats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { vi } from 'vitest';
import { ConfigurationReader } from '../../../../src/project/connection/configuration.js';
import { ProjectConnector, type ProjectContext, type ProjectSnapshot } from '../../../../src/project/connection/project-connection.js';

type Change = 'none' | 'status' | 'repeated-status' | 'modified-time' | 'mode' | 'named-replacement' | 'opened-mismatch' | 'candidate-mismatch' | 'changed-bytes';
export type FileTuple = Pick<BigIntStats, 'dev' | 'ino' | 'mode' | 'size' | 'mtimeNs' | 'ctimeNs'>;
export interface SnapshotObservation {
  readonly events: { kind: 'named' | 'opened' | 'body' | 'open' | 'close'; handle: number; acquisition: number; tuple?: FileTuple; actual?: FileTuple; bytes?: Uint8Array }[];
  readonly handles: { closed: boolean; close: () => Promise<void> }[];
  readonly acquisitions: { kind: 'ordinary' | 'capture'; index: number }[];
  pending: number;
  atReturn?: { pending: number; open: number; closed: number };
}

/** Controls one file's observed metadata; bodies and descriptor ownership remain actual filesystem operations. */
export class InitialSnapshotDriver {
  private directory!: string;
  private parent!: string;
  private file!: string;
  private context!: ProjectContext;
  private change: Change = 'none';
  private closeError: 0 | 1 | 2 = 0;
  private replacement = '';
  private beginAcquisition: ((kind: 'ordinary' | 'capture') => void) | undefined;
  readonly observations: SnapshotObservation[] = [];
  current!: ProjectSnapshot;

  get project(): ProjectContext { return this.context; }
  path(name: string): string {
    const path = resolve(this.directory, name), part = relative(this.directory, path);
    if (isAbsolute(name) || isAbsolute(part) || part === '..' || part.startsWith('..' + sep)) throw Error('Snapshot fixture path escaped its owned root.');
    return path;
  }
  async setup(text: string, name = '.gitattributes'): Promise<void> {
    this.parent = await fs.realpath(tmpdir());
    this.directory = await fs.mkdtemp(join(this.parent, 'expec-initial-snapshot-'));
    this.directory = await fs.realpath(this.directory);
    this.file = this.path(name);
    await fs.mkdir(dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, text);
    const read = new ConfigurationReader([]).read({ sourceId: 'initial-snapshot', text: JSON.stringify({
      formatVersion: 1, version: '0.2.0', build: { entries: ['unused.expec'] }, project: { root: '.' },
    }) });
    if (!read.value) throw Error('Invalid authored snapshot configuration.');
    const connected = await new ProjectConnector(join(this.directory, 'expec.json')).connect(read.value);
    if (connected.value?.status !== 'connected' || connected.problems.length || connected.deferred.length) throw Error('Expected a connected ordinary project.');
    this.context = connected.value.context;
  }
  arrange(change: Change): void { this.change = change; }
  replaceAfterFirstClose(text: string): void { this.change = 'changed-bytes'; this.replacement = text; }
  failClose(handle: 1 | 2): void { this.closeError = handle; }

  read(initial: boolean): Promise<void> {
    const capture = this.context.captureSnapshot;
    return this.observe(() => this.acquire(initial && capture ? 'capture' : 'ordinary',
      () => initial && capture ? capture.call(this.context) : this.context.readSnapshot()));
  }
  async acquire(kind: 'ordinary' | 'capture', action: () => Promise<ProjectSnapshot>): Promise<ProjectSnapshot> {
    this.beginAcquisition?.(kind);
    return action();
  }
  async observe(action: () => Promise<ProjectSnapshot>, selectedAcquisition = 1): Promise<void> {
    const observation: SnapshotObservation = { events: [], handles: [], acquisitions: [], pending: 0 };
    this.observations.push(observation);
    const arranged = this.change, closeError = this.closeError, actual = { lstat: fs.lstat.bind(fs), open: fs.open.bind(fs) };
    let anchor: BigIntStats | undefined, bodies = 0, acquisition = 0, firstHandle = 1, change: Change = 'none';
    this.beginAcquisition = kind => {
      acquisition++; anchor = undefined; bodies = 0; firstHandle = observation.handles.length + 1;
      change = acquisition === selectedAcquisition ? arranged : 'none';
      observation.acquisitions.push({ kind, index: acquisition });
    };
    const restore: (() => void)[] = [];
    const track = async <T>(action: () => Promise<T>): Promise<T> => {
      observation.pending++;
      try { return await action(); } finally { observation.pending--; }
    };
    const tuple = (info: BigIntStats): FileTuple => ({ dev: info.dev, ino: info.ino, mode: info.mode, size: info.size,
      mtimeNs: info.mtimeNs, ctimeNs: info.ctimeNs });
    const observed = (info: BigIntStats, kind: 'named' | 'opened', handle: number): BigIntStats => {
      anchor ??= info;
      const values: FileTuple = tuple(info);
      if (change === 'changed-bytes' && bodies) values.mtimeNs = anchor.mtimeNs;
      if (change !== 'none' && change !== 'opened-mismatch' && bodies) {
        values.ctimeNs = anchor.ctimeNs + (change === 'repeated-status' && bodies > 1 ? 2n : 1n);
        if (change === 'modified-time') values.mtimeNs = anchor.mtimeNs + 1n;
        if (change === 'mode') values.mode = anchor.mode ^ 1n;
        if (change === 'named-replacement' && kind === 'named') values.ino = anchor.ino + 1n;
        if (change === 'candidate-mismatch' && observation.handles[firstHandle - 1]?.closed) values.ctimeNs = anchor.ctimeNs + 2n;
      }
      if (change === 'opened-mismatch' && kind === 'opened') values.ctimeNs = anchor.ctimeNs + 1n;
      observation.events.push({ kind, handle, acquisition, tuple: { ...values }, actual: tuple(info) });
      return Object.assign(Object.create(Object.getPrototypeOf(info)) as BigIntStats, info, values);
    };
    restore.push(vi.spyOn(fs, 'lstat').mockImplementation((async (...args: Parameters<typeof fs.lstat>) => {
      const info = await track(() => actual.lstat(...args));
      return String(args[0]) === this.file ? observed(info as BigIntStats, 'named', observation.handles.length) : info;
    }) as typeof fs.lstat).mockRestore);
    restore.push(vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await track(() => actual.open(...args));
      if (String(args[0]) === this.file) watch(handle);
      return handle;
    }).mockRestore);
    const watch = (handle: FileHandle): void => {
      const number = observation.handles.length + 1, stat = handle.stat.bind(handle), read = handle.readFile.bind(handle), close = handle.close.bind(handle);
      const owned = { closed: false, close };
      observation.events.push({ kind: 'open', handle: number, acquisition });
      observation.handles.push(owned);
      restore.push(vi.spyOn(handle, 'stat').mockImplementation((async (...args: Parameters<typeof handle.stat>) =>
        observed(await track(() => stat(...args)) as BigIntStats, 'opened', number)) as typeof handle.stat).mockRestore);
      restore.push(vi.spyOn(handle, 'readFile').mockImplementation((async (...args: Parameters<typeof handle.readFile>) => {
        const bytes = await track(() => read(...args));
        bodies++;
        observation.events.push({ kind: 'body', handle: number, acquisition, bytes: Uint8Array.from(typeof bytes === 'string' ? Buffer.from(bytes) : bytes) });
        return bytes;
      }) as typeof handle.readFile).mockRestore);
      restore.push(vi.spyOn(handle, 'close').mockImplementation(() => track(async () => {
        await close();
        owned.closed = true;
        observation.events.push({ kind: 'close', handle: number, acquisition });
        if (change === 'changed-bytes' && number === firstHandle) await fs.writeFile(this.file, this.replacement);
        if (closeError === number - firstHandle + 1) throw Object.assign(Error('Arranged close failure after physical closure.'), { code: 'EIO' });
      })).mockRestore);
    };
    try {
      this.current = await action();
      observation.atReturn = { pending: observation.pending, open: observation.handles.filter(handle => !handle.closed).length,
        closed: observation.handles.filter(handle => handle.closed).length };
    } finally {
      observation.atReturn ??= { pending: observation.pending, open: observation.handles.filter(handle => !handle.closed).length,
        closed: observation.handles.filter(handle => handle.closed).length };
      for (const undo of restore.reverse()) undo(); this.change = 'none'; this.closeError = 0; this.beginAcquisition = undefined; }
  }
  async dispose(): Promise<void> {
    if (!this.directory) return;
    const failures: unknown[] = [];
    for (const observation of this.observations) for (const handle of observation.handles.filter(handle => !handle.closed)) {
      try { await handle.close(); } catch (error) { failures.push(error); }
    }
    if (dirname(await fs.realpath(this.directory)) !== this.parent || !basename(this.directory).startsWith('expec-initial-snapshot-')) {
      throw Error('Refusing to remove an unowned initial-snapshot fixture.');
    }
    try { await fs.rm(this.directory, { recursive: true, force: true }); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, 'Initial-snapshot fixture cleanup failed.');
  }
}
