import type { Check, Diagnostic } from './checking.js';
import type { Configuration } from './configuration.js';
import { promises as fs, type BigIntStats } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

export interface ProjectRoot { readonly path: string; readonly identity: string }
export interface ProjectFile { readonly path: string; readonly bytes: Uint8Array; readonly version: string }
export interface ProjectSnapshot {
  readonly readOnlyFiles?: readonly ProjectFile[];
  readonly root: ProjectRoot;
  readonly complete: boolean;
  readonly files: readonly ProjectFile[];
  readonly excludeNames: readonly string[];
  readonly excluded: readonly string[];
  readonly problems: readonly Diagnostic[];
}
export interface ProjectContext { readonly root: ProjectRoot; readSnapshot(): Promise<ProjectSnapshot> }
export type ProjectConnection =
  | { readonly status: 'connected'; readonly context: ProjectContext }
  | { readonly status: 'unconnected'; readonly reason: 'not-configured' | 'missing-root'; readonly root?: string };

export class ProjectConnector {
  private readonly directory: string;
  private readonly exclusions: readonly string[];
  constructor(manifestLocation: string, options?: { excludeNames?: readonly string[] }) {
    if (!nativePath(manifestLocation) || !isAbsolute(manifestLocation)) throw new TypeError('Provide a fully qualified absolute manifest filename.');
    const names = options?.excludeNames ?? ['.git', 'node_modules'];
    if (!Array.isArray(names) || names.some(name => !nativePath(name) || name === '.' || name === '..' || name.includes('/') || name.includes(sep))
      || new Set(names).size !== names.length) throw new TypeError('Exclusions must be unique literal path segment names.');
    this.directory = dirname(manifestLocation);
    this.exclusions = [...names];
  }
  async connect(configuration: Configuration): Promise<Check<ProjectConnection>> {
    const success = (value: ProjectConnection): Check<ProjectConnection> => ({ value, problems: [], deferred: [] });
    const failure = (code: string, message: string): Check<ProjectConnection> => ({ problems: [diagnostic(code, message,
      ['manifest', configuration.sourceId, 'project', 'root'])], deferred: [] });
    if (!configuration.project) return success({ status: 'unconnected', reason: 'not-configured' });
    if (!nativePath(configuration.project.root)) return failure('invalid-project-root', 'Provide a valid native project path without ambient drive state.');
    const selected = resolve(this.directory, configuration.project.root);
    try {
      let existing = selected;
      for (;;) {
        try { await fs.lstat(existing); break; } catch (error) {
          if (osError(error) !== 'ENOENT' || dirname(existing) === existing) throw error;
          existing = dirname(existing);
        }
      }
      const path = await fs.realpath(existing), info = await fs.stat(path, { bigint: true });
      if (!info.isDirectory()) return failure('root-not-directory', `Project root ${selected} is not a directory.`);
      if (existing !== selected) return success({ status: 'unconnected', reason: 'missing-root', root: selected });
      if (!usableIdentity(info)) return failure('unsupported-root', `Project root ${selected} has no usable filesystem identity.`);
      return success({ status: 'connected', context: new ConnectedProject(selected, { path, identity: identity(path, info) }, this.exclusions) });
    } catch (error) {
      return failure(osError(error) === 'ENOTDIR' ? 'root-not-directory' : 'root-unavailable', `Cannot connect to project root ${selected}: ${osError(error)}.`);
    }
  }
}

