import fs, { promises as files } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve, sep, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import childProcess from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { vi } from 'vitest';
import { unreadableFile } from './unreadable-file.js';
import { ConfigurationReader, ProjectConnector, TypeScriptContext, TypeScriptProject, FileProjectWriter,
  type ProjectContext, type ProjectSnapshot, type ArtifactAssociation, type ProjectRead, type ProjectSearch,
  type FileChange, type WriteResult } from '../../src/index.js';

type Options = { configFile?: string; imports?: readonly string[] };
export class NativeContextDriver {
  private readonly temporaryRoot = fs.realpathSync.native(tmpdir());
  readonly directory = fs.realpathSync.native(fs.mkdtempSync(join(this.temporaryRoot, 'expec-native-')));
  readonly root = join(this.directory, 'project');
  ordinary!: ProjectContext;
  context!: ProjectContext;
  native!: TypeScriptContext;
  snapshot!: ProjectSnapshot;
  remembered!: ProjectSnapshot;
  read!: ProjectRead;
  found!: ProjectSearch;
  receipt!: WriteResult;
  readonly associations: ArtifactAssociation[] = [];
  readonly forbidden: string[] = [];
  options: Options = {};
  changes: FileChange[] = [];
  dependencyBefore = new Map<string, string>();
  externalBefore = '';
  private interleave: { after: string; write: string; text: string } | undefined;
  private readonly restores: (() => void)[] = [];

