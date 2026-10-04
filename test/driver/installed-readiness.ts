import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { PackageDriver } from './installed-package.js';

/** Native commands and adversarial baseline arrangement in an actual installed consumer. */
export class InstalledReadinessDriver {
  readonly package = new PackageDriver();
  result!: { code: number; stdout: string; stderr: string };
  report!: { status: string; problems: { code: string }[]; stages: {
    name: string; collected?: { title: string }[]; tests?: { title: string; state: string }[];
  }[] };
  private executable = '';
  private before: Record<string, string> = {};
  private path(path: string): string { return join(this.package.root, path); }
  async file(path: string, text: string): Promise<void> { await mkdir(dirname(this.path(path)), { recursive: true }); await writeFile(this.path(path), text); }
  async prepare(source: string): Promise<void> {
    await this.package.install();
    const root = this.path('node_modules/executable-specification-language');
    const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    this.executable = join(root, metadata.bin.expec);
    await this.file('main.expec', source);
    await this.file('expec.json', JSON.stringify({ formatVersion: 1, version: '0.1.0', build: { entries: ['main.expec'] },
      outputs: [{ id: 'acceptance', options: { domain: 'numbers', configFile: 'tsconfig.json' } }],
      packages: [{ alias: 'tests', name: 'npm:vitest', version: '5.0.2', phases: ['test'] },
        { alias: 'node', name: 'npm:@types/node', version: '24.13.6', phases: ['test'] }] }));
  }
  private async run(args: string[]): Promise<void> {
    try { this.result = { code: 0, ...await promisify(execFile)(process.execPath, args, {
      cwd: this.package.root, windowsHide: true, timeout: 180_000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' },
    }) }; }
    catch (error) {
      const failed = error as { code?: number | string; killed?: boolean; stdout?: string; stderr?: string };
      if (typeof failed.code !== 'number' || failed.killed) throw error;
      this.result = { code: failed.code, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
    }
  }
  async command(args: string[]): Promise<void> {
    await this.run([...(args[0] === 'test' ? ['--import', pathToFileURL(this.path('observe-runner.mjs')).href] : []), this.executable, ...args, '--config', this.path('expec.json'), '--json']);
    if (!this.result.stdout.trim()) throw Error('The actual CLI returned no JSON: ' + JSON.stringify(this.result));
    this.report = JSON.parse(this.result.stdout);
  }
  async observeRunnerStart(): Promise<void> {
    await this.file('observe-runner.mjs', 'import child from "node:child_process"; import { appendFileSync } from "node:fs"; import { syncBuiltinESMExports } from "node:module"; const fork = child.fork; child.fork = (...args) => { appendFileSync("runner-forks.jsonl", JSON.stringify({entry:args[0]}) + "\\n"); return fork(...args); }; syncBuiltinESMExports();');
    await this.file('game/tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, types: ['node'], skipLibCheck: true }, include: ['**/*.ts'] }));
    await this.file('game/runner-observed.ts', 'import { writeFileSync } from "node:fs"; writeFileSync("../runner-started.txt", "Native runner loaded its setup.");');
    await this.file('game/vitest.config.ts', 'import { defineConfig } from "vitest/config"; export default defineConfig({test:{include:["test/acceptance/*.test.ts"],setupFiles:["./runner-observed.ts"],retry:0}});');
  }
  async runnerStarted(): Promise<boolean> {
    try { return await readFile(this.path('runner-started.txt'), 'utf8') === 'Native runner loaded its setup.'; }
    catch (error) { if ((error as { code?: string }).code !== 'ENOENT') throw error; return false; }
  }
  async runnerForks(): Promise<{ entry: string }[]> {
    try { return (await readFile(this.path('runner-forks.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)); }
    catch (error) { if ((error as { code?: string }).code !== 'ENOENT') throw error; return []; }
  }
  async withdraw(title: string): Promise<void> {
    await rm(this.path('runner-started.txt'));
    await rm(this.path('runner-forks.jsonl'));
    await this.file('withdraw-case.mjs', await readFile(new URL('../resources/package-consumer/withdraw-case.mjs', import.meta.url), 'utf8'));
    await this.run(['withdraw-case.mjs', title]);
    if (this.result.code) throw Error(this.result.stdout + this.result.stderr);
  }
  async projectFiles(): Promise<Record<string, string>> {
    const files: Record<string, string> = {};
    const walk = async (path: string): Promise<void> => {
      for (const item of await readdir(this.path(path), { withFileTypes: true })) {
        if (item.name === 'node_modules') continue;
        const child = path + '/' + item.name;
        if (item.isDirectory()) await walk(child);
        else if (item.isFile()) files[child] = (await readFile(this.path(child))).toString('base64');
        else throw Error('Unexpected linked consumer input.');
      }
    };
    await walk('game'); return files;
  }
  async remember(): Promise<void> { this.before = await this.projectFiles(); }
  async unchanged(): Promise<boolean> {
    const files = await this.projectFiles();
    return Object.keys(files).length === Object.keys(this.before).length && Object.entries(files).every(([path, bytes]) => this.before[path] === bytes);
  }
}
