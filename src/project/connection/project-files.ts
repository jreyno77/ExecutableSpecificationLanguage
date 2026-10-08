import { promises as fs, type BigIntStats } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join, isAbsolute } from 'node:path';
import type { Diagnostic } from '../../compiler/checking.js';
import type { ProjectRoot } from './project-connection.js';
import type { FileObservation } from './project-writer.js';

export const marker = '.expec/write.lock';
export const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
export const sameIdentity = (a: BigIntStats, b: BigIntStats): boolean => a.dev === b.dev && a.ino === b.ino;
export const errorCode = (error: unknown): unknown => error && typeof error === 'object' && 'code' in error ? error.code : undefined;
export const message = (error: unknown): string => error instanceof Error ? error.message : String(error);
export function problem(root: ProjectRoot, code: string, path: string, text: string): Diagnostic {
  return { code, message: text, at: { kind: 'dependency', path: ['project', root.path, ...path.split('/').filter(Boolean)] }, related: [] };
}
export function fail(root: ProjectRoot, code: string, path: string, text: string): never {
  throw Object.assign(new Error(text), { diagnostic: problem(root, code, path, text) });
}
export function literal(path: string): boolean {
  return typeof path === 'string' && !isAbsolute(path) && !path.includes('\0') && Buffer.from(path).toString() === path
    && path.split('/').every(part => !!part && part !== '.' && part !== '..'
      && (process.platform !== 'win32' || !/[\\:<>"|?*\x00-\x1f]|[. ]$/.test(part)
        && !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part)));
}
export interface ObservedFile { readonly value: FileObservation; readonly info?: BigIntStats }

