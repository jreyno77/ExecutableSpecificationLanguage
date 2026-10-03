import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile), require = createRequire(import.meta.url);
const checkout = fileURLToPath(new URL('../../', import.meta.url));
const resources = join(checkout, 'test/resources/package-consumer');
const packageName = 'executable-specification-language';
type ProcessResult = { code: number; stdout: string; stderr: string };
interface ConsumerReport {
  packageUrl: string;
  accepted?: boolean;
  syntax?: unknown[];
  deferred?: unknown[];
  problems?: { code: string; text?: string }[];
  capabilities?: string[];
  writing?: { status: string; problems: unknown[]; outcomes: string[]; before: string[];
    file: string; handwritten: string; markerPresent: boolean };
  error?: { code?: string; message: string; url?: string };
}

/** Native packing, isolated installation, and observations from separate consumer processes. */
export class PackageDriver {
  private static directory: string;
  private static artifact: string;
  private directory?: string;
  private consumer!: string;
  result!: ProcessResult;
  declarations!: ProcessResult;
  report!: ConsumerReport;
  location!: Awaited<ReturnType<typeof packageLocation>>;

  static async prepare(): Promise<void> {
    const version = await npm(checkout, ['--version']);
    if (version.stdout.trim() !== '11.20.0') throw new Error(`Expected npm 11.20.0, received ${version.stdout}`);
    this.directory = await mkdtemp(join(tmpdir(), 'expec-package-'));
    this.artifact = await pack(checkout, this.directory, true);
  }
  static async finish(): Promise<void> { if (this.directory) await cleanup(this.directory); }

