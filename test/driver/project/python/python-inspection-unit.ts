import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { vi } from 'vitest';
import { PythonContext, PythonProject, type ProjectRead, type ProjectSearch, type ProjectSnapshot } from '../../../../src/index.js';
import * as analyzer from '../../../../src/project/python/python-process.js';
import { PythonInspection } from '../../../../src/project/python/python-inspection.js';

const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const store = 'class StoreGame:\n    pass\n';
const facts = { files: ['src/store.py'], declarations: [{ file: 'src/store.py', declaration: [{ kind: 'class', name: 'StoreGame' }],
  start: 6, end: 15, begin: 0, finish: store.length, target: { file: 'src/store.py', line: 1, column: 6, name: 'StoreGame', kind: 'class', builtin: false } }], uses: [], problems: [] };

/** Real tiny native inventories; only the analyzer's independent DTO is controlled. */
export class PythonInspectionUnitDriver {
  root = ''; catalog = ''; snapshot!: ProjectSnapshot; reader!: PythonProject;
  attempts = 0; readonly catalogHashes: string[] = [];
  private readonly restore: (() => void)[] = [];
  private readonly queries: Promise<unknown>[] = [];
  private failure: 'json' | 'schema' | 'nonzero' | 'throw' | 'semantic' | undefined;
  private readonly inspection = new PythonInspection();
  private held: { started: () => void; done: Promise<void> } | undefined;
  private entered?: Promise<void>;
  private release?: () => void;
  private heldRead: { entered: () => void; done: Promise<void> } | undefined;
  private readEntered?: Promise<void>;
  private releaseRead?: () => void;
  cleanupChanged = false; scratchDisposed = false;
  readonly associations = [{ specId: 'store', locator: { outputId: 'python', format: 'python-symbol-1', value: { file: 'src/store.py', declaration: [{ kind: 'class', name: 'StoreGame' }] } } }];
  async initialize(): Promise<void> {
    this.root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'expec-python-session-unit-'));
    const sites = join(this.root, '.venv', 'sites'), standard = join(this.root, 'stdlib');
    await fs.mkdir(sites, { recursive: true }); await fs.mkdir(standard);
    for (const name of ['python', 'uv']) await fs.writeFile(join(this.root, name), name);
    this.catalog = join(sites, 'book.pyi'); await fs.writeFile(this.catalog, 'class Book: ...\n');
    const profile = JSON.stringify({ format: 1, python: join(this.root, 'python'), uv: join(this.root, 'uv'), sourceRoots: { main: ['src'], test: ['test'] }, environment: '.venv' });
    const report = { format: 1, config: hash(profile), pyproject: hash('project'), lock: hash('lock'),
      python: { path: join(this.root, 'python'), version: '3.12.14', stdlib: [standard], binaries: [] },
      uv: { path: join(this.root, 'uv'), version: '0.12.23' }, environment: { path: join(this.root, '.venv'), sites: [sites] },
      tools: { libcst: '1.9.0', jedi: '0.20.0', mypy: '2.4.0', pytest: '9.1.1' }, packages: [] };
    const files = { 'expec.python.json': profile, 'pyproject.toml': 'project', 'uv.lock': 'lock', '.expec/python/environment.json': JSON.stringify(report), 'src/store.py': store };
    const supplied: ProjectSnapshot = { root: { path: this.root, identity: this.root }, complete: true, problems: [], excluded: [], excludeNames: ['.venv'],
      files: Object.entries(files).map(([path, text]) => ({ path, bytes: Buffer.from(text), version: hash(text) })) };
    this.snapshot = await new PythonContext({ root: supplied.root, readSnapshot: async () => structuredClone(supplied) }).readSnapshot();
    if (!this.snapshot.complete) throw Error(JSON.stringify(this.snapshot.problems));
    this.reader = this.newReader();
    const read = fs.readFile;
    const observe = vi.spyOn(fs, 'readFile').mockImplementation((async (...args: Parameters<typeof fs.readFile>) => {
      const value = await Reflect.apply(read, fs, args) as Buffer | string;
      if (resolve(String(args[0])) === this.catalog) {
        this.catalogHashes.push(hash(value)); const held = this.heldRead; this.heldRead = undefined;
        if (held) { held.entered(); await held.done; }
      }
      return value;
    }) as typeof fs.readFile);
    this.restore.push(() => observe.mockRestore());
    const analysis = vi.spyOn(analyzer, 'runPython').mockImplementation(async () => {
      this.attempts++; const held = this.held, failure = this.failure; this.held = undefined; this.failure = undefined;
      if (held) { held.started(); await held.done; }
      if (failure === 'throw') throw Error('Owned analyzer failed.');
      if (failure === 'nonzero') return { code: 1, text: JSON.stringify(facts) };
      if (failure === 'json') return { code: 0, text: '{' };
      if (failure === 'schema') return { code: 0, text: '{}' };
      return { code: 0, text: JSON.stringify(failure === 'semantic' ? { ...facts,
        problems: [{ code: 'generated-tests-changed', file: 'test/acceptance/test_store.py', message: 'Controlled native assertion mismatch.' }] } : facts) };
    });
    this.restore.push(() => analysis.mockRestore());
  }
  newReader(): PythonProject { return new PythonProject({ outputId: 'python' }, this.associations); }
  read(reader = this.reader): Promise<ProjectRead> { const query = reader.read('store', this.snapshot); this.queries.push(query); return query; }
  search(reader = this.reader): Promise<ProjectSearch> { const query = reader.search('store', this.snapshot); this.queries.push(query); return query; }
  invalidNext(): void { this.failure = 'json'; }
  failNext(failure: 'schema' | 'nonzero' | 'throw' | 'semantic'): void { this.failure = failure; }
  inspect(tests?: readonly { file: string; text: string; driver: boolean }[], configFile?: string) {
    const query = this.inspection.inspect(this.snapshot, configFile, tests); this.queries.push(query); return query;
  }
  copyConfiguration(path: string): void {
    const original = this.snapshot.files.find(file => file.path === 'expec.python.json')!;
    this.snapshot = { ...this.snapshot, files: [...this.snapshot.files, { ...original, path, bytes: Uint8Array.from(original.bytes) }] };
  }
  holdNext(): void {
    this.entered = new Promise(resolve => { this.held = { started: resolve, done: new Promise(done => { this.release = done; }) }; });
  }
  started(): Promise<void> { return this.entered!; }
  finishHeld(): void { this.release!(); }
  holdNextCatalogRead(): void {
    this.readEntered = new Promise(entered => { this.heldRead = { entered, done: new Promise(done => { this.releaseRead = done; }) }; });
  }
  catalogReadStarted(): Promise<void> { return this.readEntered!; }
  releaseCatalogRead(): void { this.releaseRead!(); }
  changeSupplied(text: string): void {
    this.snapshot = { ...this.snapshot, files: this.snapshot.files.map(file => file.path === 'src/store.py' ? { ...file, bytes: Buffer.from(text) } : file) };
  }
  changeNative(): Promise<void> { return fs.writeFile(this.catalog, 'class Cart: ...\n'); }
  nativeVersion(version: string): void {
    const normalized = this.catalog.replaceAll('\\', '/');
    this.snapshot = { ...this.snapshot, nativeInputs: this.snapshot.nativeInputs!.map(input => decodeURIComponent(input.uri).endsWith(normalized.split('/').slice(-3).join('/')) ? { ...input, version } : input) };
  }
  changeDuringCleanup(): void {
    const remove = fs.rm;
    const observed = vi.spyOn(fs, 'rm').mockImplementation(async (...args) => {
      await Reflect.apply(remove, fs, args);
      if (String(args[0]).split(/[\\/]/).at(-1)?.startsWith('expec-python-query-') && !this.cleanupChanged) {
        this.scratchDisposed = await fs.stat(String(args[0])).then(() => false, error => { if (error.code !== 'ENOENT') throw error; return true; });
        await this.changeNative(); this.cleanupChanged = true;
      }
    });
    this.restore.push(() => observed.mockRestore());
  }
  failDuringCleanup(): void {
    const remove = fs.rm;
    const observed = vi.spyOn(fs, 'rm').mockImplementation(async (...args) => {
      await Reflect.apply(remove, fs, args);
      if (String(args[0]).split(/[\\/]/).at(-1)?.startsWith('expec-python-query-')) throw Error('Owned scratch cleanup failed.');
    });
    this.restore.push(() => observed.mockRestore());
  }
  async dispose(): Promise<void> {
    this.release?.(); this.releaseRead?.(); await Promise.allSettled(this.queries); for (const restore of this.restore.reverse()) restore();
    if (!this.root) return;
    const root = await fs.realpath(this.root), within = relative(await fs.realpath(tmpdir()), root);
    if (!within || isAbsolute(within) || within === '..' || within.startsWith('..' + (process.platform === 'win32' ? '\\' : '/'))) throw Error('Unexpected native fixture root.');
    await fs.rm(root, { recursive: true, force: true });
  }
}
