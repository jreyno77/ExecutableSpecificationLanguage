import { mkdtempSync, realpathSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { vi } from 'vitest';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ConfigurationReader, ProjectConnector, FileProjectWriter,
  type FileChange, type ProjectContext, type ProjectSnapshot, type WriteResult } from '../../../../src/index.js';
import { requireCompiledCheckout } from '../../compiled-checkout.js';

/** Owns real temporary files and public writer calls; never simulates their effects. */
export class WritingDriver {
  static async prepare(): Promise<void> { requireCompiledCheckout(); }
  readonly directory = realpathSync.native(mkdtempSync(join(tmpdir(), 'expec-writes-')));
  readonly root = join(this.directory, 'project');
  context!: ProjectContext;
  snapshot!: ProjectSnapshot;
  result!: WriteResult;
  changes: FileChange[] = [];
  controller = new AbortController();
  remembered!: WriteResult;
  first!: WriteResult;
  second!: WriteResult;
  secondChanges: FileChange[] = [];
  private readonly releases: (() => Promise<void>)[] = [];
  private afterChange: (() => Promise<void>) | undefined;
  readonly metadata = new Map<string, unknown>();
  path(name: string): string {
    const path = resolve(this.root, name), inside = relative(this.root, path);
    if (isAbsolute(inside) || inside === '..' || inside.startsWith('..' + sep)) throw new Error('Fixture path escaped its project.');
    return path;
  }
  async initialize(files: Record<string, string>): Promise<void> {
    await fs.mkdir(this.root);
    for (const [path, text] of Object.entries(files)) await this.edit(path, text);
    const configuration = new ConfigurationReader([]).read({ sourceId: 'settings', text: JSON.stringify({
      formatVersion: 1, version: '0.1.0', project: { root: 'project' }, build: { entries: ['store.expec'] },
    }) });
    if (!configuration.value) throw new Error(JSON.stringify(configuration.problems));
    const connection = await new ProjectConnector(join(this.directory, 'expec.json')).connect(configuration.value);
    if (connection.value?.status !== 'connected') throw new Error(JSON.stringify(connection));
    this.context = connection.value.context;
  }
  async observe(): Promise<void> { this.snapshot = await this.context.readSnapshot(); this.changes = []; this.controller = new AbortController(); }
  async edit(path: string, text: string): Promise<void> {
    await fs.mkdir(dirname(this.path(path)), { recursive: true });
    await fs.writeFile(this.path(path), text);
  }
  async apply(): Promise<void> {
    this.result = await new FileProjectWriter(this.watchedContext()).apply({ basedOn: this.snapshot, changes: this.changes }, this.controller.signal);
  }
  private watchedContext(): ProjectContext {
    return { root: this.context.root, readSnapshot: async () => {
      const snapshot = await this.context.readSnapshot(), first = this.changes[0];
      if (this.afterChange && first?.kind === 'write' && snapshot.files.some(file => file.path === first.path && Buffer.from(file.bytes).equals(first.bytes))) {
        const action = this.afterChange; this.afterChange = undefined; await action();
        return this.context.readSnapshot();
      }
      return snapshot;
    } };
  }
  cancelAfterFirst(): void { this.afterChange = async () => { this.controller.abort(); }; }
  failContext(error: Error): void { this.afterChange = async () => { throw error; }; }
  editBeforeFinal(path: string, text: string): void { this.afterChange = () => this.edit(path, text); }
  denyWriteAfterFirst(path: string): void { this.afterChange = () => this.denyWrite(path); }
  private async denyWrite(path: string): Promise<void> {
    if (process.platform !== 'win32') {
      const mode = (await fs.stat(this.path(path))).mode;
      await fs.chmod(this.path(path), 0o444);
      this.releases.push(() => fs.chmod(this.path(path), mode));
      return;
    }
    const script = "$ErrorActionPreference='Stop'; $file=[IO.File]::Open($env:EXPEC_WRITE_FILE,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read); try { [Console]::Out.WriteLine('READY'); [Console]::Out.Flush(); [Console]::In.ReadLine() | Out-Null } finally { $file.Dispose() }";
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, env: { ...process.env, EXPEC_WRITE_FILE: this.path(path) }, stdio: ['pipe', 'pipe', 'pipe'] });
    const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
    child.stdin.on('error', () => { /* A child that exited before cleanup has no writable input. */ });
    this.releases.push(async () => {
      const kill = setTimeout(() => child.kill(), 5000);
      let deadline: ReturnType<typeof setTimeout>;
      try {
        child.stdin.end('\n');
        await Promise.race([closed, new Promise<never>((_, reject) => {
          deadline = setTimeout(() => reject(new Error('File-lock child did not terminate after cleanup')), 10000);
        })]);
      } finally { clearTimeout(kill); clearTimeout(deadline!); }
    });
    await new Promise<void>((accept, reject) => {
      const timeout = setTimeout(() => { child.kill(); reject(new Error('File lock did not become ready')); }, 10000);
      child.stdout.on('data', data => { if (String(data).includes('READY')) { clearTimeout(timeout); accept(); } });
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', code => { clearTimeout(timeout); reject(new Error('File lock exited before readiness: ' + code)); });
    });
  }
  failRemoval(path: string): void {
    const unlink = fs.unlink.bind(fs);
    vi.spyOn(fs, 'unlink').mockImplementation(async target => {
      if (String(target) === this.path(path)) throw Object.assign(new Error('Source removal denied'), { code: 'EACCES' });
      return unlink(target);
    });
  }
  denyReadAfterWrite(path: string): void {
    const open = fs.open.bind(fs); let changed = false;
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      if (String(args[0]) === this.path(path) && args[1] === 'r' && changed) throw Object.assign(new Error('Reading the result denied'), { code: 'EACCES' });
      const handle = await open(...args);
      if (String(args[0]) === this.path(path) && args[1] === 'r+') {
        const write = handle.writeFile.bind(handle);
        vi.spyOn(handle, 'writeFile').mockImplementation(async (...values) => { await write(...values); changed = true; });
      }
      return handle;
    });
  }
  async competingWriters(): Promise<void> {
    let attempted = false;
    const context: ProjectContext = { root: this.context.root, readSnapshot: async () => {
      if (!attempted) { attempted = true; this.second = await this.childWriter(); }
      return this.context.readSnapshot();
    } };
    this.first = await new FileProjectWriter(context).apply({ basedOn: this.snapshot, changes: this.changes });
    if (!attempted) this.second = await this.childWriter();
  }
  private async childWriter(): Promise<WriteResult> {
    const input = { directory: this.directory, baseline: { ...this.snapshot, files: this.snapshot.files.map(file => ({ ...file, bytes: [...file.bytes] })) },
      changes: this.secondChanges.map(change => change.kind === 'write' ? { ...change, bytes: [...change.bytes] } : change) };
    const script = `import { FileProjectWriter, ProjectConnector, ConfigurationReader } from ${JSON.stringify(pathToFileURL(resolve('dist/index.js')).href)};
const input=JSON.parse(process.env.EXPEC_WRITER_INPUT);
const config=new ConfigurationReader([]).read({sourceId:'settings',text:JSON.stringify({formatVersion:1,version:'0.1.0',project:{root:'project'},build:{entries:['store.expec']}})}).value;
const connection=await new ProjectConnector(input.directory+'/expec.json').connect(config);
const basedOn={...input.baseline,files:input.baseline.files.map(file=>({...file,bytes:Uint8Array.from(file.bytes)}))};
const changes=input.changes.map(change=>change.kind==='write'?{...change,bytes:Uint8Array.from(change.bytes)}:change);
process.stdout.write(JSON.stringify(await new FileProjectWriter(connection.value.context).apply({basedOn,changes})));`;
    const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], {
      windowsHide: true, env: { ...process.env, EXPEC_WRITER_INPUT: JSON.stringify(input) }, timeout: 10000,
    });
    return JSON.parse(result.stdout) as WriteResult;
  }
  async retrySecond(): Promise<void> { this.second = await new FileProjectWriter(this.context).apply({ basedOn: this.snapshot, changes: this.secondChanges }); }
  async link(path: string, target: string): Promise<void> {
    await fs.symlink(this.path(target), this.path(path), process.platform === 'win32' ? 'junction' : 'dir');
  }
  async replaceDirectoryWithOutsideLink(path: string): Promise<void> {
    await fs.rename(this.path(path), this.path(path + '-original'));
    await fs.mkdir(join(this.directory, 'outside'));
    await fs.symlink(join(this.directory, 'outside'), this.path(path), process.platform === 'win32' ? 'junction' : 'dir');
  }
  async replaceRoot(files: Record<string, string>): Promise<void> {
    await fs.rename(this.root, join(this.directory, 'old-project'));
    await fs.mkdir(this.root);
    for (const [path, text] of Object.entries(files)) await this.edit(path, text);
  }
  async fileMetadata(path: string): Promise<unknown> {
    const info = await fs.stat(this.path(path), { bigint: true });
    return { mtime: info.mtimeNs, mode: info.mode, identity: [info.dev, info.ino] };
  }
  async dispose(): Promise<void> {
    vi.restoreAllMocks();
    for (const release of this.releases) await release();
    if (!isAbsolute(this.directory) || !relative(tmpdir(), this.directory).startsWith('expec-writes-')) {
      // A canonical TEMP alias can differ; the exact directory was created above, and is checked by basename too.
      if (!isAbsolute(this.directory) || !this.directory.split(/[\\/]/).at(-1)?.startsWith('expec-writes-')) throw new Error('Invalid temporary root.');
    }
    await fs.rm(this.directory, { recursive: true, force: true });
  }
}
