import { promises as fs } from 'node:fs';
import { getEventListeners } from 'node:events';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { onTestFinished, vi } from 'vitest';
import ts from 'typescript';
import { runCli, type CliHost, type Diagnostic, type OutputRegistration, type ProjectRoot } from '../../../src/index.js';

type Host = { -readonly [K in keyof CliHost]: CliHost[K] };
interface Report {
  format: number; command: string; status: string; exitCode: number;
  problems: Diagnostic[]; stages: { name: string; status: string }[];
}
type TreeEntry = { path: string; kind: 'directory' | 'file' | 'link' | 'other'; bytes?: string };
function gate() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** Real command effects; supplied callbacks only arrange host admission and race timing. */
export class EditorBuildHostDriver {
  directory!: string;
  manifest!: string;
  exitCode?: number;
  stdout = '';
  stderr = '';
  processOutput: string[] = [];
  inputAcquisitions: string[] = [];
  providerInvocations = 0;
  permissionInvocations = 0;
  resultSinkInvocations = 0;
  before: TreeEntry[] = [];
  readonly lifetime = new AbortController();
  readonly permissionRoots: ProjectRoot[] = [];
  readonly host: Host;
  private problems: readonly Diagnostic[] = [];
  private permissionResult?: unknown;
  private permissionError?: Error;
  private resultError?: Error;
  private planning?: ReturnType<typeof gate>;
  private planned = gate();
  private permission?: ReturnType<typeof gate>;
  private queried = gate();
  private started = gate();
  private running = new Set<Promise<void>>();
  private observing = false;
  private releases: (() => void)[] = [];
  private readonly processListeners = process.listeners('SIGINT');
  private readonly signalListeners = getEventListeners(this.lifetime.signal, 'abort');
  private native = false;

  constructor() {
    this.host = {
      signal: this.lifetime.signal,
      stdout: text => { this.resultSinkInvocations++; if (this.resultError) throw this.resultError; this.stdout += text; },
      stderr: text => { this.stderr += text; },
      checkWrite: async root => {
        this.permissionInvocations++;
        this.permissionRoots.push(structuredClone(root));
        if (this.permission) { this.queried.resolve(); await this.permission.promise; }
        if (this.permissionError) throw this.permissionError;
        return (this.permissionResult === undefined ? this.problems : this.permissionResult) as readonly Diagnostic[];
      },
    };
  }

  static async create(): Promise<EditorBuildHostDriver> {
    const driver = new EditorBuildHostDriver();
    const parent = await fs.realpath(tmpdir());
    driver.directory = await fs.realpath(await fs.mkdtemp(join(parent, 'expec-editor-host-')));
    if (dirname(driver.directory) !== parent) throw Error('Owned fixture escaped its verified temporary parent.');
    onTestFinished(() => driver.dispose());
    driver.manifest = driver.path('spec/expec.json');
    return driver;
  }

  path(selected: string): string {
    const target = resolve(this.directory, selected), inside = relative(this.directory, target);
    if (isAbsolute(inside) || inside === '..' || inside.startsWith('..' + sep)) throw Error('Fixture path escaped its owned tree.');
    return target;
  }

  selectTypeScriptOutput(): void { this.native = true; }

  async projectWithEntries(...sources: string[]): Promise<void> {
    await fs.mkdir(this.path('project'), { recursive: true });
    const entries = sources.map((_, index) => 'entry' + index + '.expec');
    for (let index = 0; index < sources.length; index++) await this.write('spec/' + entries[index], sources[index]!);
    await this.write('spec/expec.json', JSON.stringify({
      formatVersion: 1, version: '1.0.0', project: { root: '../project' }, build: { entries },
      outputs: [{ id: this.native ? 'typescript' : 'editor-observation',
        ...this.native ? { options: { directory: 'src', configFile: 'tsconfig.json' } } : {} }],
    }));
    if (this.native) {
      await this.write('project/src/existing.ts', 'export {};\n');
      await this.write('project/package.json', '{"type":"module","private":true}');
      await this.write('project/tsconfig.json', JSON.stringify({
        compilerOptions: { target: 'ES2022', lib: ['ES2022'], module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, types: [], skipLibCheck: true },
        include: ['src/**/*.ts'],
      }));
    }
    this.observe();
  }

