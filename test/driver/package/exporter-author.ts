import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { PackageDriver } from './installed-package.js';

interface FormatLocation { format: string; value: { file: string; format: string; id: string; start: number; end: number } }
interface ExporterReport {
  message: string; privateDenied: string; entry: string; status: string; changes: number;
  syntax: unknown[]; deferred: unknown[];
  problems: { code: string; at: { kind: string; path?: (string | number)[]; range?: { sourceId: string; start: { offset: number }; end: { offset: number } } } }[];
  read: { artifacts: { text: string; file: { path: string } }[]; coverage: { complete: boolean }; problems: unknown[] };
  search: { definitions: FormatLocation[]; problems: ExporterReport['problems'];
    incoming: { uses: { at: FormatLocation; target: { kind: string; id: string } }[];
      coverage: { complete: boolean; scope: FormatLocation[] } } };
}

export class ExporterDriver {
  readonly package = new PackageDriver();
  result!: { code: number; stdout: string; stderr: string };
  report!: ExporterReport;
  compilerBytes = '';
  remembered: Record<string, string> = {};
  decisions = false;
  path(path: string): string { return join(this.package.root, path); }
  async file(path: string, text: string): Promise<void> { await mkdir(dirname(this.path(path)), { recursive: true }); await writeFile(this.path(path), text); }
  async text(path: string): Promise<string> { return readFile(this.path(path), 'utf8'); }
  async install(): Promise<void> {
    await this.package.install();
    this.compilerBytes = await this.text('node_modules/executable-specification-language/dist/compiler/compiler.js');
    await this.file('expec.json', JSON.stringify({ formatVersion: 1, version: '0.1.0', project: { root: './project' },
      build: { entries: ['main.expec'] }, outputs: [{ id: 'signatures', options: { destination: 'contracts.ndjson' } }] }));
    await this.file('project/README.txt', 'An independent signature catalog.\n');
    await this.file('exporter-consumer.mjs', await readFile(new URL('../../resources/package-consumer/exporter-consumer.mjs', import.meta.url), 'utf8'));
  }
  async copySample(): Promise<void> {
    await this.file('signatures-output.ts', await this.text('node_modules/executable-specification-language/test/resources/package-consumer/signatures-output.ts'));
  }
  async run(args: string[]): Promise<void> {
    try { this.result = { code: 0, ...await promisify(execFile)(process.execPath, args, {
      cwd: this.package.root, windowsHide: true, timeout: 180_000, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' },
    }) }; }
    catch (error) {
      const failed = error as { code?: number | string; killed?: boolean; stdout?: string; stderr?: string };
      if (typeof failed.code !== 'number' || failed.killed) throw error;
      this.result = { code: failed.code, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
    }
  }
  async compile(): Promise<void> {
    await this.run(['node_modules/typescript/bin/tsc', 'signatures-output.ts', '--target', 'ES2022', '--module', 'NodeNext', '--strict', '--skipLibCheck']);
  }
  async consumer(action: string, argument?: string): Promise<void> {
    await this.run(['exporter-consumer.mjs', action, ...(argument ? [argument] : [])]);
    if (action !== 'cli' && this.result.code !== 0) throw Error(JSON.stringify(this.result));
    this.report = action === 'cli' ? JSON.parse(this.result.stdout) : JSON.parse(await this.text('observed.json'));
  }
  async records(file = 'contracts.ndjson'): Promise<{ kind: string; id: string; text?: string }[]> {
    try { return (await this.text('project/' + file)).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
    catch (error) { if ((error as { code?: string }).code === 'ENOENT') return []; throw error; }
  }
  async id(name: string): Promise<string> {
    const row = (await this.records()).find(row => row.kind === 'signature' && row.text?.startsWith(name + '('));
    if (!row) throw Error('No actual signature for ' + name); return row.id;
  }
  async projectFiles(): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    const walk = async (path: string): Promise<void> => {
      for (const entry of await readdir(this.path(path), { withFileTypes: true })) {
        const child = path + '/' + entry.name;
        if (entry.isDirectory()) await walk(child);
        else if (entry.isFile()) result[child] = (await readFile(this.path(child))).toString('base64');
        else throw Error('Unexpected nonordinary project file.');
      }
    };
    await walk('project'); return result;
  }
}
