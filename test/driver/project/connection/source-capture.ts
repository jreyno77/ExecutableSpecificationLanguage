import { promises as fs, type BigIntStats } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { vi } from 'vitest';
import { ConfigurationReader } from '../../../../src/project/connection/configuration.js';
import { SourceFiles } from '../../../../src/project/connection/source-files.js';

export type SourceTransition = 'once' | 'twice' | 'body' | 'candidate' | 'mtime' | 'mode' | 'name' | 'opening' | 'first-close' | 'second-close';
export class SourceCaptureDriver {
  readonly handles: { reads: number; closed: boolean }[] = [];
  readonly bodies: Buffer[] = [];
  readonly metadata: { operation: 'named' | 'opened'; handle?: number; tuple: Record<string, string> }[] = [];
  private phase = 0;
  private transition: SourceTransition | undefined;
  private reopenedBeforeClose = false;
  private readonly restores: (() => void)[] = [];
  private constructor(readonly root: string, readonly name: string, readonly files: SourceFiles, private readonly initial: BigIntStats) {}
  static async author(text: string): Promise<SourceCaptureDriver> {
    const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'expec-source-capture-'))), name = join(root, 'source.expec');
    let driver: SourceCaptureDriver | undefined;
    try {
    await fs.writeFile(name, text);
    const configuration = new ConfigurationReader([]).read({ sourceId: 'settings', text: JSON.stringify({ formatVersion: 1, version: '0.1.0', build: { entries: ['source.expec'] } }) });
    if (!configuration.value) throw new Error('Invalid source fixture configuration');
    const files = new SourceFiles(root, configuration.value);
    await files.initialize();
    driver = new SourceCaptureDriver(root, name, files, await fs.lstat(name, { bigint: true }));
    driver.observe();
    return driver;
    } catch (error) {
      if (driver) await driver.dispose();
      else if (dirname(root) === await fs.realpath(tmpdir()) && basename(root).startsWith('expec-source-capture-')) await fs.rm(root, { recursive: true, force: true });
      throw error;
    }
  }
  arrange(transition: SourceTransition): void { this.transition = transition; }
  laterStatusChange(): void { this.phase++; }
  async capture() { return this.files.read(this.name, this.files.manifest('entries', 0)); }
  async verify(): Promise<void> { await this.files.verify(); }
  get closedBeforeReopen(): boolean { return !this.reopenedBeforeClose; }
  get bodyReads(): number { return this.bodies.length; }
  digest(text: string): string { return 'sha256:' + createHash('sha256').update(text).digest('hex'); }
  private view(info: BigIntStats, named = false): BigIntStats {
    return Object.assign(Object.create(Object.getPrototypeOf(info)), info, { ctimeNs: this.initial.ctimeNs + BigInt(this.phase),
      ...(this.transition === 'body' ? { mtimeNs: this.initial.mtimeNs } : {}),
      ...(this.phase && this.transition === 'mtime' ? { mtimeNs: info.mtimeNs + 1n } : {}),
      ...(this.phase && this.transition === 'mode' ? { mode: info.mode ^ 0o100n } : {}),
      ...(this.phase && this.transition === 'name' && named ? { ino: info.ino + 1n } : {}) }) as BigIntStats;
  }
  private observe(): void {
    const lstat = fs.lstat.bind(fs), open = fs.open.bind(fs);
    const named = vi.spyOn(fs, 'lstat').mockImplementation(async (...args) => {
      const info = await Reflect.apply(lstat, fs, args);
      if (String(args[0]) !== this.name || !('ctimeNs' in info) || typeof info.ctimeNs !== 'bigint') return info;
      const observed = this.view(info as BigIntStats, true); this.record('named', observed); return observed;
    });
    this.restores.push(() => named.mockRestore());
    const opening = vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await Reflect.apply(open, fs, args);
      if (String(args[0]) !== this.name) return handle;
      if (this.handles.some(row => !row.closed)) this.reopenedBeforeClose = true;
      const ordinal = this.handles.length + 1, row = { reads: 0, closed: false };
      this.handles.push(row);
      const stat = handle.stat.bind(handle), read = handle.readFile.bind(handle), close = handle.close.bind(handle);
      let statCalls = 0;
      handle.stat = (async (...options) => {
        const info = await Reflect.apply(stat, handle, options) as BigIntStats;
        statCalls++;
        const observed = this.transition === 'opening' && ordinal === 1 && statCalls === 1
          ? { ...this.view(info), ctimeNs: this.initial.ctimeNs + 1n } : this.view(info);
        this.record('opened', observed, ordinal); return observed;
      }) as typeof handle.stat;
      handle.readFile = (async (...options) => {
        const bytes = await Reflect.apply(read, handle, options) as Buffer;
        row.reads++; this.bodies.push(Buffer.from(bytes));
        if (this.transition && (ordinal === 1 || this.transition === 'twice')) this.phase++;
        return bytes;
      }) as typeof handle.readFile;
      handle.close = async () => {
        await close(); row.closed = true;
        if (ordinal === 1 && this.transition === 'candidate') this.phase++;
        if (ordinal === 1 && this.transition === 'body') {
          await fs.writeFile(this.name, 'opaque type After!');
          await fs.utimes(this.name, this.initial.atime, this.initial.mtime);
        }
        if ((ordinal === 1 && this.transition === 'first-close') || (ordinal === 2 && this.transition === 'second-close')) {
          throw Object.assign(new Error('Authored close error after real close'), { code: 'EIO' });
        }
      };
      return handle;
    });
    this.restores.push(() => opening.mockRestore());
  }
  private record(operation: 'named' | 'opened', info: BigIntStats, handle?: number): void {
    this.metadata.push({ operation, ...(handle === undefined ? {} : { handle }), tuple: Object.fromEntries(['dev', 'ino', 'mode', 'size', 'mtimeNs', 'ctimeNs'].map(field => [field, String(info[field as keyof BigIntStats])])) });
  }
  async dispose(): Promise<void> {
    for (const restore of this.restores) restore();
    if (this.handles.some(row => !row.closed)) throw new Error('Unclosed source descriptor at query return');
    if (dirname(this.root) !== await fs.realpath(tmpdir()) || !basename(this.root).startsWith('expec-source-capture-')) throw new Error('Unsafe fixture cleanup');
    await fs.rm(this.root, { recursive: true, force: true });
  }
}