/** Native path checks and byte effects; the caller owns plan policy and receipts. */
export class ProjectFiles {
  readonly created = new Map<string, BigIntStats | undefined>();
  private readonly parents = new Map<string, BigIntStats>();
  private lock: { info: BigIntStats; token: string } | undefined;
  private markerCreated = false;
  constructor(readonly root: ProjectRoot) {}
  path(path: string): string { return join(this.root.path, ...path.split('/')); }
  private async spelling(path: string): Promise<void> {
    const parts = path.split('/'), name = parts.pop()!;
    if (!(await fs.readdir(this.path(parts.join('/')))).includes(name)) {
      fail(this.root, 'unsupported-change', path, 'Use the existing filename spelling; filesystem aliases are unsupported.');
    }
  }
  async verifyRoot(): Promise<void> {
    try {
      const actual = await fs.realpath(this.root.path), info = await fs.lstat(this.root.path, { bigint: true });
      if (actual === this.root.path && info.isDirectory() && !info.isSymbolicLink() && `${info.dev}:${info.ino}:${actual}` === this.root.identity) return;
    } catch (error) { fail(this.root, 'stale-project', '', `Project root is unavailable: ${message(error)}`); }
    fail(this.root, 'stale-project', '', 'Project root no longer identifies the captured directory.');
  }
  async ancestors(path: string, create = false): Promise<void> {
    await this.verifyRoot();
    const segments = path.split('/').slice(0, -1);
    for (let index = 1; index <= segments.length; index++) {
      const relative = segments.slice(0, index).join('/');
      let info: BigIntStats;
      try { info = await fs.lstat(this.path(relative), { bigint: true }); } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error;
        if (!create) return;
        await fs.mkdir(this.path(relative));
        this.created.set(relative, undefined);
        info = await fs.lstat(this.path(relative), { bigint: true });
        this.created.set(relative, info);
      }
      if (!info.isDirectory() || info.isSymbolicLink()) fail(this.root, 'unsupported-change', relative, 'A file path must traverse ordinary directories.');
      await this.spelling(relative);
      const previous = this.parents.get(relative);
      if (previous && !sameIdentity(previous, info)) fail(this.root, 'stale-project', relative, 'An affected parent directory was replaced.');
      this.parents.set(relative, info);
    }
  }
  async read(path: string): Promise<ObservedFile> { return this.readFile(path, false); }
  /** Initial admission may prove one ctime-only change with a fresh strict read. */
  async capture(path: string): Promise<ObservedFile> { return this.readFile(path, true); }
  private async readFile(path: string, initial: boolean): Promise<ObservedFile> {
    await this.ancestors(path);
    let info: BigIntStats;
    try { info = await fs.lstat(this.path(path), { bigint: true }); } catch (error) {
      if (errorCode(error) === 'ENOENT') return { value: { path, state: 'absent' } };
      throw error;
    }
    if (!info.isFile() || info.isSymbolicLink()) fail(this.root, 'unsupported-change', path, 'Only ordinary files can be changed.');
    await this.spelling(path);
    const handle = await fs.open(this.path(path), 'r');
    let bytes: Buffer, candidate: BigIntStats;
    try {
      if (!stable(info, await handle.stat({ bigint: true }))) fail(this.root, 'stale-project', path, 'File identity changed while opening it.');
      bytes = await handle.readFile();
      candidate = await handle.stat({ bigint: true });
      if (!stable(info, candidate) && (!initial || !ctimeOnly(info, candidate))) {
        fail(this.root, 'stale-project', path, 'File changed while reading it.');
      }
      if (!stable(candidate, await fs.lstat(this.path(path), { bigint: true }))) {
        fail(this.root, 'stale-project', path, 'File changed while reading it.');
      }
      if (stable(info, candidate)) return { value: { path, state: 'file', bytes, version: hash(bytes) }, info };
    } finally { await handle.close(); }
    const fresh = await this.read(path);
    if (!fresh.info || !stable(candidate, fresh.info) || fresh.value.state !== 'file' || !bytes.equals(fresh.value.bytes)) {
      fail(this.root, 'stale-project', path, 'File changed while reading it.');
    }
    return fresh;
  }
  async observe(path: string): Promise<FileObservation> {
    try { return (await this.read(path)).value; } catch { return { path, state: 'unknown' }; }
  }
  async verify(path: string, previous: ObservedFile): Promise<ObservedFile> {
    const current = await this.read(path);
    if (!sameObservation(previous.value, current.value) || previous.info && (!current.info || !sameIdentity(previous.info, current.info))) {
      fail(this.root, 'stale-project', path, 'An affected file changed after it was checked.');
    }
    if (current.info && current.info.nlink > 1n) fail(this.root, 'unsupported-change', path, 'Destructive changes to multiply linked files are unsupported.');
    return current;
  }
  async write(path: string, bytes: Uint8Array, previous: ObservedFile, mode?: number): Promise<void> {
    await this.ancestors(path, true);
    await this.verify(path, previous);
    const handle = await fs.open(this.path(path), previous.value.state === 'file' ? 'r+' : 'wx', mode);
    try {
      if (previous.value.state === 'file') {
        const info = await handle.stat({ bigint: true }), existing = Buffer.alloc(previous.value.bytes.length);
        if (!previous.info || !sameIdentity(previous.info, info) || info.nlink > 1n || info.size !== BigInt(existing.length)) {
          fail(this.root, 'stale-project', path, 'File changed before writing.');
        }
        let offset = 0;
        while (offset < existing.length) {
          const read = await handle.read(existing, offset, existing.length - offset, offset);
          if (!read.bytesRead) break;
          offset += read.bytesRead;
        }
        if (!existing.equals(previous.value.bytes) || offset !== existing.length) fail(this.root, 'stale-project', path, 'File bytes changed before writing.');
      }
      await this.ancestors(path);
      const info = await handle.stat({ bigint: true }), named = await fs.lstat(this.path(path), { bigint: true });
      if (!sameIdentity(info, named) || named.isSymbolicLink()) fail(this.root, 'stale-project', path, 'File path was replaced before writing.');
      await handle.writeFile(bytes);
      await handle.truncate(bytes.length);
      if (mode !== undefined) await handle.chmod(mode);
    } finally { await handle.close(); }
  }
  async remove(path: string, previous: ObservedFile): Promise<void> {
    await this.verify(path, previous);
    await fs.unlink(this.path(path));
  }
  async acquire(): Promise<void> {
    await this.ancestors(marker, true);
    let handle;
    try { handle = await fs.open(this.path(marker), 'wx'); } catch (error) {
      if (errorCode(error) === 'EEXIST') fail(this.root, 'writer-busy', marker, 'Another writer marker exists. Inspect it before retrying; it will not be stolen.');
      throw error;
    }
    this.markerCreated = true;
    try {
      this.lock = { info: await handle.stat({ bigint: true }), token: randomUUID() };
      await handle.writeFile(this.lock.token);
    } finally { await handle.close(); }
  }
  async verifyLock(): Promise<void> {
    if (!this.lock) fail(this.root, 'writer-busy', marker, 'This call does not own the writer marker.');
    const current = await this.read(marker);
    if (!current.info || !sameIdentity(current.info, this.lock.info) || current.value.state !== 'file'
      || Buffer.from(current.value.bytes).toString() !== this.lock.token) {
      fail(this.root, 'writer-busy', marker, 'The writer marker was replaced or changed.');
    }
  }
  async cleanup(problems: Diagnostic[]): Promise<{ createdDirectories: string[]; temporaryPaths: string[] }> {
    const temporaryPaths: string[] = [];
    if (this.markerCreated) {
      try {
        if (!this.lock) throw new Error('Created marker identity is unknown; it was not removed.');
        await this.verifyLock(); await fs.unlink(this.path(marker));
      } catch (error) {
        temporaryPaths.push(marker); problems.push(problem(this.root, 'cleanup-failed', marker, message(error)));
      }
    }
    const remaining: string[] = [];
    for (const [path, info] of [...this.created].reverse()) {
      try {
        if (!info) throw new Error('Created directory identity is unknown; it was not removed.');
        await this.ancestors(path);
        const current = await fs.lstat(this.path(path), { bigint: true });
        if (!current.isDirectory() || !sameIdentity(info, current)) throw new Error('Created directory was replaced; it was not removed.');
        if ((await fs.readdir(this.path(path))).length) { remaining.push(path); continue; }
        await fs.rmdir(this.path(path));
      } catch (error) {
        if (errorCode(error) === 'ENOENT') continue;
        remaining.push(path); problems.push(problem(this.root, 'cleanup-failed', path, message(error)));
      }
    }
    return { createdDirectories: remaining.sort(), temporaryPaths };
  }
}
export function sameObservation(a: FileObservation, b: FileObservation): boolean {
  return a.path === b.path && a.state === b.state && a.state !== 'unknown'
    && (a.state !== 'file' || b.state === 'file' && a.version === b.version && Buffer.from(a.bytes).equals(b.bytes));
}
function stable(a: BigIntStats, b: BigIntStats): boolean {
  return sameIdentity(a, b) && a.mode === b.mode && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}

function ctimeOnly(a: BigIntStats, b: BigIntStats): boolean {
  return sameIdentity(a, b) && a.mode === b.mode && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs !== b.ctimeNs;
}