  async install(options: { withoutFile?: string; withoutDependency?: string } = {}): Promise<void> {
    this.directory = await mkdtemp(join(tmpdir(), 'expec-package-'));
    this.consumer = join(this.directory, 'consumer');
    let artifact = PackageDriver.artifact;
    if (options.withoutFile || options.withoutDependency) {
      const seed = join(this.directory, 'seed'), copy = join(this.directory, 'package-copy');
      await this.installInto(seed, artifact);
      const installed = join(seed, 'node_modules', packageName);
      await cp(installed, copy, { recursive: true,
        filter: source => !relative(installed, source).split(sep).includes('node_modules') });
      if (options.withoutFile) await unlink(child(copy, options.withoutFile));
      if (options.withoutDependency) {
        const manifestPath = join(copy, 'package.json'), manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
        if (!Object.hasOwn(manifest.dependencies ?? {}, options.withoutDependency)) throw new Error('The negative fixture must remove a real declared dependency');
        delete manifest.dependencies[options.withoutDependency];
        await writeFile(manifestPath, JSON.stringify(manifest));
      }
      artifact = await pack(copy, join(this.directory, 'altered-artifact'));
    }
    await this.installInto(this.consumer, artifact);
    await cp(join(resources, 'consumer.mjs'), join(this.consumer, 'consumer.mjs'));
    if (options.withoutDependency) await this.verifyDependencyAbsent(options.withoutDependency);
  }
  private async installInto(directory: string, artifact: string): Promise<void> {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'expec-package-consumer', private: true, type: 'module' }));
    await npm(directory, ['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--no-package-lock', artifact]);
  }
  async check(text: string): Promise<void> {
    const source = join(this.consumer, 'source.expec');
    await writeFile(source, text);
    this.result = await run(process.execPath, ['consumer.mjs', source], this.consumer);
    await this.readReport();
  }
  async writeProject(before: string, after: string): Promise<void> {
    await cp(join(resources, 'writer.mjs'), join(this.consumer, 'writer.mjs'));
    await writeFile(join(this.consumer, 'write.json'), JSON.stringify({ before, after }));
    this.result = await run(process.execPath, ['writer.mjs', 'write.json'], this.consumer);
    await this.readReport();
  }
  private async readReport(): Promise<void> {
    try { this.report = JSON.parse(this.result.stdout); }
    catch { throw new Error(`Consumer did not return observations. ${output(this.result)}`); }
    if (this.report.packageUrl) {
      this.location = await packageLocation(this.consumer, fileURLToPath(this.report.packageUrl));
    }
  }
  async checkTypeScript(): Promise<void> {
    await cp(join(resources, 'consumer.mts'), join(this.consumer, 'consumer.mts'));
    await writeFile(join(this.consumer, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2022', strict: true,
        exactOptionalPropertyTypes: true, skipLibCheck: true, noEmit: true, types: [] },
      files: ['consumer.mts'],
    }));
    this.declarations = await run(process.execPath, [require.resolve('typescript/bin/tsc'), '--pretty', 'false', '-p', 'tsconfig.json'], this.consumer);
  }
  private async verifyDependencyAbsent(name: string): Promise<void> {
    const graph = await run(process.execPath, [npmExecutable(), 'ls', name, '--all', '--json'], this.consumer);
    const installed = (entry: { dependencies?: Record<string, typeof entry> }): boolean =>
      !!entry.dependencies && (Object.hasOwn(entry.dependencies, name) || Object.values(entry.dependencies).some(installed));
    if (installed(JSON.parse(graph.stdout))) throw new Error(`Negative fixture still has ${name} in its installed graph`);
    const entry = join(this.consumer, 'node_modules', packageName, 'dist/index.js');
    for (const directory of createRequire(entry).resolve.paths(name) ?? []) {
      try { await stat(join(directory, name)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
      throw new Error(`Negative fixture can find ${name} at ${directory}`);
    }
  }
  async dispose(): Promise<void> { if (this.directory) await cleanup(this.directory); }
}

export async function packageLocation(consumer: string, entry: string) {
  const installed = join(await realpath(consumer), 'node_modules', packageName), real = await realpath(entry);
  return { expected: join(installed, 'dist/index.js'), real, insidePackage: contained(installed, real) };
}

async function pack(directory: string, destination: string, release = false): Promise<string> {
  await mkdir(destination, { recursive: true });
  await npm(directory, [...(release ? ['run', 'release', '--'] : ['pack']), '--ignore-scripts', '--pack-destination', destination]);
  const archives = (await readdir(destination)).filter(name => name.endsWith('.tgz'));
  if (archives.length !== 1) throw new Error(`Expected one packed artifact, found ${archives.length}`);
  return join(destination, archives[0]!);
}
function npmExecutable(): string {
  const executable = process.env.npm_execpath;
  if (!executable || !isAbsolute(executable)) throw new Error('Run the package suite with npm run test:package so its pinned npm executable is available');
  return executable;
}
async function npm(directory: string, args: string[]): Promise<ProcessResult> {
  const result = await run(process.execPath, [npmExecutable(), ...args], directory);
  if (result.code !== 0) throw new Error(`npm ${args[0]} failed. ${output(result)}`);
  return result;
}
async function run(executable: string, args: string[], cwd: string): Promise<ProcessResult> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !['NODE_PATH', 'NODE_OPTIONS'].includes(key.toUpperCase())));
  try {
    const result = await execute(executable, args, { cwd, env, timeout: 120_000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8', windowsHide: true });
    return { code: 0, ...result };
  } catch (error) {
    const failure = error as { code?: number | string; stdout?: string; stderr?: string; killed?: boolean };
    if (typeof failure.code !== 'number' || failure.killed) throw error;
    return { code: failure.code, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}
function output(result: ProcessResult): string { return `Exit ${result.code}\n${result.stdout}\n${result.stderr}`; }
function contained(parent: string, path: string): boolean {
  const inside = relative(resolve(parent), resolve(path));
  return !!inside && !isAbsolute(inside) && inside !== '..' && !inside.startsWith(`..${sep}`);
}
function child(parent: string, path: string): string {
  const target = resolve(parent, path);
  if (!contained(parent, target)) throw new Error('Fixture path must stay inside its owned directory');
  return target;
}
async function cleanup(directory: string): Promise<void> {
  const name = relative(resolve(tmpdir()), resolve(directory));
  if (isAbsolute(name) || name.includes(sep) || !name.startsWith('expec-package-')) throw new Error('Refusing to remove an unexpected fixture directory');
  await rm(directory, { recursive: true, force: true });
}
