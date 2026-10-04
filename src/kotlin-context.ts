import { promises as fs, type BigIntStats } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import type { ProjectContext, ProjectRoot, ProjectSnapshot } from './project-connection.js';
import type { Diagnostic } from './checking.js';
import { errorCode, hash, message, problem, sameIdentity } from './project-files.js';
import { nativeInputs } from './native-inputs.js';
import { kotlinConfiguration, kotlinConfigurationOptions, type KotlinConfiguration, type KotlinContextOptions } from './kotlin-configuration.js';

export const kotlinResources = fileURLToPath(new URL('./kotlin', import.meta.url));
const stable = (a: BigIntStats, b: BigIntStats) => sameIdentity(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && a.mode === b.mode;

/** Captures real native prerequisites without installing packages or running the connected build. */
export class KotlinContext implements ProjectContext {
  private readonly configFile: string;
  constructor(private readonly project: ProjectContext, options: KotlinContextOptions = {}) {
    if (!project || typeof project.readSnapshot !== 'function' || typeof project.root?.path !== 'string' || typeof project.root.identity !== 'string') throw new TypeError('Provide a ProjectContext.');
    this.configFile = kotlinConfigurationOptions(options);
  }
  get root(): ProjectRoot { return { ...this.project.root }; }
  async readSnapshot(): Promise<ProjectSnapshot> {
    const snapshot = structuredClone(await this.project.readSnapshot()), configured = kotlinConfiguration(snapshot, this.configFile);
    const problems = [...snapshot.problems, ...configured.problems];
    const supplied = nativeInputs(snapshot);
    if (!supplied) problems.push(problem(snapshot.root, 'native-inputs-unavailable', '', 'Upstream native evidence is malformed.'));
    const inputs = supplied ? [...snapshot.nativeInputs ?? []] : [];
    if (configured.value && !problems.length) {
      const native = await captureKotlinInputs(snapshot, configured.value, true); problems.push(...native.problems);
      for (const input of native.inputs) {
        const path = fileURLToPath(input.uri), previous = supplied!.get(process.platform === 'win32' ? path.toLowerCase() : path);
        if (previous === undefined) inputs.push(input);
        else if (previous !== input.version) problems.push(problem(snapshot.root, 'native-input-conflict', '', 'Upstream and Kotlin evidence disagree for ' + path));
      }
      const fresh = await this.project.readSnapshot();
      if (!isDeepStrictEqual(snapshot, structuredClone(fresh))) problems.push(problem(snapshot.root, 'stale-project', '', 'Project inputs changed during Kotlin capture.'));
    }
    return { ...snapshot, nativeInputs: inputs.sort((a, b) => a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0), problems, complete: snapshot.complete && problems.length === 0 };
  }
}

/** Native file evidence is small; JDK and library bytes stay in their explicit installed locations. */
export async function captureKotlinInputs(snapshot: ProjectSnapshot, config: KotlinConfiguration, verifySourceRoots = false): Promise<{ inputs: NonNullable<ProjectSnapshot['nativeInputs']>; problems: Diagnostic[] }> {
  const inputs = new Map<string, string>(), identities = new Map<string, string>(), problems: Diagnostic[] = [];
  const directories = new Map<string, { info: BigIntStats; names: string[] }>();
  const captured = new Map<string, BigIntStats>();
  const verifyParents = async (path: string) => {
    for (let current = dirname(path); dirname(current) !== current; current = dirname(current)) {
      const info = await fs.lstat(current, { bigint: true });
      if (!info.isDirectory() || info.isSymbolicLink() || await fs.realpath(current) !== resolve(current)) throw new Error('Native inputs must traverse ordinary canonical directories: ' + current);
    }
  };
  const file = async (path: string) => {
    path = resolve(path); if (inputs.has(path)) return;
    await verifyParents(path);
    const before = await fs.lstat(path, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || await fs.realpath(path) !== path) throw new Error('Native input must be an ordinary canonical file: ' + path);
    const identity = before.dev + ':' + before.ino, prior = identities.get(identity);
    if (prior && prior !== path) throw new Error('Repeated physical native input: ' + path);
    const handle = await fs.open(path, 'r');
    try {
      if (!stable(before, await handle.stat({ bigint: true }))) throw new Error('Native input changed while opening: ' + path);
      const bytes = await handle.readFile();
      if (!stable(before, await handle.stat({ bigint: true })) || !stable(before, await fs.lstat(path, { bigint: true }))) throw new Error('Native input changed while reading: ' + path);
      inputs.set(path, hash(bytes)); identities.set(identity, path); captured.set(path, before);
    } finally { await handle.close(); }
  };
  const tree = async (path: string): Promise<void> => {
    await verifyParents(path); const info = await fs.lstat(path, { bigint: true });
    if (!info.isDirectory() || info.isSymbolicLink() || await fs.realpath(path) !== resolve(path)) throw new Error('Native directory must be ordinary and canonical: ' + path);
    const names = (await fs.readdir(path)).sort(); directories.set(path, { info, names });
    for (const name of names) { const child = join(path, name), stat = await fs.lstat(child); if (stat.isDirectory()) await tree(child); else await file(child); }
  };
  try {
    const release = await fs.readFile(join(config.javaHome, 'release'), 'utf8');
    if (!/^JAVA_VERSION="21(?:[.+-]|\")/m.test(release)) throw new Error('The configured Kotlin toolchain must be JDK21.');
    await file(join(config.javaHome, 'release'));
    for (const directory of ['bin', 'lib', 'conf']) await tree(join(config.javaHome, directory));
    for (const path of [...config.classPath.main, ...config.classPath.test, ...config.runtimeClassPath?.main ?? [], ...config.runtimeClassPath?.test ?? []]) {
      if (!path.endsWith('.jar')) throw new Error('The native classpath profile accepts ordinary JAR files.'); await file(path);
    }
    await tree(kotlinResources);
    for (const artifact of config.artifacts ?? []) if (inputs.get(resolve(artifact.path)) !== artifact.version)
      throw new Error('Installed native artifact changed; run explicit install: ' + artifact.path);
    for (const root of verifySourceRoots ? [...config.sourceRoots.main, ...config.sourceRoots.test] : []) {
      let path = snapshot.root.path;
      for (const segment of root.split('/')) {
        path = join(path, segment);
        let info: BigIntStats; try { info = await fs.lstat(path, { bigint: true }); } catch (error) { if (errorCode(error) === 'ENOENT') break; throw error; }
        if (!info.isDirectory() || info.isSymbolicLink() || await fs.realpath(path) !== resolve(path)) throw new Error('Selected source root must traverse ordinary directories: ' + root);
        directories.set(path, { info, names: (await fs.readdir(path)).sort() });
      }
    }
    for (const [path, info] of captured) if (!stable(info, await fs.lstat(path, { bigint: true }))) throw new Error('Native input changed during capture: ' + path);
    for (const [path, before] of directories) if (!sameIdentity(before.info, await fs.lstat(path, { bigint: true })) || !isDeepStrictEqual(before.names, (await fs.readdir(path)).sort())) throw new Error('Native directory membership changed during capture: ' + path);
  } catch (error) { problems.push(problem(snapshot.root, 'native-inputs-unavailable', '', message(error))); }
  return { inputs: [...inputs].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, version]) => ({ uri: pathToFileURL(path).href, version })), problems };
}