  private registration(): OutputRegistration {
    const outputId = 'editor-observation';
    return {
      id: outputId, validate: () => [],
      open: () => {
        this.providerInvocations++;
        return {
          id: outputId,
          plan: async (request, basedOn) => {
            this.providerInvocations++;
            if (this.planning) { this.planned.resolve(); await this.planning.promise; }
            if (request.operation === 'delete') throw Error('This fixture does not arrange deletion.');
            const declarations = [...request.current.specification.inspection.roots()]
              .flatMap(item => item.origin.kind === 'source' && item.kind === 'record-type-declaration' ? [item.name] : []);
            return { value: { outputId, basedOn,
              changes: declarations.map(name => ({ kind: 'write' as const, path: 'src/' + name + '.ts',
                bytes: Buffer.from('export type ' + name + ' = {};\n') })), artifacts: [] },
              problems: [], deferred: [] };
          },
          read: async () => { throw Error('Contract-only fixture does not arrange artifact reads.'); },
          search: async () => { throw Error('Contract-only fixture does not arrange artifact searches.'); },
        };
      },
    };
  }

  buildWithHost(): Promise<void> {
    const command = this.executeBuild();
    this.running.add(command);
    command.then(() => this.running.delete(command), () => this.running.delete(command));
    this.started.resolve();
    return command;
  }
  private async executeBuild(): Promise<void> {
    this.before = await this.tree();
    this.stdout = ''; this.stderr = ''; this.processOutput = []; this.inputAcquisitions = [];
    this.providerInvocations = 0; this.resultSinkInvocations = 0;
    const outputs = this.native ? {} : { contracts: [this.registration()] };
    this.observing = true;
    try { this.exitCode = await runCli(['build', '--config', this.manifest, '--json'], outputs, this.host); }
    finally { this.observing = false; }
  }

  report(): Report {
    if (!this.stdout) throw Error('The actual command did not deliver JSON to its host output sink.');
    return JSON.parse(this.stdout) as Report;
  }

  holdRealOutputPlanning(): void { this.planning = gate(); }
  holdWritePermission(): void { this.permission = gate(); }
  async awaitHeldPlan(): Promise<void> { await this.awaitReached(this.planned.promise, 'output planning'); }
  async awaitHeldPermission(): Promise<void> { await this.awaitReached(this.queried.promise, 'host write permission'); }
  private async awaitReached(reached: Promise<void>, phase: string): Promise<void> {
    await this.started.promise;
    await Promise.race([reached, ...[...this.running].map(async command => {
      await command; throw Error('The actual command completed without reaching ' + phase + '.');
    })]);
  }
  releasePlan(): void { this.planning?.resolve(); }
  releasePermission(): void { this.permission?.resolve(); }
  async rejectPermission(message: string): Promise<void> {
    this.permission?.reject(Error(message));
    await new Promise<void>(resolveImmediate => setImmediate(resolveImmediate));
  }
  cancelBuild(): void { this.lifetime.abort(Error('Owning editor lifetime ended')); }
  refuseCurrentWrites(path: string, message: string): void {
    this.problems = [{ code: 'dirty-editor-buffer', message,
      at: { kind: 'dependency', path: ['project', path] }, related: [] }];
  }
  invalidWriteCallback(): void { (this.host as Record<string, unknown>).checkWrite = true; }
  returnInvalidPermission(value: unknown): void { this.permissionResult = value; }
  throwOnPermission(message: string): void { this.permissionError = Error(message); }
  throwOnResult(message: string): void { this.resultError = Error(message); }
  replaceResultSink(): void { this.host.stdout = () => { throw Error('Replacement sink must not run'); }; }

