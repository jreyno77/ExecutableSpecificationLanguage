import childProcess from 'node:child_process';
import { promises as fs, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { vi } from 'vitest';
import { ConfigurationReader, type Diagnostic } from '../../../../src/index.js';
import { npmRequirements } from '../../../../src/project/dependencies/npm-dependencies.js';
import { NpmProject } from '../../../../src/project/dependencies/npm-project.js';

/** Reads scoped metadata and invokes the existing guarded native manifest writer only. */
export class ScopedNativeManifestDriver {
  private readonly temporary = realpathSync.native(tmpdir());
  private readonly directory = realpathSync.native(mkdtempSync(join(this.temporary, 'expec-scoped-native-')));
  private readonly root = join(this.directory, 'project');
  private readonly manifestLocation = join(this.directory, 'expec.json');
  private readonly manifest: Readonly<Record<string, unknown>>;
  private configured = false;
  private processes = 0;

  constructor(settings: Readonly<Record<string, unknown>>) {
    this.manifest = { formatVersion: 1, version: '0.1.0', project: { root: 'project' },
      build: { entries: ['src/data/store.expec'] }, ...structuredClone(settings) };
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.root);
    await fs.writeFile(this.manifestLocation, JSON.stringify(this.manifest, null, 2) + '\n');
  }

  async nativeManifest(fields: Readonly<Record<string, unknown>>): Promise<void> {
    await fs.writeFile(join(this.root, 'package.json'), JSON.stringify(structuredClone(fields), null, 2) + '\n');
    this.configured = false;
  }

  async configureNativeManifest(): Promise<void> {
    const spawned = vi.spyOn(childProcess, 'spawn'), spawnedSync = vi.spyOn(childProcess, 'spawnSync');
    try {
      const configured = new ConfigurationReader([]).read({ sourceId: this.manifestLocation,
        text: await fs.readFile(this.manifestLocation, 'utf8') });
      if (!configured.value || configured.problems.length || configured.deferred.length) {
        throw Error('The actual scoped configuration was refused: ' + JSON.stringify(configured));
      }
      const problems: Diagnostic[] = [], requests = npmRequirements(configured.value.packages, problems);
      if (problems.length) throw Error('The actual native requirements were refused: ' + JSON.stringify(problems));
      const project = await NpmProject.open(this.root), written = await project.configure(requests);
      if (written.value.state !== 'file') throw Error('The native manifest writer did not return an actual file.');
      this.configured = true;
    } finally {
      this.processes += spawned.mock.calls.length + spawnedSync.mock.calls.length;
      spawned.mockRestore(); spawnedSync.mockRestore();
    }
  }

  async nativeDependency(group: 'dependencies' | 'devDependencies', name: string): Promise<unknown> {
    const fields = await this.nativeFields(), dependencies = fields[group];
    if (dependencies === undefined) return undefined;
    if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) throw Error('The actual native dependency map is malformed.');
    return (dependencies as Record<string, unknown>)[name];
  }

  async nativeFields(): Promise<Readonly<Record<string, unknown>>> {
    this.requireConfigured();
    const fields: unknown = JSON.parse(await fs.readFile(join(this.root, 'package.json'), 'utf8'));
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw Error('The actual native manifest is not an object.');
    return fields as Readonly<Record<string, unknown>>;
  }

  async actualPackageManifestPaths(): Promise<readonly string[]> {
    this.requireConfigured();
    const paths: string[] = [];
    const visit = async (path: string): Promise<void> => {
      for (const entry of await fs.readdir(join(this.root, path), { withFileTypes: true })) {
        const child = path ? path + '/' + entry.name : entry.name;
        if (entry.isDirectory()) await visit(child);
        else if (entry.name === 'package.json') paths.push(child);
      }
    };
    await visit(''); return paths.sort();
  }

  actualNativeProcesses(): number { this.requireConfigured(); return this.processes; }

  async dispose(): Promise<void> {
    const path = relative(this.temporary, this.directory);
    if (isAbsolute(path) || path.includes(sep) || !path.startsWith('expec-scoped-native-')
      || resolve(this.temporary, path) !== this.directory) throw Error('Unsafe native fixture cleanup.');
    await fs.rm(this.directory, { recursive: true, force: true });
  }

  private requireConfigured(): void {
    if (!this.configured) throw Error('Run the actual native manifest writer before observing its result.');
  }
}

export async function scopedNativeManifest(settings: Readonly<Record<string, unknown>>): Promise<ScopedNativeManifestDriver> {
  const driver = new ScopedNativeManifestDriver(settings);
  try { await driver.initialize(); return driver; }
  catch (error) { await driver.dispose(); throw error; }
}
