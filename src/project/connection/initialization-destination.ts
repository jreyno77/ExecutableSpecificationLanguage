import { promises as fs, type BigIntStats } from 'node:fs';
import { dirname } from 'node:path';
import { errorCode, sameIdentity } from './project-files.js';
import type { Diagnostic } from '../../compiler/checking.js';

/** Captures the chosen leaf and its real parent, without claiming a filesystem transaction. */
export class InitializationDestination {
  created: string | undefined;
  private constructor(readonly path: string, private readonly parent: string,
    private readonly parentInfo: BigIntStats, private rootInfo?: BigIntStats) {}
  static async capture(path: string): Promise<InitializationDestination> {
    let parent: string, info: BigIntStats;
    try { parent = await fs.realpath(dirname(path)); info = await fs.lstat(parent, { bigint: true }); }
    catch (error) { reject('unsupported-initialization-parent', dirname(path), `An existing parent directory is required: ${String(errorCode(error))}.`); }
    if (!info.isDirectory() || !usable(info)) reject('unsupported-initialization-parent', parent, 'The parent must be a real directory with a usable identity.');
    const root = await optionalStat(path);
    if (root && !root.isSymbolicLink() && !root.isDirectory()) reject('initialization-root-not-directory', path, 'The chosen destination is a file, not a directory.');
    if (root && (root.isSymbolicLink() || !usable(root))) reject('unsupported-initialization-root', path, 'Choose an ordinary directory with a usable identity.');
    if (root && (await fs.readdir(path)).length) reject('initialization-root-not-empty', path, 'Initialization requires an empty destination.');
    return new InitializationDestination(path, parent, info, root);
  }
  async verifyEmpty(): Promise<void> {
    try {
      if (await fs.realpath(dirname(this.path)) !== this.parent || !sameIdentity(this.parentInfo, await fs.lstat(this.parent, { bigint: true }))) {
        reject('destination-changed', this.path, 'The selected parent changed after preparation.');
      }
      const current = await optionalStat(this.path);
      if (!!current !== !!this.rootInfo || current && (!current.isDirectory() || current.isSymbolicLink() || !sameIdentity(this.rootInfo!, current))) {
        reject('destination-changed', this.path, 'The selected destination changed after preparation.');
      }
      if (current && (await fs.readdir(this.path)).length) reject('destination-changed', this.path, 'Files appeared after preparation.');
    } catch (error) {
      if (error && typeof error === 'object' && 'diagnostic' in error) throw error;
      reject('destination-changed', this.path, `The selected destination is unavailable: ${String(errorCode(error))}.`);
    }
  }
  async create(): Promise<void> {
    if (this.rootInfo) return;
    try { await fs.mkdir(this.path); }
    catch (error) { reject(errorCode(error) === 'EEXIST' ? 'destination-changed' : 'initialization-root-unavailable', this.path, "Cannot create the chosen destination: " + String(errorCode(error)) + '.'); }
    this.created = this.path;
    const info = await fs.lstat(this.path, { bigint: true });
    if (!info.isDirectory() || info.isSymbolicLink() || !usable(info)) reject('destination-changed', this.path, 'The created destination could not be verified.');
    this.rootInfo = info;
  }
  async verifyIdentity(): Promise<void> {
    const parent = await fs.realpath(dirname(this.path)), info = await fs.lstat(this.path, { bigint: true });
    if (parent !== this.parent || !sameIdentity(this.parentInfo, await fs.lstat(parent, { bigint: true }))
      || !info.isDirectory() || info.isSymbolicLink() || !this.rootInfo || !sameIdentity(this.rootInfo, info)) {
      reject('destination-changed', this.path, 'The connected destination no longer identifies the chosen directory.');
    }
  }
}
const usable = (info: BigIntStats): boolean => info.dev >= 0n && info.ino > 0n;
async function optionalStat(path: string): Promise<BigIntStats | undefined> {
  try { return await fs.lstat(path, { bigint: true }); }
  catch (error) { if (errorCode(error) === 'ENOENT') return undefined; throw error; }
}
export function reject(code: string, path: string, message: string): never {
  const diagnostic: Diagnostic = { code, message, at: { kind: 'dependency', path: ['initialization', path] }, related: [] };
  throw Object.assign(new Error(message), { diagnostic });
}
