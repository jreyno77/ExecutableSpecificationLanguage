import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import processTools from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { vi } from 'vitest';
import { Compiler, ConfigurationReader, Outputs, ProjectConnector, ProjectInitializer, FileProjectWriter, LangiumReader, LangiumModel, SourceComposer, SpecificationIdentity, typescriptOutput, type Check, type Configuration,
  type InitializationPlan, type InitializationResult, type ProjectConnection } from '../../src/index.js';

export class InitializationDriver {
  directory!: string;
  manifest!: string;
  manifestText!: string;
  configuration!: Configuration;
  initializer!: ProjectInitializer;
  prepared!: Check<InitializationPlan>;
  result: InitializationResult | undefined;
  connection!: Check<ProjectConnection>;
  destination = '';
  readonly remembered = new Map<string, unknown>();
  readonly restores = new Map<string, () => void>();
  readonly forbidden: string[] = [];
  native: { code: number; text: string } | undefined;
  compilerDirectory: string | undefined;
  runtime: { code: number; text: string } | undefined;
  async generateTypeScript(text: string): Promise<void> {
    const read = new LangiumReader().read({ sourceId: 'store.expec', text });
    if (read.status !== 'accepted') throw new Error(JSON.stringify(read));
    const checked = new Compiler().compile({ resolution: new SourceComposer().compose(new LangiumModel('store', read.document), { modules: [], packages: [] }) });
    if (!checked.value) throw new Error(JSON.stringify(checked));
    const identified = new SpecificationIdentity(randomUUID).associate(checked.value);
    if (!identified.value || !this.result?.value) throw new Error('Need checked contracts and a successful initialized connection.');
    const { context, configuration } = this.result.value, outputs = new Outputs(); outputs.register(typescriptOutput);
    const opened = outputs.open('typescript', configuration.outputs.find(output => output.id === 'typescript')!.options, context, new FileProjectWriter(context));
    if (!opened.value) throw new Error(JSON.stringify(opened));
    const written = await opened.value.create(identified.value);
    if (written.problems.length || written.receipt?.status !== 'applied') throw new Error(JSON.stringify(written));
  }
  async runConsumer(text: string): Promise<void> {
    try {
      const result = await promisify(processTools.execFile)(process.execPath, ['--input-type=module', '--eval', text],
        { cwd: this.destination, windowsHide: true, timeout: 10000 });
      this.runtime = { code: 0, text: result.stdout + result.stderr };
    } catch (error) {
      const result = error as { code?: unknown; stdout?: string; stderr?: string };
      if (typeof result.code !== 'number') throw error;
      this.runtime = { code: result.code, text: (result.stdout ?? '') + (result.stderr ?? '') };
    }
  }
  async initialize(input?: Record<string, unknown>): Promise<void> {
    this.directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'expec-init-')));
    this.manifest = join(this.directory, 'spec', 'expec.json');
    const manifest = input ?? { formatVersion: 1, version: '0.1.0', build: { entries: ['store.expec'] } };
    this.manifestText = JSON.stringify(manifest);
    await fs.mkdir(dirname(this.manifest)); await fs.writeFile(this.manifest, this.manifestText);
    const outputs = Array.isArray(manifest.outputs) ? manifest.outputs as { id: string }[] : [];
    const configuration = new ConfigurationReader(outputs.map(output => ({ id: output.id, validate: () => [] })))
      .read({ sourceId: 'settings', text: this.manifestText });
    if (!configuration.value) throw new Error(JSON.stringify(configuration));
    this.configuration = configuration.value;
    this.remembered.set('configuration', structuredClone(this.configuration));
    this.initializer = new ProjectInitializer(this.manifest, this.configuration);
  }
  async prepare(root: string, target: string, javaHome?: string): Promise<void> {
    this.destination = this.relativeToManifest(root); this.result = undefined;
    this.prepared = await this.initializer.prepare({ root, target, ...(javaHome ? { javaHome } : {}) });
  }
  async preparePython(root: string, python = process.env.EXPEC_TEST_PYTHON, uv = process.env.EXPEC_TEST_UV): Promise<void> {
    if (!python || !uv) throw Error('Provide the explicitly provisioned Python and uv executables.');
    this.destination = this.relativeToManifest(root); this.result = undefined;
    const choice = { root, target: 'python', python, uv }; this.prepared = await this.initializer.prepare(choice);
  }
  async pythonProjectVersion(): Promise<string> {
    const result = await promisify(processTools.execFile)(process.env.EXPEC_TEST_PYTHON!, ['-I', '-S', '-B', '-c',
      'import sys,tomllib; print(tomllib.load(open(sys.argv[1], "rb"))["project"]["version"])', join(this.destination, 'pyproject.toml')],
    { cwd: this.destination, windowsHide: true, timeout: 10_000 });
    return result.stdout.trim();
  }
  async apply(accepted: boolean, signal?: AbortSignal): Promise<void> {
    if (!this.prepared.value) throw new Error('No initialization preview: ' + JSON.stringify(this.prepared));
    this.result = await this.initializer.apply(this.prepared.value, accepted, signal);
  }
  path(path: string): string {
    const absolute = resolve(this.directory, path), inside = relative(this.directory, absolute);
    if (isAbsolute(inside) || inside === '..' || inside.startsWith('..' + sep)) throw new Error('Fixture escaped its directory.');
    return absolute;
  }
  relativeToManifest(path: string): string { return this.path(relative(this.directory, resolve(dirname(this.manifest), path))); }
  target(path: string): string { return this.path(relative(this.directory, resolve(this.destination, path))); }
  async file(path: string, text: string): Promise<void> {
    const absolute = this.path(path); await fs.mkdir(dirname(absolute), { recursive: true }); await fs.writeFile(absolute, text);
  }
  async destinationFiles(root: string, files: Record<string, string>): Promise<void> {
    const destination = this.relativeToManifest(root);
    for (const [path, text] of Object.entries(files)) await this.file(relative(this.directory, join(destination, path)), text);
  }
  async replaceDirectory(path: string): Promise<void> {
    const directory = this.relativeToManifest(path), saved = this.path(relative(this.directory, directory + '-previous'));
    await fs.rename(directory, saved); await fs.mkdir(directory);
  }
  async files(): Promise<Record<string, string>> {
    const found: Record<string, string> = {};
    const read = async (path: string): Promise<void> => {
      for (const entry of await fs.readdir(this.target(path), { withFileTypes: true })) {
        const name = path ? path + '/' + entry.name : entry.name;
        if (entry.isDirectory()) await read(name);
        else if (entry.isFile()) found[name] = await fs.readFile(this.target(name), 'utf8');
        else found[name] = '<non-file>';
      }
    };
    await read(''); return found;
  }
  failRootCreation(code: string): void {
    const mkdir = fs.mkdir.bind(fs);
    const spy = vi.spyOn(fs, 'mkdir').mockImplementation(async (...args) => {
      if (String(args[0]) === this.destination) throw Object.assign(new Error('Root creation denied'), { code });
      return mkdir(...args);
    });
    this.restores.set('mkdir', () => spy.mockRestore());
  }
  failFileCreation(path: string, code: string): void {
    const open = fs.open.bind(fs);
    const spy = vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      if (String(args[0]) === this.target(path) && args[1] === 'wx') throw Object.assign(new Error('File creation denied'), { code });
      return open(...args);
    });
    this.restores.set('open', () => spy.mockRestore());
  }
  forbidExecution(): void {
    const forbidden = (name: string): never => { this.forbidden.push(name); throw new Error('Forbidden execution: ' + name); };
    for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'] as const) {
      const spy = vi.spyOn(processTools, name).mockImplementation(() => forbidden(name)); this.restores.set(name, () => spy.mockRestore());
    }
    for (const [protocol, client] of [['http', http], ['https', https]] as const) {
      for (const method of ['request', 'get'] as const) {
        const spy = vi.spyOn(client, method).mockImplementation(() => forbidden(protocol + '.' + method));
        this.restores.set(protocol + method, () => spy.mockRestore());
      }
    }
    const connect = vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(() => forbidden('net.connect'));
    const secure = vi.spyOn(tls, 'connect').mockImplementation(() => forbidden('tls.connect'));
    const datagram = vi.spyOn(dgram, 'createSocket').mockImplementation(() => forbidden('dgram.createSocket'));
    this.restores.set('socket', () => { connect.mockRestore(); secure.mockRestore(); datagram.mockRestore(); });
    const network = vi.spyOn(globalThis, 'fetch').mockImplementation(() => forbidden('fetch'));
    const compile = vi.spyOn(Compiler.prototype, 'compile').mockImplementation(() => forbidden('compile'));
    const output = vi.spyOn(Outputs.prototype, 'open').mockImplementation(() => forbidden('output'));
    syncBuiltinESMExports();
    this.restores.set('execution', () => { network.mockRestore(); compile.mockRestore(); output.mockRestore(); syncBuiltinESMExports(); });
  }
  async supplyCompiler(version: string): Promise<void> {
    const manifest = fileURLToPath(import.meta.resolve('typescript/package.json'));
    if (JSON.parse(await fs.readFile(manifest, 'utf8')).version !== version) throw new Error('Unexpected native compiler version.');
    this.compilerDirectory = join(dirname(dirname(manifest)), '.bin');
  }
  async build(): Promise<void> {
    if (!this.compilerDirectory || !process.env.npm_execpath) throw new Error('Supply installed TypeScript and invoke through npm.');
    try {
      const result = await promisify(processTools.execFile)(process.execPath, [process.env.npm_execpath, 'run', 'build'],
        { cwd: this.destination, windowsHide: true, timeout: 30000,
          env: { ...process.env, PATH: this.compilerDirectory + delimiter + (process.env.PATH ?? '') } });
      this.native = { code: 0, text: result.stdout + result.stderr };
    } catch (error) {
      const result = error as { code?: unknown; stdout?: string; stderr?: string };
      if (typeof result.code !== 'number') throw error;
      this.native = { code: result.code, text: (result.stdout ?? '') + (result.stderr ?? '') };
    }
  }
  async dispose(): Promise<void> {
    for (const restore of this.restores.values()) restore();
    const actual = await fs.realpath(this.directory);
    if (actual !== this.directory || !this.directory.startsWith(await fs.realpath(tmpdir()) + sep) || !this.directory.includes('expec-init-')) throw new Error('Unexpected cleanup root.');
    await fs.rm(this.directory, { recursive: true, force: true });
  }
}
