import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import ts from 'typescript';
import { pathToFileURL } from 'node:url';
import { NativePackageDriver } from './native-packages.js';
import { copyInstalledPackages } from './typescript-context.js';
import { requireCompiledCheckout } from './compiled-checkout.js';

const execute = promisify(execFile);
const checkout = fileURLToPath(new URL('../../', import.meta.url));
export class ConnectedBuildDriver {
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
    if (answers) {
      this.result = await new Promise((resolveResult, reject) => {
        const child = spawn(process.execPath, command, { cwd: this.path(cwd), env: { ...process.env, NODE_PATH: '' }, stdio: 'pipe' });
        let stdout = '', stderr = ''; const queue = [...answers];
        const timer = setTimeout(() => { child.kill(); reject(Error('Interactive CLI exceeded its bounded fixture deadline.')); }, 30_000);
        child.stdout.on('data', chunk => { stdout += String(chunk); });
        child.stderr.on('data', chunk => {
          const value = String(chunk); stderr += value;
          if (value.endsWith('? ') && queue.length) child.stdin.write(queue.shift()! + '\n');
        });
        child.on('error', reject);
        child.on('close', code => { clearTimeout(timer); resolveResult({ code: code ?? 130, stdout, stderr }); });
      });
      this.report = undefined; return;
    }
    try {
      const result = await execute(process.execPath, command,
        { cwd: this.path(cwd), timeout: deadline, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, NODE_PATH: '' } });
      this.result = { ...result, code: 0 };
    } catch (error) {
      const result = error as { code: number | string; stdout: string; stderr: string; killed?: boolean; signal?: string };
      if (typeof result.code !== 'number') throw new Error('Connected CLI process failed: ' + JSON.stringify({
        deadline, code: result.code, killed: result.killed, signal: result.signal, stdout: result.stdout, stderr: result.stderr,
      }), { cause: error });
      this.result = { code: result.code, stdout: result.stdout, stderr: result.stderr };
    }
    this.report = args.includes('--json') ? JSON.parse(this.result.stdout) : undefined;
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
    await this.write('project/tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, types: ['node'], skipLibCheck: true }, include: ['**/*.ts'] }));
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
    await this.registry?.dispose();
    if (dirname(this.directory) !== this.parent || !(await realpath(this.directory)).startsWith(this.parent)
      || !this.directory.split(/[\\/]/).at(-1)!.startsWith('expec-cli-')) throw Error('Unexpected fixture cleanup.');
    await rm(this.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
