import { promises as fs, writeFileSync } from 'node:fs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { vi } from 'vitest';
import { FileProjectWriter, type OutputPlan, type ProjectSnapshot, type WriteResult } from '../../src/index.js';
import { PythonPreservationDriver } from './python-preservation.js';

/** Actual native inputs and process observations around public Python queries and plans. */
export class PythonNativeLifetimeDriver extends PythonPreservationDriver {
  catalog = '';
  plan!: OutputPlan;
  receipt!: WriteResult;
  before!: ProjectSnapshot;
  previousSearch!: typeof this.searchResult;
  capturedIdentity!: ProjectSnapshot;
  capturedVersion = '';
  readonly process = { started: false, answered: false, closed: false, changed: false, output: '', mutationError: '', scratch: '' };
  readonly canaries: string[] = [];
  nestedMarker = '';
  queryAudit = false;
  private sites(): string { return join(this.root, '.venv', ...(process.platform === 'win32' ? ['Lib', 'site-packages'] : ['lib', 'python3.12', 'site-packages'])); }
  async installCatalog(): Promise<void> {
    this.catalog = join(this.sites(), 'catalog', '__init__.py'); await fs.mkdir(dirname(this.catalog), { recursive: true });
    await fs.writeFile(this.catalog, 'class Book:\n    title: str\n');
    await this.file('src/store.py', 'from catalog import Book\nclass StoreGame:\n    def save(self, book: Book) -> None:\n        self.book = book\n');
    this.map('StoreGame', 'src/store.py', [{ kind: 'class', name: 'StoreGame' }]);
    this.map('StoreGame.save', 'src/store.py', [{ kind: 'class', name: 'StoreGame' }, { kind: 'method', name: 'save' }]);
  }
  changeCatalog(): Promise<void> { return fs.writeFile(this.catalog, 'class Book:\n    title: int\n'); }
  async searchCapture(id: string): Promise<void> { this.searchResult = await this.query().search(id, this.snapshot); }
  async planStoreRename(): Promise<void> {
    await fs.unlink(join(this.root, 'src/store.py'));
    this.source('class StoreGame { public save\ncapability save(title: Text) returns Nothing }');
    await this.generate();
    if (!this.written.artifacts || this.written.problems.length) throw new Error(JSON.stringify(this.written));
    const generated = await this.text('src/store/contracts.py');
    await this.file('src/store/contracts.py', generated.replace('from __future__ import annotations\n', 'from __future__ import annotations\nfrom catalog import Book\n'));
    const before = this.current.baseline, specification = this.compile('class StoreGame { public saveGame\ncapability saveGame(title: Text) returns Nothing }');
    const old = [...this.current.specification.inspection.query('capability')][0]!, next = [...specification.inspection.query('capability')][0]!;
    const identified = this.identity.associate(specification, before, [{ id: this.current.id(old.id), to: next.id }]);
    if (!identified.value) throw new Error(JSON.stringify(identified)); this.current = identified.value;
    const diff = this.identity.compare(before, this.current); if (!diff.value) throw new Error(JSON.stringify(diff));
    this.before = await this.context.readSnapshot();
    const opened = this.outputs.open('python', { module: 'store.contracts' }, this.context, new FileProjectWriter(this.context));
    if (!opened.value) throw new Error(JSON.stringify(opened));
    const plan = await opened.value.plan({ operation: 'update', diff: diff.value, current: this.current }, this.before);
    if (!plan.value) throw new Error('The actual rename plan was not available: ' + JSON.stringify(plan)); this.plan = plan.value;
  }
  async applyPlan(): Promise<void> { this.receipt = await new FileProjectWriter(this.context).apply(this.plan); }
  async generatedStore(): Promise<void> {
    this.source('type Snapshot { title: Text }\nclass StoreGame { public save\ncapability save(snapshot: Snapshot) returns Nothing }');
    await this.generate();
    if (!this.written.artifacts || this.written.problems.length) throw new Error(JSON.stringify(this.written));
    await this.file('src/caller.py', 'from store.contracts import StoreGame, Snapshot\n');
    this.associations.push(...this.current.baseline.artifacts);
  }
  id(name: string): string {
    const found = this.current.baseline.elements.filter(item => item.address.name === name);
    if (found.length !== 1) throw new Error('Expected one authored identity for ' + name); return found[0]!.id;
  }
  replaceCapturedCaller(text: string): void {
    this.previousSearch = structuredClone(this.searchResult); this.capturedIdentity = this.snapshot;
    const file = this.snapshot.files.find(file => file.path === 'src/caller.py');
    if (!file) throw new Error('The example must first capture its caller file.');
    this.capturedVersion = file.version; Object.assign(file, { bytes: Buffer.from(text) });
  }
  async observeQuery(id: string, change = false, audit = false): Promise<void> {
    const original = childProcess.execFile, trace = this.process;
    const invoke = (...args: unknown[]) => {
      const nativeArgs = args[1] as string[], at = Array.isArray(nativeArgs) ? nativeArgs.findIndex(value => /[/\\]python[/\\]inspect\.py$/.test(value)) : -1;
      if (at >= 0 && audit) {
        const bootstrap = 'import sys, pathlib, runpy\nmarker = pathlib.Path(' + JSON.stringify(this.nestedMarker) + ')\n'
          + 'def observe(event, args):\n    if event == "subprocess.Popen" and pathlib.Path(str(args[0])).name.lower().startswith("python"):\n        marker.write_text(str(args), encoding="utf-8")\n'
          + 'sys.addaudithook(observe)\nsys.argv = sys.argv[1:]\nrunpy.run_path(sys.argv[0], run_name="__main__")\n';
        args[1] = [...nativeArgs.slice(0, at), '-c', bootstrap, ...nativeArgs.slice(at)]; this.queryAudit = true;
      }
      const child = Reflect.apply(original, childProcess, args);
      if (at >= 0) {
        trace.started = true; trace.scratch = dirname(nativeArgs[at + 1]!);
        child.stdout!.on('data', (data: Buffer) => { trace.output += String(data); });
        child.stdout!.once('data', () => {
          trace.answered = true;
          if (change) try { writeFileSync(this.catalog, 'class Book:\n    title: int\n'); trace.changed = true; }
          catch (error) { trace.mutationError = String(error); }
        });
        child.once('close', () => { trace.closed = true; });
      }
      return child;
    };
    const observation = vi.spyOn(childProcess, 'execFile').mockImplementation(invoke as typeof original);
    // Retain Node's real stdout/stderr promise shape while forwarding the actual child and callback.
    Object.defineProperty(observation, promisify.custom, { configurable: true, value: (...args: unknown[]) => new Promise((resolve, reject) => {
      invoke(...args, (error: Error | null, stdout: string, stderr: string) => error ? reject(Object.assign(error, { stdout, stderr })) : resolve({ stdout, stderr }));
    }) });
    syncBuiltinESMExports();
    try { await this.searchCapture(id); }
    finally { observation.mockRestore(); syncBuiltinESMExports(); }
  }
  async executionCanaries(): Promise<void> {
    const sites = this.sites(), hook = (marker: string) => 'import pathlib; pathlib.Path(' + JSON.stringify(marker) + ').write_text("executed")\n';
    for (const name of ['sitecustomize.py', 'usercustomize.py', 'probe.pth']) {
      const marker = join(this.directory, name + '.executed'); this.canaries.push(marker);
      await fs.writeFile(join(sites, name), hook(marker));
    }
    const application = join(this.directory, 'application.executed'); this.canaries.push(application);
    await this.file('src/store/contracts.py', hook(application) + 'class StoreGame:\n    def save(self, title: str) -> None:\n        self.title = title\n');
    const control = await this.python('import sys, site, runpy; site.addsitedir(sys.argv[1]); import sitecustomize, usercustomize; runpy.run_path(sys.argv[2])', [sites, join(this.root, 'src/store/contracts.py')]);
    if (control.code) throw new Error(control.text);
    for (const marker of this.canaries) { if (await fs.readFile(marker, 'utf8') !== 'executed') throw new Error('The actual execution canary did not work: ' + marker); await fs.unlink(marker); }
    this.nestedMarker = join(this.directory, 'nested-python.executed');
    this.map('StoreGame.save', 'src/store/contracts.py', [{ kind: 'class', name: 'StoreGame' }, { kind: 'method', name: 'save' }]);
  }
}
