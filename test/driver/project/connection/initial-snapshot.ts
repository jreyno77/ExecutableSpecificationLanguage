import { promises as fs, type BigIntStats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { vi } from 'vitest';
import { ConfigurationReader } from '../../../../src/project/connection/configuration.js';
import { ProjectConnector, type ProjectContext, type ProjectSnapshot } from '../../../../src/project/connection/project-connection.js';

type Change = 'none' | 'status' | 'repeated-status' | 'modified-time' | 'mode' | 'named-replacement' | 'opened-mismatch' | 'candidate-mismatch' | 'changed-bytes';
export type FileTuple = Pick<BigIntStats, 'dev' | 'ino' | 'mode' | 'size' | 'mtimeNs' | 'ctimeNs'>;
export interface SnapshotObservation {
  readonly events: { kind: 'named' | 'opened' | 'body' | 'open' | 'close'; handle: number; tuple?: FileTuple; actual?: FileTuple; bytes?: Uint8Array }[];
  readonly handles: { closed: boolean; close: () => Promise<void> }[];
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
  readonly observations: SnapshotObservation[] = [];
  current!: ProjectSnapshot;

  async setup(text: string): Promise<void> {
    this.parent = await fs.realpath(tmpdir());
    this.directory = await fs.mkdtemp(join(this.parent, 'expec-initial-snapshot-'));
    this.directory = await fs.realpath(this.directory);
    this.file = join(this.directory, '.gitattributes');
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

  async read(initial: boolean): Promise<void> {
    const observation: SnapshotObservation = { events: [], handles: [], pending: 0 };
    this.observations.push(observation);
    const change = this.change, closeError = this.closeError, actual = { lstat: fs.lstat.bind(fs), open: fs.open.bind(fs) };
    let anchor: BigIntStats | undefined, bodies = 0;
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
        if (change === 'candidate-mismatch' && observation.handles[0]?.closed) values.ctimeNs = anchor.ctimeNs + 2n;
      }
      if (change === 'opened-mismatch' && kind === 'opened') values.ctimeNs = anchor.ctimeNs + 1n;
      observation.events.push({ kind, handle, tuple: { ...values }, actual: tuple(info) });
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
      observation.events.push({ kind: 'open', handle: number });
      observation.handles.push(owned);
      restore.push(vi.spyOn(handle, 'stat').mockImplementation((async (...args: Parameters<typeof handle.stat>) =>
        observed(await track(() => stat(...args)) as BigIntStats, 'opened', number)) as typeof handle.stat).mockRestore);
      restore.push(vi.spyOn(handle, 'readFile').mockImplementation((async (...args: Parameters<typeof handle.readFile>) => {
        const bytes = await track(() => read(...args));
        bodies++;
        observation.events.push({ kind: 'body', handle: number, bytes: Uint8Array.from(typeof bytes === 'string' ? Buffer.from(bytes) : bytes) });
        return bytes;
      }) as typeof handle.readFile).mockRestore);
      restore.push(vi.spyOn(handle, 'close').mockImplementation(() => track(async () => {
        await close();
        owned.closed = true;
        observation.events.push({ kind: 'close', handle: number });
        if (change === 'changed-bytes' && number === 1) await fs.writeFile(this.file, this.replacement);
        if (closeError === number) throw Object.assign(Error('Arranged close failure after physical closure.'), { code: 'EIO' });
      })).mockRestore);
    };
    try {
      const capture = this.context as ProjectContext & { captureSnapshot?: () => Promise<ProjectSnapshot> };
      this.current = await (initial && capture.captureSnapshot ? capture.captureSnapshot() : this.context.readSnapshot());
      observation.atReturn = { pending: observation.pending, open: observation.handles.filter(handle => !handle.closed).length,
        closed: observation.handles.filter(handle => handle.closed).length };
    } finally { for (const undo of restore.reverse()) undo(); this.change = 'none'; this.closeError = 0; }
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
