import childProcess, { type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs, readFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { vi } from 'vitest';
import { FileProjectWriter, PythonProject, type Output, type ProjectSearch } from '../../../../src/index.js';
import { PythonAcceptanceDriver } from './python-acceptance.js';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Owns a real reader/opened output; subprocess observation never supplies an answer. */
export class PythonInspectionSessionDriver extends PythonAcceptanceDriver {
  readonly calls: { kind: 'base' | 'integrity'; closed: boolean; code?: number | null }[] = [];
  private reader!: PythonProject;
  private opened!: Output;
  private scenarioId = '';
  private stop?: () => void;
  previousSearch?: ProjectSearch;
  originalCapture?: typeof this.snapshot;
  originalVersion = '';
  rememberedHashes: { path: string; hash: string }[] = [];
  catalog = '';
  private observe(): void {
    const actual = childProcess.execFile;
    const custom = Reflect.get(actual, promisify.custom) as (...args: unknown[]) => Promise<{ stdout: string; stderr: string }> & { child: ChildProcess };
    const observer = vi.spyOn(childProcess, 'execFile').mockImplementation(actual);
    Object.defineProperty(observer, promisify.custom, { configurable: true, value: (...args: unknown[]) => {
      const returned = Reflect.apply(custom, actual, args), argv = args[1] as string[];
      if (Array.isArray(argv) && argv.some(arg => basename(arg) === 'inspect.py')) {
        const request = JSON.parse(readFileSync(argv.at(-1)!, 'utf8'));
        const call: { kind: 'base' | 'integrity'; closed: boolean; code?: number | null } = { kind: ('tests' in request ? 'integrity' : 'base') as 'base' | 'integrity', closed: false };
        this.calls.push(call); returned.child.once('close', code => { call.closed = true; call.code = code; });
      }
      return returned;
    } });
    syncBuiltinESMExports();
    this.stop = () => { observer.mockRestore(); syncBuiltinESMExports(); };
  }
  async openQuery(): Promise<void> {
    this.reader = this.query(); await this.capture(); this.originalCapture = this.snapshot;
    this.originalVersion = this.snapshot.files.find(file => file.path === 'src/caller.py')?.version ?? '';
    await this.rememberKnownFiles(); this.observe();
  }
  override async read(id: string): Promise<void> { this.readResult = await this.reader.read(id, this.snapshot); }
  override async search(id: string): Promise<void> { this.searchResult = await this.reader.search(id, this.snapshot); }
  replaceSupplied(path: string, text: string): void {
    const file = this.snapshot.files.find(file => file.path === path); if (!file) throw Error('Supplied source is missing.');
    (file as { bytes: Uint8Array }).bytes = Buffer.from(text);
  }
  async installCatalog(text: string): Promise<void> {
    this.catalog = join(this.root, '.venv', ...(process.platform === 'win32' ? ['Lib', 'site-packages'] : ['lib', 'python3.12', 'site-packages']), 'catalog', '__init__.py');
    await fs.mkdir(dirname(this.catalog), { recursive: true }); await fs.writeFile(this.catalog, text);
  }
  replaceCatalog(text: string): Promise<void> { return fs.writeFile(this.catalog, text); }
  async openScenario(): Promise<void> {
    const scenario = [...this.current.specification.inspection.query('scenario')][0];
    if (!scenario) throw Error('The authored shopping scenario is absent.'); this.scenarioId = this.current.id(scenario.id);
    const output = this.outputs.open('python-acceptance', { domain: 'shopping' }, this.context, new FileProjectWriter(this.context));
    if (!output.value) throw Error(JSON.stringify(output)); this.opened = output.value;
    await this.capture(); await this.rememberKnownFiles(); this.observe();
  }
  override async readScenario(): Promise<void> { this.scenarioRead = await this.opened.read(this.scenarioId); }
  async searchScenario(): Promise<void> { this.searchResult = await this.opened.search(this.scenarioId); }
  async rememberKnownFiles(): Promise<void> { this.rememberedHashes = this.snapshot.files.map(file => ({ path: file.path, hash: hash(file.bytes) })); }
  async knownHashes(): Promise<{ path: string; hash: string }[]> {
    return Promise.all(this.rememberedHashes.map(async file => ({ path: file.path, hash: hash(await fs.readFile(join(this.root, file.path))) })));
  }
  override async dispose(): Promise<void> { this.stop?.(); await super.dispose(); }
}