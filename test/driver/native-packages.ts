import childProcess, { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { vi } from 'vitest';
import { NpmDependencies, type Configuration, type PackageRead } from '../../src/index.js';

const execute = promisify(execFile);
type PackageFixture = { manifest: Record<string, unknown>; bytes: Buffer; integrity: string };
/** Real local tarballs and registry responses; npm owns installation and lock selection. */
export class NativePackageDriver {
  directory!: string;
  root!: string;
  registry = '';
  readonly requests: string[] = [];
  readonly requirements: Configuration['packages'][number][] = [];
  readonly packages = new Map<string, Map<string, PackageFixture>>();
  readonly spawned = vi.spyOn(childProcess, 'spawn');
  private readonly server = createServer((request, response) => {
    const path = decodeURIComponent(request.url ?? '/'); this.requests.push(path);
    const versions = this.packages.get(path.slice(1));
    response.setHeader('content-type', 'application/json');
    if (versions) response.end(JSON.stringify({ name: path.slice(1), 'dist-tags': { latest: [...versions.keys()].at(-1) },
      versions: Object.fromEntries([...versions].map(([version, fixture]) => [version, { ...fixture.manifest,
        dist: { integrity: fixture.integrity, tarball: this.registry + '/tarball/' + encodeURIComponent(path.slice(1)) + '/' + version } }])) }));
    else if (path.startsWith('/tarball/')) {
      const split = path.lastIndexOf('/'), fixture = this.packages.get(path.slice(9, split))?.get(path.slice(split + 1));
      if (fixture) { response.setHeader('content-type', 'application/octet-stream'); response.end(fixture.bytes); }
      else { response.statusCode = 404; response.end('{}'); }
    } else { response.statusCode = 404; response.end('{}'); }
  });
  result!: PackageRead;
  manifest: Record<string, any> = {};
  lock: Record<string, any> = {};
  installed: Record<string, { name: string; version: string }> = {};
  before: Record<string, string> = {};
  after: Record<string, string> = {};
  requestCount = 0;
  initialLock?: string;
  currentLock: string | undefined;
  fixtureValue: unknown;
  client!: NpmDependencies;

  async initialize(kind: 'project' | 'empty' | 'absent' = 'project'): Promise<void> {
    this.directory = await mkdtemp(join(tmpdir(), 'expec-native-')); this.root = join(this.directory, 'project');
    if (kind !== 'absent') await mkdir(this.root);
    if (kind === 'project') {
      await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve));
      this.registry = 'http://127.0.0.1:' + (this.server.address() as { port: number }).port;
      await this.setManifest({ name: 'acquisition-consumer', version: '1.0.0', private: true, type: 'module' });
      await this.file('.npmrc', `registry=${this.registry}\ncache=${join(this.directory, 'cache').replaceAll('\\', '/')}\nfetch-retries=0\n`);
    }
    this.client = new NpmDependencies(this.root, { command: npmCommand() });
  }
  async dispose(): Promise<void> {
    this.server.closeAllConnections();
    if (this.server.listening) await new Promise<void>((resolve, reject) => this.server.close(error => error ? reject(error) : resolve()));
    this.spawned.mockRestore();
    if (dirname(resolve(this.directory)) !== resolve(tmpdir()) || !this.directory.includes('expec-native-')) throw new Error('Unexpected cleanup path.');
    await rm(this.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  async publish(name: string, version: string, canary?: string): Promise<void> {
    const directory = join(this.directory, 'fixtures', name, version); await mkdir(directory, { recursive: true });
    const manifest = { name, version, main: 'index.cjs', ...(canary ? { scripts: { install: `node -e "require('fs').writeFileSync(require('path').join(process.env.INIT_CWD,'${canary}'),'ran')"` } } : {}) };
    await writeFile(join(directory, 'package.json'), JSON.stringify(manifest));
    await writeFile(join(directory, 'index.cjs'), 'module.exports = "storage-ready";\n');
    const output = await this.npm(directory, ['pack', '--offline', '--json']);
    const bytes = await readFile(join(directory, JSON.parse(output.stdout)[0].filename));
    const versions = this.packages.get(name) ?? new Map(); this.packages.set(name, versions);
    versions.set(version, { manifest, bytes, integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64') });
  }
  require(alias: string, name: string, version: string, phases: Configuration['packages'][number]['phases']): void {
    this.requirements.push({ alias, name, version, phases });
  }
  async seed(name: string, version: string, range = version, development = false): Promise<void> {
    await this.publish(name, version);
    const manifest = await this.json('package.json'); manifest[development ? 'devDependencies' : 'dependencies'] = { [name]: range };
    await this.setManifest(manifest); await this.npm(this.root, ['install']);
    this.initialLock = await readFile(join(this.root, 'package-lock.json'), 'utf8');
  }
  async select(): Promise<void> {
    const manifest = await this.json('package.json');
    manifest.dependencies = Object.fromEntries(this.requirements.map(item => [item.name.slice(4), item.version]));
    await this.setManifest(manifest); await this.npm(this.root, ['install', '--package-lock-only']);
  }
  async read(): Promise<void> { await this.beforeAction(); this.result = await this.client.read(this.requirements); await this.observe(); }
  async install(): Promise<void> { await this.beforeAction(); this.result = await this.client.install(this.requirements); await this.observe(); }
  private async beforeAction(): Promise<void> { this.before = await snapshot(this.root); this.requestCount = this.requests.length; this.spawned.mockClear(); }
  async observe(): Promise<void> {
    this.after = await snapshot(this.root); this.manifest = await this.json('package.json'); this.lock = await this.json('package-lock.json');
    this.currentLock = this.after['package-lock.json'] ? await readFile(join(this.root, 'package-lock.json'), 'utf8') : undefined;
    this.installed = {};
    for (const name of new Set([...this.packages.keys(), ...this.requirements.map(item => item.name.slice(4))])) {
      const actual = await this.json('node_modules/' + name + '/package.json');
      if (actual.name) this.installed[name] = { name: actual.name, version: actual.version };
    }
  }
  async json(file: string): Promise<Record<string, any>> { try { return JSON.parse(await readFile(join(this.root, file), 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error; } }
  async file(file: string, text: string): Promise<void> { const path = join(this.root, file); await mkdir(dirname(path), { recursive: true }); await writeFile(path, text); }
  setManifest(manifest: object): Promise<void> { return this.file('package.json', JSON.stringify(manifest, null, 2) + '\n'); }
  async replace(name: string, patch: object): Promise<void> { const file = 'node_modules/' + name + '/package.json'; await this.file(file, JSON.stringify({ ...await this.json(file), ...patch })); }
  async importFixture(name: string): Promise<void> {
    const result = await execute(process.execPath, ['--input-type=module', '-e', `console.log(JSON.stringify((await import(${JSON.stringify(name)})).default))`], { cwd: this.root, windowsHide: true });
    this.fixtureValue = JSON.parse(result.stdout);
  }
  npm(directory: string, args: string[]) {
    return execute(process.execPath, [npmExecutable(), ...args, '--ignore-scripts', '--no-audit', '--no-fund', '--update-notifier=false',
      '--cache=' + join(this.directory, 'cache'), '--fetch-retries=0'], { cwd: directory, windowsHide: true, timeout: 30_000 });
  }
}
export function npmExecutable(): string {
  const path = process.env.npm_execpath;
  if (!path || !isAbsolute(path)) throw new Error('Run native package checks through pinned npm11.20.0.');
  return path;
}
export function npmCommand(): string { return npmExecutable(); }
async function snapshot(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function visit(path: string): Promise<void> {
    for (const item of await readdir(path, { withFileTypes: true })) {
      const file = join(path, item.name);
      if (item.isDirectory()) await visit(file);
      else { const info = await stat(file, { bigint: true }); files[relative(root, file).split(sep).join('/')] = createHash('sha256').update(await readFile(file)).digest('hex') + ':' + info.mtimeNs + ':' + info.mode; }
    }
  }
  try { await visit(root); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return files;
}
