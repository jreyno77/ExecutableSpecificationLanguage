import { copyFile, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { InstalledPilotDriver } from './installed-pilot.js';
import { PackageDriver } from './installed-package.js';

export class CompilerPilotDriver extends InstalledPilotDriver {
  source = '';
  readonly bootstrapInputs: Record<string, string> = {};
  async author(source: string): Promise<void> {
    await this.install(); this.source = source; await this.file('main.expec', source);
    await this.file('expec.json', JSON.stringify({ formatVersion: 1, version: '0.1.0', build: { entries: ['main.expec'] },
      outputs: [{ id: 'markdown', options: { directory: 'reference' } },
        { id: 'acceptance', options: { domain: 'compiler', configFile: 'tsconfig.json' } }],
      packages: [{ alias: 'tests', name: 'npm:vitest', version: '5.0.2', phases: ['test'] },
        { alias: 'node', name: 'npm:@types/node', version: '24.13.6', phases: ['test'] }] }));
  }
  async configureTests(): Promise<void> {
    const manifest = JSON.parse(await this.text('expec.json'));
    manifest.outputs = manifest.outputs.filter((output: { id: string }) => output.id !== 'typescript');
    await this.file('expec.json', JSON.stringify(manifest));
    await copyFile(PackageDriver.packedArtifact, this.path('trusted-product.tgz'));
    const native = JSON.parse(await this.text('project/package.json'));
    native.devDependencies = { ...native.devDependencies, 'executable-specification-language': 'file:../trusted-product.tgz' };
    await this.file('project/package.json', JSON.stringify(native));
    await this.file('project/tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, types: ['node'], skipLibCheck: true }, include: ['**/*.ts'] }));
    await this.file('project/vitest.config.ts', 'import { defineConfig } from "vitest/config"; export default defineConfig({test:{include:["test/acceptance/*.test.ts"],retry:0}});');
    await this.file('project/compiler-options.json', '{}');
  }
  async useDriver(suppressProblems: boolean): Promise<void> {
    await this.file('project/test/driver/compiler.ts', await readFile(new URL('../resources/pilot/compiler-driver.mts', import.meta.url), 'utf8'));
    await this.file('project/compiler-options.json', JSON.stringify({ suppressProblems }));
  }
  async runScenarios(): Promise<void> { await this.file('project/compiler-observations.jsonl', ''); await this.cli(['test']); }
  async observations(): Promise<{ packageUrl: string; source: string; accepted: boolean; syntax: unknown[]; deferred: unknown[]; diagnostics: { code: string; text: string; line: number; column: number }[] }[]> {
    return (await this.text('project/compiler-observations.jsonl')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  }
  async implementationBytes(): Promise<Record<string, string>> {
    const files: Record<string, string> = {}, root = 'project/node_modules/executable-specification-language/dist';
    const visit = async (path: string): Promise<void> => {
      for (const entry of await readdir(this.path(path), { withFileTypes: true })) {
        const file = path + '/' + entry.name;
        if (entry.isDirectory()) await visit(file);
        else if (entry.isFile()) files[file.slice(root.length + 1)] = createHash('sha256').update(await readFile(this.path(file))).digest('hex');
      }
    };
    await visit(root); return files;
  }
  async rememberBootstrapInputs(): Promise<void> {
    for (const path of ['main.expec', 'expec.json', 'project/package.json', 'project/package-lock.json', 'project/tsconfig.json',
      'project/vitest.config.ts', 'project/test/driver/compiler.ts', 'project/compiler-options.json']) this.bootstrapInputs[path] = await this.text(path);
  }
  async restoreInputs(inputs: Record<string, string>): Promise<void> {
    await this.install();
    await copyFile(PackageDriver.packedArtifact, this.path('trusted-product.tgz'));
    for (const [path, text] of Object.entries(inputs)) await this.file(this.bootstrapPath(path), text);
  }
  bootstrapPath(path: string): string { return path === 'project/test/driver/compiler.ts' ? 'bootstrap/compiler.ts' : path; }
  async independentRegressions(): Promise<{ success: boolean; numPassedTests: number }> {
    const checkout = fileURLToPath(new URL('../../', import.meta.url));
    await promisify(execFile)(process.execPath, [checkout + '/node_modules/vitest/vitest.mjs', 'run',
      'test/acceptance/compiler-composition.test.ts', '--maxWorkers=1', '--reporter=json', '--outputFile=' + this.path('regressions.json')],
    { cwd: checkout, windowsHide: true, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
    return JSON.parse(await this.text('regressions.json'));
  }
}
