import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const checkout = fileURLToPath(new URL('../../', import.meta.url));
export class ConnectedBuildDriver {
  directory!: string;
  private parent!: string;
  manifest: Record<string, unknown> = { formatVersion: 1, version: '1.0.0', project: { root: '../project' },
    build: { entries: ['main.expec'] }, outputs: [] };
  before: Record<string, string> = {};
  result!: { code: number; stdout: string; stderr: string };
  report: any;
  static async prepare(): Promise<void> {
    await execute(process.execPath, [join(checkout, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json'],
      { cwd: checkout, timeout: 90_000, maxBuffer: 4 * 1024 * 1024 });
  }
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
  async capture(): Promise<Record<string, string>> {
    const found: Record<string, string> = {};
    const walk = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await walk(path);
        else if (entry.isFile()) found[relative(this.directory, path).replaceAll('\\', '/')] = (await readFile(path)).toString('base64');
        else throw Error('Unexpected linked fixture entry.');
      }
    };
    await walk(this.directory); return found;
  }
  async run(args: string[], cwd = ''): Promise<void> {
    try {
      const result = await execute(process.execPath, [join(checkout, 'dist/cli-entry.js'), ...args],
        { cwd: this.path(cwd), timeout: 30_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, NODE_PATH: '' } });
      this.result = { ...result, code: 0 };
    } catch (error) {
      const result = error as { code: number; stdout: string; stderr: string };
      if (typeof result.code !== 'number') throw error;
      this.result = { code: result.code, stdout: result.stdout, stderr: result.stderr };
    }
    this.report = args.includes('--json') ? JSON.parse(this.result.stdout) : undefined;
  }
  async dispose(): Promise<void> {
    if (dirname(this.directory) !== this.parent || !(await realpath(this.directory)).startsWith(this.parent)
      || !this.directory.split(/[\\/]/).at(-1)!.startsWith('expec-cli-')) throw Error('Unexpected fixture cleanup.');
    await rm(this.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

