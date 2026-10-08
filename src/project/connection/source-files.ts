import { promises as fs, type BigIntStats } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Configuration } from './configuration.js';
import type { Diagnostic } from '../../compiler/checking.js';
import type { ProblemLocation } from '../../compiler/resolution/problem.js';
import type { SourceCapture } from './source-loader.js';

interface Root { selected: string; path: string; stat: BigIntStats; at: ProblemLocation }
interface File { path: string; capture: SourceCapture; stat: BigIntStats; ancestors: [string, BigIntStats][]; uses: ProblemLocation[] }
class FileProblem extends Error { constructor(readonly code: string, message: string) { super(message); } }

/** Reads only requested regular files beneath explicitly captured roots. */
export class SourceFiles {
  readonly problems: Diagnostic[] = [];
  readonly captured = new Map<string, File>();
  private readonly roots: Root[] = [];
  private readonly excluded: Root[] = [];
  private readonly failures = new Map<string, FileProblem>();
  constructor(private readonly directory: string, private readonly configuration: Configuration) {}
  manifest(...path: (string | number)[]): ProblemLocation {
    return { kind: 'dependency', path: ['manifest', this.configuration.sourceId, 'build', ...path] };
  }
  problem(code: string, message: string, at: ProblemLocation, related: readonly ProblemLocation[] = []): void {
    this.problems.push({ code, message, at, related });
  }
  async initialize(roots = [this.directory, ...this.configuration.build.sourceRoots ?? []].map((path, index) =>
    ({ path, at: index ? this.manifest('sourceRoots', index - 1) : this.manifest() })), ownership: 'workspace' | 'library' | 'excluded' = 'workspace'): Promise<void> {
    for (const { path: name, at } of roots) {
      if (!nativePath(name) || /[*?\[\]{}]/.test(name)) {
        this.problem('invalid-source-root', 'Provide a literal native source directory.', at); continue;
      }
      const selected = resolve(this.directory, name);
      try {
        if (ownership !== 'workspace' && (await fs.lstat(selected)).isSymbolicLink()) throw new FileProblem('source-link', 'Library roots must be ordinary directories: ' + selected);
        const path = await fs.realpath(selected), stat = await fs.stat(path, { bigint: true });
        if (!stat.isDirectory() || !usable(stat)) throw new FileProblem('invalid-source-root', 'A source root must be a directory with usable filesystem identity.');
        const collection = ownership === 'excluded' ? this.excluded : this.roots, previous = collection.find(root => sameIdentity(root.stat, stat));
        if (previous) this.problem('invalid-source-root', 'Source root ' + selected + ' repeats ' + previous.selected + '.', at, [previous.at]);
        else collection.push({ selected, path, stat, at });
      } catch (error) { this.report(error, 'source-root-unavailable', selected, at); }
    }
  }
  path(selected: string): string {
    const path = resolve(selected);
    const root = this.roots.filter(root => inside(root.selected, path) || inside(root.path, path))
      .sort((a, b) => b.selected.length - a.selected.length)[0];
    if (!root) throw new FileProblem('source-outside-roots', 'Source ' + path + ' is outside the configured roots.');
    const actual = inside(root.path, path) ? path : resolve(root.path, relative(root.selected, path));
    if (this.excluded.some(root => inside(root.selected, path) || inside(root.path, actual))) {
      throw new FileProblem('source-ownership-conflict', 'Workspace source belongs to an explicitly acquired library: ' + actual);
    }
    return actual;
  }
  async read(selected: string, at: ProblemLocation): Promise<SourceCapture | undefined> {
    let path = selected;
    try {
      path = this.path(selected);
      const failed = this.failures.get(path);
      if (failed) throw failed;
      const existing = this.captured.get(path);
      if (existing) { existing.uses.push(at); return existing.capture; }
      const ancestors = await this.ancestors(path);
      const before = await fs.lstat(path, { bigint: true });
      if (before.isSymbolicLink()) throw new FileProblem('source-link', 'Source links are not followed: ' + path);
      if (!before.isFile() || !usable(before)) throw new FileProblem('source-not-file', 'Source is not a regular file with usable identity: ' + path);
      const alias = [...this.captured.values()].find(file => sameIdentity(file.stat, before));
      if (alias) throw new FileProblem('source-alias', 'Source ' + path + ' aliases ' + alias.path + ' with a different module location.');
      const { bytes, stat } = await this.readBytes(path, before, ancestors, true);

      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
      catch { throw new FileProblem('source-encoding', 'Source is not valid UTF-8: ' + path); }
      const capture = Object.freeze({ source: Object.freeze({ sourceId: pathToFileURL(path).href, text }),
        version: 'sha256:' + createHash('sha256').update(bytes).digest('hex') });
      this.captured.set(path, { path, capture, stat, ancestors, uses: [at] });
      return capture;
    } catch (error) {
      const failure = this.report(error, 'source-unavailable', path, at);
      this.failures.set(path, failure);
      return undefined;
    }
  }
  private async readBytes(path: string, before: BigIntStats, ancestors: [string, BigIntStats][], initial: boolean): Promise<{ bytes: Buffer; stat: BigIntStats }> {
    const handle = await fs.open(path, 'r');
    let bytes: Buffer, candidate: BigIntStats;
    try {
      if (!same(before, await handle.stat({ bigint: true }))) throw changed(path);
      bytes = await handle.readFile(); candidate = await handle.stat({ bigint: true });
      if (!same(before, candidate) && (!initial || !ctimeOnly(before, candidate))) throw changed(path);
      if (!same(candidate, await fs.lstat(path, { bigint: true }))) throw changed(path);
      await this.verifyAncestors(ancestors);
    } finally { await handle.close(); }
    if (same(before, candidate)) return { bytes, stat: candidate };
    const settled = await fs.lstat(path, { bigint: true });
    if (!same(candidate, settled)) throw changed(path);
    const fresh = await this.readBytes(path, settled, ancestors, false);
    if (!bytes.equals(fresh.bytes)) throw changed(path);
    return fresh;
  }
  async verify(): Promise<void> {
    for (const root of [...this.roots, ...this.excluded]) {
      try {
        const path = await fs.realpath(root.selected), stat = await fs.stat(path, { bigint: true });
        if (!sameIdentity(root.stat, stat) || path !== root.path || !stat.isDirectory()) throw changed(root.selected);
      } catch (error) {
        this.problem('source-root-changed', 'Source root changed or became unavailable: ' + root.selected, root.at);
        for (const [path] of this.captured) if (inside(root.path, path)) this.captured.delete(path);
      }
    }
    for (const file of this.captured.values()) {
      try {
        await this.verifyAncestors(file.ancestors);
        if (!same(file.stat, await fs.lstat(file.path, { bigint: true }))) throw changed(file.path);
      } catch (error) {
        for (const at of file.uses) this.report(error, 'source-changed', file.path, at);
      }
    }
  }
  private async ancestors(path: string): Promise<[string, BigIntStats][]> {
    const root = this.roots.filter(root => inside(root.path, path)).sort((a, b) => b.path.length - a.path.length)[0]!;
    const ancestors: [string, BigIntStats][] = [[root.path, root.stat]];
    let parent = root.path;
    for (const part of relative(root.path, dirname(path)).split(sep).filter(Boolean)) {
      parent = join(parent, part);
      const stat = await fs.lstat(parent, { bigint: true });
      if (stat.isSymbolicLink()) throw new FileProblem('source-link', 'Source directory links are not followed: ' + parent);
      if (!stat.isDirectory()) throw new FileProblem('source-unavailable', 'Source parent is not a directory: ' + parent);
      ancestors.push([parent, stat]);
    }
    await this.verifyAncestors(ancestors);
    return ancestors;
  }
  private async verifyAncestors(ancestors: [string, BigIntStats][]): Promise<void> {
    for (const [path, before] of ancestors) {
      const after = await fs.lstat(path, { bigint: true });
      if (!after.isDirectory() || after.isSymbolicLink() || !sameIdentity(before, after)) throw changed(path);
    }
  }
  private report(error: unknown, fallback: string, path: string, at: ProblemLocation): FileProblem {
    const failure = error instanceof FileProblem ? error : new FileProblem(fallback, 'Cannot read ' + path + ': ' + osError(error) + '.');
    this.problem(failure.code, failure.message, at, [{ kind: 'dependency', path: ['sources', path] }]);
    return failure;
  }
}
export function nativePath(path: unknown): path is string {
  return typeof path === 'string' && path.length > 0 && !path.includes('\0') && Buffer.from(path).toString() === path
    && (process.platform !== 'win32' || !/^(?:[a-z]:(?![/\\])|[/\\](?![/\\])|[/\\]{2}[^/\\]*[/\\]?$)/i.test(path));
}
function inside(root: string, path: string): boolean {
  const child = relative(root, path);
  return !isAbsolute(child) && child !== '..' && !child.startsWith('..' + sep);
}
function usable(stat: BigIntStats): boolean { return stat.dev >= 0n && stat.ino > 0n; }
function sameIdentity(a: BigIntStats, b: BigIntStats): boolean { return a.dev === b.dev && a.ino === b.ino; }
function same(a: BigIntStats, b: BigIntStats): boolean {
  return sameIdentity(a, b) && a.mode === b.mode && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
function ctimeOnly(a: BigIntStats, b: BigIntStats): boolean {
  return sameIdentity(a, b) && a.mode === b.mode && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs !== b.ctimeNs;
}
function changed(path: string): FileProblem { return new FileProblem('source-changed', 'Source changed during capture: ' + path); }
function osError(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    && (/^E[A-Z]+$/.test(error.code) || error.code === 'ERR_FS_FILE_TOO_LARGE')) return error.code;
  throw error;
}
