import fs, { type BigIntStats } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import type { Diagnostic } from './checking.js';
import type { ProjectFile, ProjectRoot } from './project-connection.js';
import { diagnostic, pathValid, type NativeInputs } from './typescript-capture.js';

/** The only host allowed to read project-installed native declaration resources. */
export class NativeDeclarations implements NativeInputs {
  readonly files = new Map<string, ProjectFile>();
  readonly problems: Diagnostic[] = [];
  private readonly observed = new Map<string, BigIntStats | undefined>();
  private readonly spellings = new Map<string, string>();
  private readonly identities = new Map<string, string>();
  private readonly refused = new Set<string>();
  constructor(private readonly root: ProjectRoot, readonly imports: readonly string[]) {}
  private problem(code: string, path: string, message: string): void {
    if (!this.problems.some(problem => problem.code === code && problem.at.kind === 'dependency' && problem.at.path[1] === path)) this.problems.push(diagnostic(code, message, path));
  }
  private allowed(path: string): boolean { return path === 'node_modules' || path.startsWith('node_modules/') && pathValid(path); }
  private observe(path: string): BigIntStats | undefined {
    if (!this.allowed(path)) return undefined;
    const parts = path.split('/');
    for (let index = 1; index <= parts.length; index++) {
      const name = parts.slice(0, index).join('/');
      if (this.refused.has(name)) return undefined;
      if (this.observed.has(name)) {
        const info = this.observed.get(name); if (!info || index < parts.length && !info.isDirectory()) return undefined;
        continue;
      }
      try {
        const absolute = join(this.root.path, ...parts.slice(0, index)), info = fs.lstatSync(absolute, { bigint: true });
        if (info.isSymbolicLink() || !info.isFile() && !info.isDirectory()) {
          this.problem('unsupported-native-input', name, 'Native dependencies require ordinary directories and files; links and special files are unsupported.');
          this.observed.set(name, info); this.refused.add(name); return undefined;
        }
        const actual = relative(this.root.path, fs.realpathSync.native(absolute)).split(sep).join('/');
        const key = process.platform === 'win32' ? actual.toLowerCase() : actual;
        if (actual !== name || this.spellings.has(key) && this.spellings.get(key) !== name) {
          this.problem('unsupported-native-input', name, 'Native dependency aliases cannot represent independent captured inputs.');
          this.observed.set(name, info); this.refused.add(name); return undefined;
        }
        this.spellings.set(key, name); this.observed.set(name, info);
        if (info.isFile()) {
          const identity = `${info.dev}:${info.ino}`, previous = this.identities.get(identity);
          if (!info.ino || previous && previous !== name) {
            this.problem('unsupported-native-input', name, `Native file identity is unavailable or already captured as ${previous}.`);
            this.refused.add(name); return undefined;
          }
          this.identities.set(identity, name);
        }
        if (index < parts.length && !info.isDirectory()) return undefined;
      } catch (error) {
        this.observed.set(name, undefined);
        if (!missing(error)) this.problem('native-read-failed', name, `Cannot inspect native input: ${String(error)}`);
        return undefined;
      }
    }
    return this.observed.get(path);
  }
  directoryExists(path: string): boolean { return this.observe(path)?.isDirectory() ?? false; }
  directories(path: string): string[] {
    if (!this.directoryExists(path)) return [];
    try { return fs.readdirSync(join(this.root.path, path), { withFileTypes: true }).filter(entry => entry.isDirectory() || entry.isSymbolicLink()).map(entry => entry.name).sort(); }
    catch (error) { this.problem('native-read-failed', path, `Cannot inspect native type directories: ${String(error)}`); return []; }
  }
  fileExists(path: string): boolean {
    return this.observe(path)?.isFile() ?? false;
  }
  read(path: string): string | undefined {
    if (!this.fileExists(path)) return undefined;
    if (!/(?:\.d\.[cm]?ts|\.jsonc?)$/i.test(path)) {
      this.problem('unsupported-native-input', path, 'Only installed declarations and configuration metadata can be acquired.'); return undefined;
    }
    const captured = this.files.get(path);
    if (captured) return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(captured.bytes);
    const absolute = join(this.root.path, path), before = this.observed.get(path)!;
    let handle: number | undefined;
    try {
      handle = fs.openSync(absolute, 'r'); const opened = fs.fstatSync(handle, { bigint: true });
      if (!same(before, opened)) { this.problem('stale-project', path, 'Native input changed before it could be read.'); return undefined; }
      const bytes = fs.readFileSync(handle), after = fs.fstatSync(handle, { bigint: true });
      if (!same(opened, after) || !same(after, fs.lstatSync(absolute, { bigint: true }))) {
        this.problem('stale-project', path, 'Native input changed while it was read.'); return undefined;
      }
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      this.files.set(path, { path, bytes: Uint8Array.from(bytes), version: createHash('sha256').update(bytes).digest('hex') }); return text;
    } catch (error) { this.problem('native-read-failed', path, `Cannot read native input: ${String(error)}`); return undefined; }
    finally { if (handle !== undefined) fs.closeSync(handle); }
  }
  verify(): void {
    try {
      const info = fs.lstatSync(this.root.path, { bigint: true });
      if (!info.isDirectory() || info.isSymbolicLink() || `${info.dev}:${info.ino}:${this.root.path}` !== this.root.identity) this.problem('stale-project', '', 'Connected root identity changed during native capture.');
    } catch { this.problem('stale-project', '', 'Connected root disappeared during native capture.'); }
    for (const [path, before] of this.observed) {
      try {
        const after = fs.lstatSync(join(this.root.path, path), { bigint: true });
        if (!before || !same(before, after)) this.problem('stale-project', path, 'A native lookup input changed during capture.');
      } catch (error) { if (before || !missing(error)) this.problem('stale-project', path, 'A native lookup input became unavailable during capture.'); }
    }
  }
}
function same(a: BigIntStats, b: BigIntStats): boolean { return a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs; }
function missing(error: unknown): boolean { return ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? ''); }