  async keepImplementation(path: string, body: string): Promise<void> {
    const filename = this.path('project/' + path), text = await fs.readFile(filename, 'utf8');
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    const methods = source.statements.filter(ts.isClassDeclaration).flatMap(item => item.members)
      .filter(ts.isMethodDeclaration).filter(item => item.name.getText(source) === 'count');
    const block = methods[0]?.body;
    if (methods.length !== 1 || !block) throw Error('Expected the actual generated Library.count method body.');
    await fs.writeFile(filename, text.slice(0, block.getStart(source)) + '{ ' + body + ' }' + text.slice(block.end));
  }
  replaceAuthored(text: string): Promise<void> { return this.write('spec/entry0.expec', text); }
  async fileText(path: string): Promise<string> { return fs.readFile(this.path('project/' + path), 'utf8'); }
  ownedListenerCount(): number {
    return process.listeners('SIGINT').filter(listener => !this.processListeners.includes(listener)).length
      + getEventListeners(this.lifetime.signal, 'abort').filter(listener => !this.signalListeners.includes(listener)).length;
  }
  async tree(): Promise<TreeEntry[]> {
    const found: TreeEntry[] = [];
    const visit = async (path: string): Promise<void> => {
      const info = await fs.lstat(path), name = relative(this.directory, path).split(sep).join('/') || '.';
      if (info.isSymbolicLink()) found.push({ path: name, kind: 'link' });
      else if (info.isDirectory()) {
        found.push({ path: name, kind: 'directory' });
        for (const child of (await fs.readdir(path)).sort()) await visit(join(path, child));
      } else if (info.isFile()) found.push({ path: name, kind: 'file', bytes: (await fs.readFile(path)).toString('base64') });
      else found.push({ path: name, kind: 'other' });
    };
    await visit(this.directory); return found;
  }
  async drainOwnedWork(): Promise<void> {
    await Promise.allSettled([...this.running, ...this.permission ? [this.permission.promise] : [], ...this.planning ? [this.planning.promise] : []]);
    await new Promise<void>(done => setImmediate(done));
  }
  private observe(): void {
    for (const stream of [process.stdout, process.stderr]) {
      const original = stream.write.bind(stream);
      const observer = vi.spyOn(stream, 'write').mockImplementation((...args: Parameters<typeof stream.write>) => {
        if (this.observing) this.processOutput.push(String(args[0]));
        return Reflect.apply(original, stream, args);
      });
      this.releases.push(() => observer.mockRestore());
    }
    for (const operation of ['readFile', 'open', 'readdir', 'lstat', 'realpath'] as const) {
      const original = fs[operation];
      const observer = vi.spyOn(fs, operation).mockImplementation((...args: unknown[]) => {
        const target = args[0] instanceof URL ? fileURLToPath(args[0]) : typeof args[0] === 'string' ? args[0] : '';
        const inside = target ? relative(this.directory, resolve(target)) : '..';
        if (this.observing && !isAbsolute(inside) && inside !== '..' && !inside.startsWith('..' + sep))
          this.inputAcquisitions.push(operation + ':' + inside.split(sep).join('/'));
        return Reflect.apply(original, fs, args);
      });
      this.releases.push(() => observer.mockRestore());
    }
  }
  private async write(path: string, text: string): Promise<void> {
    const filename = this.path(path); await fs.mkdir(dirname(filename), { recursive: true }); await fs.writeFile(filename, text);
  }
  private async dispose(): Promise<void> {
    this.cancelBuild(); this.releasePlan(); this.releasePermission();
    await this.drainOwnedWork();
    for (const release of this.releases.reverse()) release();
    if (dirname(this.directory) !== await fs.realpath(tmpdir())) throw Error('Refused cleanup outside owned temporary parent.');
    await fs.rm(this.directory, { recursive: true, force: true });
  }
}

