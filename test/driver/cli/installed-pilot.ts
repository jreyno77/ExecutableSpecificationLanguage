import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { PackageDriver } from '../package/installed-package.js';

/** Ordinary files and processes around the actual installed public product. */
export class InstalledPilotDriver {
  readonly package = new PackageDriver();
  result!: { code: number; stdout: string; stderr: string };
  report: unknown;
  executable = '';
  artifactDigest = '';
  version = '';
  get root(): string { return this.package.root; }
  async install(): Promise<void> {
    await this.package.install();
    const directory = await realpath(this.path('node_modules/executable-specification-language'));
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    this.executable = resolve(directory, manifest.bin.expec); this.version = manifest.version;
    if (!relative(directory, this.executable) || relative(directory, this.executable).startsWith('..')) throw Error('The public launcher must belong to the installed package.');
    this.artifactDigest = createHash('sha256').update(await readFile(PackageDriver.packedArtifact)).digest('hex');
  }
  path(path: string): string {
    const value = resolve(this.root, path), inside = relative(this.root, value);
    if (isAbsolute(inside) || inside === '..' || inside.startsWith('../') || inside.startsWith('..\\')) throw Error('Pilot files must stay inside their consumer.');
    return value;
  }
  async file(path: string, text: string): Promise<void> { const target = this.path(path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, text); }
  text(path: string): Promise<string> { return readFile(this.path(path), 'utf8'); }
  async run(args: string[], directory = ''): Promise<void> {
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !['NODE_PATH', 'NODE_OPTIONS'].includes(name.toUpperCase())));
    try { this.result = { code: 0, ...await promisify(execFile)(process.execPath, args, { cwd: this.path(directory), env, windowsHide: true, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 }) }; }
    catch (error) {
      const failure = error as { code?: number | string; killed?: boolean; stdout?: string; stderr?: string };
      if (typeof failure.code !== 'number' || failure.killed) throw error;
      this.result = { code: failure.code, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
    }
  }
  async cli(args: string[]): Promise<void> {
    await this.run([this.executable, ...args, '--config', this.path('expec.json'), '--json']);
    this.report = JSON.parse(this.result.stdout);
  }
  dispose(): Promise<void> { return this.package.dispose(); }
}
