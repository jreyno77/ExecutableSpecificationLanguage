import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { ArtifactAssociation, OutputWrite, ProjectRead, ProjectSearch } from '../../src/index.js';
import { PackageDriver } from './installed-package.js';

export interface RecipeReport {
  written: OutputWrite;
  functions: string[]; books: string[]; allParametersUseBook: boolean; bookRecords: number;
  declarations: { file: string; name: string }[];
  read: Omit<ProjectRead, 'artifacts'> & { artifacts: (ProjectRead['artifacts'][number] & { text: string })[] };
  search: ProjectSearch;
  valid: boolean; artifacts: ArtifactAssociation[];
}

export class PublicRecipesDriver {
  readonly package = new PackageDriver();
  result!: { code: number; stdout: string; stderr: string };
  report!: RecipeReport;
  remembered: Record<string, string> = {};
  path(path: string): string { return join(this.package.root, path); }
  async file(path: string, text: string): Promise<void> { await mkdir(dirname(this.path(path)), { recursive: true }); await writeFile(this.path(path), text); }
  text(path: string): Promise<string> { return readFile(this.path(path), 'utf8'); }
  async install(): Promise<void> {
    await this.package.install();
    for (const file of ['workspace-build.mjs', 'adopt-store-game.mjs']) {
      await this.file(file, await this.text('node_modules/executable-specification-language/test/resources/package-consumer/' + file));
    }
    await this.file('public-recipes-consumer.mjs', await readFile(new URL('../resources/package-consumer/public-recipes-consumer.mjs', import.meta.url), 'utf8'));
    await this.file('project/package.json', JSON.stringify({ private: true, type: 'module' }));
    await this.file('project/tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', strict: true, types: [], noEmit: true }, include: ['**/*.ts'] }));
    await this.file('project/src/index.ts', 'export {};\n');
    await this.manifest(['main.expec']);
  }
  async manifest(entries: string[]): Promise<void> {
    await this.file('expec.json', JSON.stringify({ formatVersion: 1, version: '0.1.0', project: { root: './project' },
      build: { entries }, outputs: [{ id: 'typescript', options: { directory: 'src', configFile: 'tsconfig.json' } }] }));
  }
  async run(args: string[]): Promise<void> {
    try { this.result = { code: 0, ...await promisify(execFile)(process.execPath, args, {
      cwd: this.package.root, windowsHide: true, timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' },
    }) }; }
    catch (error) {
      const failed = error as { code?: number | string; killed?: boolean; stdout?: string; stderr?: string };
      if (typeof failed.code !== 'number' || failed.killed) throw error;
      this.result = { code: failed.code, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
    }
  }
  async consumer(action: string): Promise<void> {
    await this.run(['public-recipes-consumer.mjs', action]);
    if (this.result.code !== 0) throw Error(JSON.stringify(this.result));
    this.report = JSON.parse(await this.text('recipe-observed.json')) as RecipeReport;
  }
  async nativeFiles(): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    const walk = async (path: string): Promise<void> => {
      for (const entry of await readdir(this.path(path), { withFileTypes: true })) {
        const child = path + '/' + entry.name;
        if (entry.isDirectory()) await walk(child);
        else if (entry.isFile() && entry.name.endsWith('.ts')) result[child] = (await readFile(this.path(child))).toString('base64');
      }
    };
    await walk('project/src'); return result;
  }
  async baselineAbsent(path: string): Promise<boolean> {
    try { await readFile(this.path(path)); return false; }
    catch (error) { if ((error as { code?: string }).code === 'ENOENT') return true; throw error; }
  }
}
