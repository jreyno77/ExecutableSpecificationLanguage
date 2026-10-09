import fs, { type BigIntStats } from 'node:fs';
import { vi } from 'vitest';
import { NativeDeclarations } from '../../../../src/project/typescript/native-declarations.js';
import { NativeContextDriver } from './typescript-context.js';

type FirstFault = 'none' | 'open-status' | 'open-mode' | 'open-size' | 'open-mtime' | 'open-identity' | 'status' | 'mode' | 'identity' | 'mtime' | 'before-open' | 'named-after' | 'repeated';
type SecondFault = 'none' | 'open-status' | 'named-status' | 'read-error' | 'link' | 'route';
type Handle = { initial: boolean; number: number; reads: number; stats: number };
const tuple = (info: BigIntStats) => [info.dev, info.ino, info.mode, info.size, info.mtimeNs, info.ctimeNs].map(String);

/** Finite faults at one native declaration's actual read boundaries. */
export class NativeSettlingDriver {
  readonly project = new NativeContextDriver();
  selected = 'node_modules/catalog/index.d.ts';
  input: NativeDeclarations | undefined;
  text: string | undefined;
  first: FirstFault = 'none';
  second: SecondFault = 'none';
  replacement: string | undefined;
  identityText: string | undefined;
  readErrorCode: 'EIO' = 'EIO';
  pinSecondStatus = false;
  route: { path: string; text: string } | undefined;
  readonly bodies: string[] = [];
  readonly secondMetadata: string[][] = [];
  readAttempts = 0;
  opened = 0;
  closed = 0;
  linkTargetOpens = 0;
  private initialOpens = 0;
  private initial = false;
  private firstClosed = false;
  private status: bigint | undefined;
  private beforeStatus: bigint | undefined;
  private candidate: string[] | undefined;
  private additionalReadStatus = false;
  private initialNamedStatus = false;
  private altered = false;
  private linked = false;
  private installed = false;
  private readonly handles = new Map<number, Handle>();
  private readonly required = new Set<string>();
  private readonly reached = new Set<string>();
  private readonly restores: (() => void)[] = [];
  private closeOwnedHandle: ((handle: number) => void) | undefined;