  path(path: string): string {
    const full = resolve(this.root, path), part = relative(this.directory, full);
    if (isAbsolute(part) || part === '..' || part.startsWith('..' + sep)) throw Error('Fixture path escaped its owned temporary root.');
    return full;
  }
  async connect(): Promise<void> {
    await this.file('package.json', JSON.stringify({ name: 'native-consumer', type: 'module', private: true }));
    const configuration = new ConfigurationReader([]).read({ sourceId: 'manifest', text: JSON.stringify({ formatVersion: 1, version: '1.0.0', project: { root: '.' }, build: { entries: ['main.expec'] } }) });
    if (!configuration.value) throw Error(JSON.stringify(configuration.problems));
    const connection = await new ProjectConnector(this.path('expec.json')).connect(configuration.value);
    if (connection.value?.status !== 'connected') throw Error(JSON.stringify(connection));
    this.ordinary = connection.value.context; this.context = this.ordinary;
  }
  async file(path: string, text: string): Promise<void> { await files.mkdir(dirname(this.path(path)), { recursive: true }); await files.writeFile(this.path(path), text); }
  async package(name: string, metadata: object, entries: Record<string, string>): Promise<void> {
    await this.file(`node_modules/${name}/package.json`, JSON.stringify({ name: name.split('/node_modules/').at(-1), version: '1.0.0', ...metadata }));
    for (const [path, text] of Object.entries(entries)) await this.file(`node_modules/${name}/${path}`, text);
  }
  install(packages: Record<string, string>): Promise<void> { return copyInstalledPackages(this.root, packages); }
  select(id: string, file: string, declaration: { kind: string; name: string; static?: boolean }[]): void {
    this.associations.push({ specId: id, locator: { outputId: 'native', format: 'typescript-symbol-1', value: { file, declaration } } });
  }
  async capture(options?: Options): Promise<void> {
    if (options) this.options = structuredClone(options);
    this.native = new TypeScriptContext(this.context, this.options);
    this.snapshot = await this.native.readSnapshot();
    this.dependencyBefore = new Map((this.snapshot.readOnlyFiles ?? []).map(file => [file.path, Buffer.from(file.bytes).toString('hex')]));
  }
  query(): TypeScriptProject { return new TypeScriptProject({ outputId: 'native', ...(this.options.configFile ? { configFile: this.options.configFile } : {}) }, this.associations); }
  search(id: string): void { this.found = this.query().search(id, this.snapshot); }
  inspect(): void {
    const file = this.snapshot.files.find(file => /\.(?:[cm]?ts|tsx)$/.test(file.path));
    if (!file) throw Error('Native program example needs an actual project source.');
    const id = 'native-program-file';
    this.associations.push({ specId: id, locator: { outputId: 'native', format: 'typescript-file-1', value: { file: file.path } } });
    this.read = this.query().read(id, this.snapshot);
  }
  prepare(changes: ({ write: string; text: string } | { remove: string })[]): void {
    this.changes = changes.map(change => 'write' in change ? { kind: 'write', path: change.write, bytes: Buffer.from(change.text) } : { kind: 'remove', path: change.remove });
  }
  afterWrite(after: string, change: { write: string; text: string }): void { this.interleave = { after, ...change }; }
  async apply(decorated: boolean): Promise<void> {
    const context = decorated ? this.native : this.context;
    const wrapped: ProjectContext = { root: context.root, readSnapshot: async () => {
      if (this.interleave && fs.existsSync(this.path(this.interleave.after))) {
        await this.file(this.interleave.write, this.interleave.text); this.interleave = undefined;
      }
      return context.readSnapshot();
    } };
    this.receipt = await new FileProjectWriter(wrapped).apply({ basedOn: this.snapshot, changes: this.changes });
  }
  async unrelatedLink(name: string): Promise<void> {
    await files.mkdir(this.path('../unused'), { recursive: true }); await files.mkdir(this.path('node_modules/.bin'), { recursive: true });
    await files.symlink(this.path('../unused'), this.path('node_modules/.bin/' + name), process.platform === 'win32' ? 'junction' : 'dir');
  }
  async externalLink(name: string): Promise<void> {
    const external = this.path('../external-package');
    await files.rename(this.path('node_modules/' + name), external);
    this.externalBefore = await files.readFile(join(external, 'index.d.ts'), 'utf8');
    await files.symlink(external, this.path('node_modules/' + name), process.platform === 'win32' ? 'junction' : 'dir');
  }
  denyReads(mode: 'parent' | 'runtime'): void {
    const deny = (path: unknown): void => {
      const name = String(path).replaceAll('\\', '/'), directory = this.directory.replaceAll('\\', '/');
      const forbidden = mode === 'parent' ? name.startsWith(directory + '/node_modules') : name.startsWith(directory + '/project/node_modules/') && /\.(?:js|md)$/.test(name);
      if (forbidden) { this.forbidden.push(name); throw Error('Forbidden fixture read: ' + name); }
    };
    const read = fs.readFileSync.bind(fs), open = fs.openSync.bind(fs), asyncRead = files.readFile.bind(files), asyncOpen = files.open.bind(files);
    this.restores.push(vi.spyOn(fs, 'readFileSync').mockImplementation(((path: Parameters<typeof read>[0], ...args: unknown[]) => { deny(path); return Reflect.apply(read, fs, [path, ...args]); }) as typeof read).mockRestore);
    this.restores.push(vi.spyOn(fs, 'openSync').mockImplementation(((path: Parameters<typeof open>[0], ...args: unknown[]) => { deny(path); return Reflect.apply(open, fs, [path, ...args]); }) as typeof open).mockRestore);
    this.restores.push(vi.spyOn(files, 'readFile').mockImplementation(((path: Parameters<typeof asyncRead>[0], ...args: unknown[]) => { deny(path); return Reflect.apply(asyncRead, files, [path, ...args]); }) as typeof asyncRead).mockRestore);
    this.restores.push(vi.spyOn(files, 'open').mockImplementation(((path: Parameters<typeof asyncOpen>[0], ...args: unknown[]) => { deny(path); return Reflect.apply(asyncOpen, files, [path, ...args]); }) as typeof asyncOpen).mockRestore);
    const stop = (): never => { this.forbidden.push('process/network'); throw Error('Native capture cannot execute processes or use the network.'); };
    this.restores.push(vi.spyOn(childProcess, 'spawn').mockImplementation(stop).mockRestore,
      vi.spyOn(childProcess, 'exec').mockImplementation(stop).mockRestore, vi.spyOn(childProcess, 'execFile').mockImplementation(stop).mockRestore,
      vi.spyOn(http, 'request').mockImplementation(stop).mockRestore, vi.spyOn(https, 'request').mockImplementation(stop).mockRestore,
      vi.spyOn(net, 'connect').mockImplementation(stop).mockRestore, vi.spyOn(globalThis, 'fetch').mockImplementation(stop).mockRestore);
  }
  async unreadable(path: string, action: () => Promise<void>): Promise<void> {
    const release = await unreadableFile(this.path(path));
    try { await action(); } finally { await release(); }
  }
  async dispose(): Promise<void> {
    for (const restore of this.restores.reverse()) restore();
    const path = resolve(this.directory);
    if (dirname(path) !== this.temporaryRoot || !path.split(sep).at(-1)!.startsWith('expec-native-') || await files.realpath(path) !== path) throw Error('Unsafe fixture cleanup.');
    await files.rm(path, { recursive: true, force: true });
  }
  hash(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
}

export async function copyInstalledPackages(root: string, packages: Record<string, string>): Promise<void> {
    const modules = fileURLToPath(new URL('../../node_modules/', import.meta.url)), copied = new Set<string>();
    const copy = async (name: string, expected?: string): Promise<void> => {
      if (copied.has(name)) return; copied.add(name);
      const directory = join(modules, name), metadata = JSON.parse(await files.readFile(join(directory, 'package.json'), 'utf8'));
      if (expected && metadata.version !== expected) throw Error(`Fixture needs actual ${name}@${expected}, found ${metadata.version}`);
      await files.cp(directory, join(root, 'node_modules', name), { recursive: true, dereference: false });
      for (const dependency of Object.keys(metadata.dependencies ?? {})) await copy(dependency);
      for (const dependency of Object.keys(metadata.peerDependencies ?? {})) if (fs.existsSync(join(modules, dependency, 'package.json'))) await copy(dependency);
      for (const dependency of Object.keys(metadata.optionalDependencies ?? {})) if (fs.existsSync(join(modules, dependency, 'package.json'))) await copy(dependency);
    };
    for (const [name, version] of Object.entries(packages)) await copy(name, version);
  }