class ConnectedProject implements ProjectContext {
  constructor(private readonly selected: string, private readonly captured: ProjectRoot, private readonly exclusions: readonly string[]) {}
  get root(): ProjectRoot { return { ...this.captured }; }
  async readSnapshot(): Promise<ProjectSnapshot> {
    const files: ProjectFile[] = [], excluded: string[] = [], problems: Diagnostic[] = [];
    const problem = (code: string, message: string, parts: string[]) => problems.push(diagnostic(code, message, ['project', this.captured.path, ...parts]));
    const verifyRoot = async () => {
      try {
        const path = await fs.realpath(this.selected), info = await fs.stat(path, { bigint: true });
        if (info.isDirectory() && identity(path, info) === this.captured.identity) return true;
        problem('root-changed', `Selected project root ${this.selected} no longer identifies ${this.captured.path}. Reconnect before reading it.`, []);
      } catch (error) { problem('root-unavailable', `Cannot read selected project root ${this.selected}: ${osError(error)}.`, []); }
      return false;
    };
    const changed = (parts: string[]) => problem('changed-during-read', `Project entry ${parts.join('/') || this.captured.path} changed while it was being read.`, parts);
    const read = async (parts: string[]): Promise<void> => {
      const path = join(this.captured.path, ...parts), relative = parts.join('/');
      try {
        const before = await fs.lstat(path, { bigint: true });
        if (before.isSymbolicLink()) { problem('link-not-followed', `Project link ${relative} was not followed.`, parts); return; }
        if (before.isDirectory()) {
          const start = files.length, skipped = excluded.length, names = new Set<string>();
          for (const raw of (await fs.readdir(path, { encoding: 'buffer' })).sort(Buffer.compare)) {
            const name = raw.toString('utf8');
            if (!Buffer.from(name).equals(raw) || names.has(name)) {
              problem('unsupported-entry', `Cannot represent filename bytes ${raw.toString('hex')} losslessly in ${relative || this.captured.path}.`, parts);
              continue;
            }
            names.add(name);
            if (this.exclusions.includes(name)) excluded.push([...parts, name].join('/'));
            else await read([...parts, name]);
          }
          const after = await fs.lstat(path, { bigint: true });
          if (!sameFile(before, after)) changed(parts);
          if (!after.isDirectory() || before.dev !== after.dev || before.ino !== after.ino) {
            files.splice(start); excluded.splice(skipped);
          }
        } else if (before.isFile()) {
          const handle = await fs.open(path, 'r');
          try {
            if (!sameFile(before, await handle.stat({ bigint: true }))) { changed(parts); return; }
            const bytes = await handle.readFile();
            if (!sameFile(before, await handle.stat({ bigint: true })) || !sameFile(before, await fs.lstat(path, { bigint: true }))) {
              changed(parts); return;
            }
            files.push({ path: relative, bytes, version: createHash('sha256').update(bytes).digest('hex') });
          } finally { await handle.close(); }
        } else problem('unsupported-entry', `Project entry ${relative} is neither a regular file nor a directory.`, parts);
      } catch (error) { problem('read-failed', `Cannot read project entry ${relative || this.captured.path}: ${osError(error)}.`, parts); }
    };
    if (await verifyRoot()) {
      await read([]);
      if (!await verifyRoot()) { files.length = 0; excluded.length = 0; }
    }
    const location = (item: Diagnostic) => item.at.kind === 'dependency' ? item.at.path.slice(2).join('/') : '';
    files.sort((a, b) => ordinal(a.path, b.path));
    excluded.sort(ordinal);
    problems.sort((a, b) => ordinal(location(a), location(b)) || ordinal(a.code, b.code) || ordinal(a.message, b.message));
    return { root: this.root, complete: problems.length === 0, files, excludeNames: [...this.exclusions], excluded, problems };
  }
}

function nativePath(path: unknown): path is string {
  return typeof path === 'string' && path.length > 0 && !path.includes('\0') && Buffer.from(path).toString() === path
    && (process.platform !== 'win32' || !/^(?:[a-z]:(?![/\\])|[/\\](?![/\\])|[/\\]{2}[^/\\]*[/\\]?$)/i.test(path));
}
function usableIdentity(info: BigIntStats): boolean { return info.dev >= 0n && info.ino > 0n; }
function identity(path: string, info: BigIntStats): string { return `${info.dev}:${info.ino}:${path}`; }
function sameFile(before: BigIntStats, after: BigIntStats): boolean {
  return before.dev === after.dev && before.ino === after.ino && before.mode === after.mode
    && before.size === after.size && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs;
}
function ordinal(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function diagnostic(code: string, message: string, path: readonly (string | number)[]): Diagnostic {
  return { code, message, at: { kind: 'dependency', path: [...path] }, related: [] };
}
function osError(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    && (/^E[A-Z]+$/.test(error.code) || error.code === 'ERR_FS_FILE_TOO_LARGE')) return error.code;
  throw error;
}
