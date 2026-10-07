import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { TestRunner } from 'vitest';

import ts from 'typescript';
import { pathToFileURL } from 'node:url';
import { NativePackageDriver } from '../project/dependencies/native-packages.js';
import { copyInstalledPackages } from '../project/typescript/typescript-context.js';
import { requireCompiledCheckout } from '../compiled-checkout.js';

const execute = promisify(execFile);
const checkout = fileURLToPath(new URL('../../../', import.meta.url));
export class ConnectedBuildDriver {
  private readonly commands = new Set<OwnedCommand>();
  private disposed = false;
  constructor(private readonly owner = TestRunner.getCurrentTest()?.context.signal) {}
  directory!: string;
  private parent!: string;
  manifest: Record<string, unknown> = { formatVersion: 1, version: '1.0.0', project: { root: '../project' },
    build: { entries: ['main.expec'] }, outputs: [] };
  before: Record<string, string> = {};
  identities?: string;
  private registry?: NativePackageDriver;
  manifestChange?: Record<string, unknown>;
  failure?: { operation: "write" | "remove"; path: string };
  pendingIds?: Record<string, string>;
  signalAfterOutputWrite?: string;
  afterOutputWrite?: { source: string; path: string; text: string };
  afterWriterRelease?: { count: number; path: string; text: string };
  result!: { code: number; stdout: string; stderr: string };
  report: any;
  protected launcher?: string;
  static async prepare(): Promise<void> { requireCompiledCheckout(); }
  async initialize(connected: boolean): Promise<void> {
    this.parent = await realpath(tmpdir());
    this.directory = await realpath(await mkdtemp(join(this.parent, 'expec-cli-')));
    await mkdir(join(this.directory, 'spec'));
    if (connected) await mkdir(join(this.directory, 'project')); else delete this.manifest.project;
    await this.saveManifest();
  }
  sourceText(name: string): Promise<string> { return readFile(this.path('spec/' + name), 'utf8'); }
  async saveManifest(): Promise<void> { await this.write('spec/expec.json', JSON.stringify(this.manifest, null, 2) + '\n'); }
  async write(path: string, text: string): Promise<void> {
    const target = this.path(path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, text);
  }
  path(path: string): string {
    const target = resolve(this.directory, path), within = relative(this.directory, target);
    if (isAbsolute(within) || within.startsWith('..')) throw Error('Fixture path escapes its root.');
    return target;
  }
  async capture(excluded: readonly string[] = []): Promise<Record<string, string>> {
    const found: Record<string, string> = {};
    const walk = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (excluded.includes(entry.name)) continue;
        if (entry.isDirectory()) await walk(path);
        else if (entry.isFile()) found[relative(this.directory, path).replaceAll('\\', '/')] = (await readFile(path)).toString('base64');
        else throw Error('Unexpected linked fixture entry.');
      }
    };
    await walk(this.directory); return found;
  }
  async run(args: string[], cwd = '', answers?: string[], deadline = 30_000): Promise<void> {
    this.owner?.throwIfAborted();
    if (this.disposed) throw Error('The connected CLI fixture was disposed.');
    const prelude = [];
    if (answers) prelude.push('Object.defineProperty(process.stdin, "isTTY", { value: true }); Object.defineProperty(process.stderr, "isTTY", { value: true });');
    if (this.manifestChange) prelude.push(      'import { promises as fs } from "node:fs"; const open = fs.open; let changed = false; fs.open = async (...args) => {' +
      'const handle = await open(...args); if (String(args[0]).replaceAll("\\\\", "/").endsWith("/store-game/src/index.ts")) {' +
      'const close = handle.close.bind(handle); handle.close = async () => { await close(); if (!changed) { changed = true;' +
      'const file = ' + JSON.stringify(this.path('spec/expec.json')) + '; const data = JSON.parse(await fs.readFile(file, "utf8"));' +
      'await fs.writeFile(file, JSON.stringify(Object.assign(data, ' + JSON.stringify(this.manifestChange) + '))); } }; } return handle; };');
    if (this.failure) prelude.push('import { promises as faultyFs } from "node:fs"; const failure = ' + JSON.stringify({ ...this.failure, path: this.path('project/' + this.failure.path) }) + ';' +
      'const operation = failure.operation === "write" ? "open" : "unlink", original = faultyFs[operation]; faultyFs[operation] = async (...args) => {' +
      'if (String(args[0]) === failure.path && (operation === "unlink" || args[1] !== "r")) throw Object.assign(Error("Deliberate native fixture write refusal"), {code:"EACCES"}); return original(...args); };');
    if (this.afterWriterRelease) prelude.push('import { promises as changedFs } from "node:fs"; import { dirname as changeParent } from "node:path"; const mutation = ' + JSON.stringify({ ...this.afterWriterRelease, path: this.path('project/' + this.afterWriterRelease.path), lock: this.path('project/.expec/write.lock') }) + ';' +
      'const unlink = changedFs.unlink; let releases = 0; changedFs.unlink = async (...args) => { const result = await unlink(...args); if (String(args[0]) === mutation.lock && ++releases === mutation.count) {' +
      'await changedFs.mkdir(changeParent(mutation.path), {recursive:true}); await changedFs.writeFile(mutation.path, mutation.text); } return result; };');
    if (this.signalAfterOutputWrite) prelude.push('import { promises as signalFs } from "node:fs"; const signalPath = ' + JSON.stringify(this.path('project/' + this.signalAfterOutputWrite)) + ';' +
      'const signalOpen = signalFs.open; let sent = false; signalFs.open = async (...args) => { const handle = await signalOpen(...args); if (String(args[0]) === signalPath && args[1] !== "r") {' +
      'const close = handle.close.bind(handle); handle.close = async () => { await close(); if (!sent) { sent = true; process.emit("SIGINT"); } }; } return handle; };');
    if (this.afterOutputWrite) prelude.push('import { promises as outputFs } from "node:fs"; const outputMutation = ' + JSON.stringify({ ...this.afterOutputWrite, source: this.path('project/' + this.afterOutputWrite.source), path: this.path('project/' + this.afterOutputWrite.path) }) + ';' +
      'const outputOpen = outputFs.open; let outputChanged = false; outputFs.open = async (...args) => { const handle = await outputOpen(...args); if (String(args[0]) === outputMutation.source && args[1] !== "r") {' +
      'const close = handle.close.bind(handle); handle.close = async () => { await close(); if (!outputChanged) { outputChanged = true; await outputFs.writeFile(outputMutation.path, outputMutation.text); } }; } return handle; };');
    const command = [...(prelude.length ? ['--import', 'data:text/javascript,' + encodeURIComponent(prelude.join('\n'))] : []),
      this.launcher ?? join(checkout, 'dist/cli-entry.js'), ...args];
    const running = new OwnedCommand(command, this.path(cwd), this.owner, answers, answers ? 30_000 : deadline);
    this.commands.add(running);
    try {
      this.result = await running.finished;
      this.report = !answers && args.includes('--json') ? JSON.parse(this.result.stdout) : undefined;
    } finally { if (running.safeToRemove) this.commands.delete(running); }
  }
  async registerOutputs(outputs: { id: string; stage: 'contracts' | 'tests'; subject?: string; file?: string; text?: string; malformedPlan?: boolean; readFailure?: string; afterPlan?: { path: string; text: string } }[]): Promise<void> {
    this.launcher = this.path('launcher/connected-output.mjs');
    await this.write(this.launcher, await readFile(join(checkout, 'test/resources/connected-output.mjs'), 'utf8'));
    await this.write('launcher/outputs.json', JSON.stringify({ library: join(checkout, 'dist/index.js'), outputs: outputs.map(item => ({ ...item,
      ...(item.afterPlan ? { afterPlan: { ...item.afterPlan, path: this.path(item.afterPlan.path) } } : {}),
    })) }));
  }
  async filesUnder(path: string): Promise<{ path: string; text: string }[]> {
    const result: { path: string; text: string }[] = [];
    const walk = async (directory: string): Promise<void> => {
      for (const item of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, item.name);
        if (item.isDirectory()) await walk(path);
        else if (item.isFile()) result.push({ path, text: await readFile(path, 'utf8') });
      }
    };
    await walk(this.path(path)); return result;
  }
  async nativeSources(): Promise<ts.SourceFile[]> {
    return (await this.filesUnder('project/src')).filter(file => file.path.endsWith('.ts')).map(file => ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true));
  }
  async invoke(name: string): Promise<string> {
    const sources = await this.nativeSources(), source = sources.find(source => source.statements.some(node => ts.isFunctionDeclaration(node) && node.name?.text === name));
    if (!source) throw Error('Expected actual generated function ' + name);
    const native = ts.transpileModule(source.text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true });
    if (native.diagnostics?.length) throw Error('Generated function did not transpile.');
    await this.write('native-consumer/function.mjs', native.outputText);
    const result = await execute(process.execPath, ['--input-type=module', '-e', 'const module = await import(' + JSON.stringify(pathToFileURL(this.path('native-consumer/function.mjs')).href) + '); try { module[' + JSON.stringify(name) + '](); process.exitCode = 1; } catch (error) { console.log(error.message); }'], { cwd: this.directory, timeout: 10_000 });
    return result.stdout.trim();
  }
  async nativeAcceptance(): Promise<void> {
    await copyInstalledPackages(this.path('project'), { vitest: '5.0.2', '@types/node': '24.13.6' });
    await this.write('project/package.json', '{"type":"module","private":true}');
    await this.write('project/tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2022', lib: ['ES2022'], module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, types: ['node'], skipLibCheck: true }, include: ['**/*.ts'] }));
    await this.write('project/tsconfig.source.json', JSON.stringify({ extends: './tsconfig.json', compilerOptions: { types: [] }, include: ['src/**/*.ts'] }));
  }
  async serveCompiler(destination: string): Promise<void> {
    this.registry = new NativePackageDriver(); await this.registry.initialize();
    const directory = join(checkout, 'node_modules/typescript'), manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    if (manifest.name !== 'typescript' || manifest.version !== '5.9.3') throw Error('Use the actual pinned TypeScript package.');
    const packed = await this.registry.npm(this.registry.directory, ['pack', directory, '--offline', '--json']);
    const bytes = await readFile(join(this.registry.directory, JSON.parse(packed.stdout)[0].filename));
    this.registry.packages.set('typescript', new Map([['5.9.3', { manifest, bytes, integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64') }]]));
    await this.write(destination + '/.npmrc', 'registry=' + this.registry.registry + '\ncache=' + this.path('cache').replaceAll('\\', '/') + '\nfetch-retries=0\n');
  }
  async nativeBuild(destination: string): Promise<void> {
    await execute(process.execPath, [this.path(destination + '/node_modules/typescript/bin/tsc'), '--noEmit', '-p', this.path(destination + '/tsconfig.json')], { cwd: this.path(destination), timeout: 20_000 });
  }
  async servePackage(name: string, version: string): Promise<void> {
    this.registry = new NativePackageDriver(); await this.registry.initialize(); await this.registry.publish(name, version);
    await this.write('project/.npmrc', 'registry=' + this.registry.registry + '\ncache=' + this.path('cache').replaceAll('\\', '/') + '\nfetch-retries=0\n');
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    const stopped = await Promise.allSettled([...this.commands].map(command => command.stop(Error('The connected CLI fixture was disposed.'))));
    const failed = stopped.find(result => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    await this.registry?.dispose();
    if (dirname(this.directory) !== this.parent || !(await realpath(this.directory)).startsWith(this.parent)
      || !this.directory.split(/[\\/]/).at(-1)!.startsWith('expec-cli-')) throw Error('Unexpected fixture cleanup.');
    await rm(this.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

/** A fixture owns its ordinary process tree until termination and output closure are confirmed. */
class OwnedCommand {
  readonly finished: Promise<{ code: number; stdout: string; stderr: string }>;
  private readonly child: ReturnType<typeof spawn>;
  private readonly closed: Promise<void>;
  private stopping?: Promise<void>;
  private didClose = false;
  private stopped = false;
  private failure?: unknown;
  private reject!: (error: unknown) => Error;
  get safeToRemove(): boolean { return this.didClose && (!this.stopping || this.stopped); }
  constructor(command: string[], cwd: string, owner: AbortSignal | undefined, answers: string[] | undefined, deadline: number) {
    this.child = spawn(process.execPath, command, { cwd, env: { ...process.env, NODE_PATH: '' },
      stdio: 'pipe', windowsHide: true, detached: process.platform !== 'win32' });
    let close!: () => void;
    this.closed = new Promise(resolveClosed => { close = resolveClosed; });
    this.finished = new Promise((resolveResult, reject) => {
      let stdout = '', stderr = '', stdoutBytes = 0, stderrBytes = 0;
      this.reject = error => {
        const detail = error instanceof Error ? error : Error(String(error));
        const failure = Object.assign(Error(detail.message + '\nCaptured CLI output: ' + JSON.stringify({ stdout, stderr }), { cause: error }),
          { code: (detail as NodeJS.ErrnoException).code, stdout, stderr });
        reject(failure); return failure;
      };
      const queue = [...answers ?? []];
      const cancel = () => { void this.stop(owner?.reason).catch(() => {}); };
      const timer = setTimeout(() => { void this.stop(Error(`Connected CLI exceeded its ${deadline}ms fixture deadline.`)).catch(() => {}); }, deadline);
      this.child.stdout!.setEncoding('utf8'); this.child.stderr!.setEncoding('utf8');
      this.child.stdout!.on('data', (text: string) => {
        stdoutBytes += Buffer.byteLength(text);
        if (stdoutBytes > 4 * 1024 * 1024) { void this.stop(Error('Connected CLI stdout exceeded four MiB.')).catch(() => {}); return; }
        stdout += text;
      });
      this.child.stderr!.on('data', (text: string) => {
        stderrBytes += Buffer.byteLength(text);
        if (stderrBytes > 4 * 1024 * 1024) { void this.stop(Error('Connected CLI stderr exceeded four MiB.')).catch(() => {}); return; }
        stderr += text;
        if (answers && text.endsWith('? ') && queue.length) this.child.stdin!.write(queue.shift()! + '\n');
      });
      this.child.stdin!.on('error', error => { this.failure ??= error; });
      this.child.once('error', error => { this.failure ??= error; });
      this.child.once('close', (code, signal) => {
        this.didClose = true; close(); clearTimeout(timer); owner?.removeEventListener('abort', cancel);
        const finish = () => this.failure ? this.reject(this.failure) : typeof code === 'number'
          ? resolveResult({ code, stdout, stderr }) : this.reject(Error('Connected CLI terminated with signal ' + signal + '.'));
        if (this.stopping) void this.stopping.then(finish, this.reject); else finish();
      });
      owner?.addEventListener('abort', cancel, { once: true });
      if (owner?.aborted) cancel();
    });
  }
  stop(reason: unknown = Error('Connected CLI cancelled.')): Promise<void> {
    if (this.stopping) return this.stopping;
    if (this.didClose) return Promise.resolve();
    this.failure ??= reason;
    let timer: NodeJS.Timeout;
    const termination = async () => {
      const pid = this.child.pid;
      if (pid !== undefined) {
        if (this.child.exitCode !== null || this.child.signalCode !== null) throw Error('CLI exited before its owned tree could be stopped.');
        if (process.platform === 'win32') await execute(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
          ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 5_000 });
        else { try { process.kill(-pid, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; } }
      }
      await this.closed;
    };
    this.stopping = Promise.race([termination(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Error('Owned CLI closure was not confirmed within five seconds.')), 5_000);
    })]).then(() => { this.stopped = true; }, error => {
      const failure = Error('Owned CLI termination or closure was not confirmed; fixture retained.', { cause: error });
      throw this.reject(failure);
    }).finally(() => clearTimeout(timer));
    return this.stopping;
  }
}