  select(path: string): void { if (this.installed && path !== this.selected) throw Error('A settling fixture owns one selected path.'); this.selected = path; }
  firstFault(path: string, fault: FirstFault): void { this.select(path); this.first = fault; this.required.add('first-' + fault); }
  addFirstReadStatusChange(): void { this.additionalReadStatus = true; this.required.add('first-read-status-again'); }
  addInitialNamedStatusChange(): void { this.initialNamedStatus = true; this.required.add('first-named-after'); }
  secondFault(fault: SecondFault): void { this.second = fault; this.required.add('second-' + fault); }
  replaceBytes(text: string): void {
    this.replacement = text; this.required.add('replacement');
    const fixed = new Date('2020-01-01T00:00:00.000Z'); fs.utimesSync(this.project.path(this.selected), fixed, fixed);
  }
  pinStatus(): void { this.pinSecondStatus = true; this.required.add('pinned-second-status'); }
  afterFinalCapture(): void {
    const original = this.project.context; let reads = 0; this.required.add('final-status');
    this.project.context = { root: original.root, readSnapshot: async () => {
      const snapshot = await original.readSnapshot();
      if (++reads === 2) { this.status = (this.status ?? this.beforeStatus ?? 0n) + 1n; this.reached.add('final-status'); }
      return snapshot;
    } };
  }
  async prepareLink(): Promise<void> {
    await this.project.file('../settling-link-target/index.d.ts', 'export interface LinkTarget {}'); this.secondFault('link');
  }
  async capture(options: { imports: readonly string[] }): Promise<void> {
    this.install(); await this.project.capture(options); this.attestEffects();
  }
  read(): void {
    this.install(); this.input = new NativeDeclarations(this.project.context.root, []);
    this.text = this.input.read(this.selected); this.attestEffects();
  }
  metadataAgrees(): boolean { return this.secondMetadata.length === 4 && this.secondMetadata.every(info => JSON.stringify(info) === JSON.stringify(this.candidate)); }
  descriptorsClosed(): boolean { return !this.handles.size && this.opened === this.closed; }
  private attestEffects(): void {
    const absent = [...this.required].filter(phase => !this.reached.has(phase)), failures: string[] = [];
    if (absent.length) failures.push('Selected native fault phases were not reached: ' + absent.join(', '));
    if (!this.descriptorsClosed()) failures.push(`Selected native descriptors remain open: ${this.opened} opened, ${this.closed} closed, ${this.handles.size} owned`);
    if (failures.length) throw Error(failures.join('; '));
  }
  private patch(info: BigIntStats, handle?: Handle, named = false): BigIntStats {
    this.beforeStatus ??= info.ctimeNs;
    if (this.first === 'open-status' && handle?.initial && handle.number === 1 && handle.stats === 1) {
      this.status = this.beforeStatus + 1n; this.reached.add('first-open-status');
    }
    const changed: Partial<BigIntStats> = {};
    if (handle?.initial && handle.number === 1 && handle.stats === 1) {
      if (this.first === 'open-mode') changed.mode = info.mode ^ 0o100n;
      if (this.first === 'open-size') changed.size = info.size + 1n;
      if (this.first === 'open-mtime') changed.mtimeNs = info.mtimeNs + 1n;
      if (this.first === 'open-identity') changed.ino = info.ino + 1n;
      if (this.first.startsWith('open-')) this.reached.add('first-' + this.first);
    }
    if (this.status !== undefined) changed.ctimeNs = this.status;
    const settling = this.initial && this.firstClosed && this.initialOpens <= 2;
    if (this.altered && this.replacement !== undefined) {
      changed.ctimeNs = this.pinSecondStatus && settling ? this.status! : info.ctimeNs;
      if (this.pinSecondStatus && settling) this.reached.add('pinned-second-status');
    }
    if (this.first === 'before-open' && handle?.initial && handle.number === 1 && handle.stats === 1) {
      changed.ctimeNs = this.beforeStatus + 1n; this.reached.add('first-before-open');
    }
    if (this.altered && this.first === 'mode') { changed.mode = info.mode ^ 0o100n; this.reached.add('first-mode'); }
    if (this.altered && this.first === 'mtime') { changed.mtimeNs = info.mtimeNs + 1n; this.reached.add('first-mtime'); }
    if (named && this.initial && !this.firstClosed && this.bodies.length && (this.first === 'named-after' || this.initialNamedStatus)) {
      changed.ctimeNs = this.status! + 1n; this.reached.add('first-named-after');
    }
    if (handle?.initial && handle.number === 2 && handle.stats === 1 && this.second === 'open-status') {
      changed.ctimeNs = this.status! + 1n; this.reached.add('second-open-status');
    }
    if (named && this.initial && this.initialOpens === 2 && this.bodies.length === 2 && this.second === 'named-status') {
      changed.ctimeNs = this.status! + 1n; this.reached.add('second-named-status');
    }
    const observed = Object.assign(Object.create(Object.getPrototypeOf(info)), info, changed) as BigIntStats;
    if (handle?.initial && handle.number === 1 && handle.stats === 2) this.candidate = tuple(observed);
    if (settling && (named || handle?.initial && handle.number === 2)) this.secondMetadata.push(tuple(observed));
    return observed;
  }
  private install(): void {
    if (this.installed) return; this.installed = true;
    const driver = this, selected = this.project.path(this.selected);
    const nativeRead = NativeDeclarations.prototype.read, open = fs.openSync.bind(fs), read = fs.readFileSync.bind(fs);
    const stat = fs.fstatSync.bind(fs), named = fs.lstatSync.bind(fs), close = fs.closeSync.bind(fs);
    this.closeOwnedHandle = close;
    this.restores.push(vi.spyOn(NativeDeclarations.prototype, 'read').mockImplementation(function (this: NativeDeclarations, path: string) {
      const previous = driver.initial; driver.initial = path === driver.selected;
      try { return nativeRead.call(this, path); } finally { driver.initial = previous; }
    }).mockRestore);
    this.restores.push(vi.spyOn(fs, 'openSync').mockImplementation(((path: fs.PathLike, ...args: unknown[]) => {
      const handle = Reflect.apply(open, fs, [path, ...args]);
      if (String(path) === selected && args[0] === 'r') {
        driver.opened++; if (driver.linked) driver.linkTargetOpens++;
        driver.handles.set(handle, { initial: driver.initial, number: driver.initial ? ++driver.initialOpens : 0, reads: 0, stats: 0 });
      } else if (args[0] === 'r' && String(path).startsWith(driver.project.path('../settling-link-target'))) driver.linkTargetOpens++;
      return handle;
    }) as typeof fs.openSync).mockRestore);
    this.restores.push(vi.spyOn(fs, 'fstatSync').mockImplementation(((handle: number, ...args: unknown[]) => {
      const info = Reflect.apply(stat, fs, [handle, ...args]), observation = driver.handles.get(handle);
      if (!observation) return info; observation.stats++;
      return driver.patch(info as BigIntStats, observation);
    }) as typeof fs.fstatSync).mockRestore);
    this.restores.push(vi.spyOn(fs, 'lstatSync').mockImplementation(((path: fs.PathLike, ...args: unknown[]) => {
      const info = Reflect.apply(named, fs, [path, ...args]);
      return String(path) === selected ? driver.patch(info as BigIntStats, undefined, true) : info;
    }) as typeof fs.lstatSync).mockRestore);
    this.restores.push(vi.spyOn(fs, 'readFileSync').mockImplementation(((path: fs.PathOrFileDescriptor, ...args: unknown[]) => {
      const observation = typeof path === 'number' ? driver.handles.get(path) : undefined;
      if (observation?.initial) {
        driver.readAttempts++;
        if (observation.number === 2 && driver.second === 'read-error') {
          driver.reached.add('second-read-error'); throw Object.assign(Error('Injected settling read failure'), { code: driver.readErrorCode });
        }
        if (observation.number === 2 && driver.second === 'route') {
          if (!driver.route) throw Error('A route effect needs an actual declaration path and body.');
          fs.writeFileSync(driver.project.path(driver.route.path), driver.route.text); driver.reached.add('second-route');
        }
      }
      const bytes = Reflect.apply(read, fs, [path, ...args]);
      if (observation?.initial) {
        if (!Buffer.isBuffer(bytes)) throw Error('Selected native descriptor must return actual bytes.');
        observation.reads++; driver.bodies.push(bytes.toString('utf8'));
        if (observation.number === 1 && driver.first !== 'none' && driver.first !== 'before-open' && !driver.first.startsWith('open-')) {
          if (!['mode', 'mtime', 'named-after'].includes(driver.first)) driver.reached.add('first-' + driver.first);
          driver.status = driver.beforeStatus! + 1n;
          if (driver.first === 'identity') {
            if (driver.identityText === undefined) throw Error('Replacement identity needs an explicit declaration body.');
            fs.unlinkSync(selected); fs.writeFileSync(selected, driver.identityText);
          }
          if (driver.first === 'mode' || driver.first === 'mtime') driver.altered = true;
        }
        if (observation.number === 1 && driver.additionalReadStatus) {
          driver.status = (driver.status ?? driver.beforeStatus!) + 1n; driver.reached.add('first-read-status-again');
        }
        if (driver.first === 'repeated') driver.status = driver.beforeStatus! + BigInt(driver.bodies.length);
      }
      return bytes;
    }) as typeof fs.readFileSync).mockRestore);
    this.restores.push(vi.spyOn(fs, 'closeSync').mockImplementation((handle: number) => {
      const observation = driver.handles.get(handle); close(handle);
      if (!observation) return; driver.handles.delete(handle); driver.closed++;
      if (!observation.initial || observation.number !== 1) return; driver.firstClosed = true;
      if (driver.replacement !== undefined) {
        fs.writeFileSync(selected, driver.replacement); const fixed = new Date('2020-01-01T00:00:00.000Z'); fs.utimesSync(selected, fixed, fixed);
        driver.altered = true; driver.reached.add('replacement');
      }
      if (driver.second === 'link') {
        fs.unlinkSync(selected); fs.symlinkSync(driver.project.path('../settling-link-target'), selected, process.platform === 'win32' ? 'junction' : 'dir');
        driver.linked = true; driver.reached.add('second-link');
      }
    }).mockRestore);
  }
  async dispose(): Promise<void> {
    const failures: unknown[] = [];
    for (const restore of this.restores.reverse()) { try { restore(); } catch (error) { failures.push(error); } }
    for (const handle of this.handles.keys()) { try { this.closeOwnedHandle!(handle); } catch (error) { failures.push(error); } }
    this.handles.clear();
    try { await this.project.dispose(); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, 'Could not dispose the owned native settling fixture.');
  }
}