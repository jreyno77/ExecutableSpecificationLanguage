import { promises as fs } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import type { Diagnostic } from './checking.js';
import type { ProjectSnapshot } from './project-connection.js';
import { hash } from './project-files.js';
import { outputProblem } from './output-documents.js';
import { readJson } from './json-data.js';
import { pythonReportPath, type PythonProfile } from './python-profile.js';

const absolute = z.string().refine(value => isAbsolute(value) && !value.includes('\0')), digest = z.string().regex(/^[a-f0-9]{64}$/);
const reportSchema = z.strictObject({ format: z.literal(1), config: digest, pyproject: digest, lock: digest,
  python: z.strictObject({ path: absolute, version: z.string().regex(/^3\.12\.\d+$/), stdlib: z.array(absolute).min(1), binaries: z.array(absolute) }),
  uv: z.strictObject({ path: absolute, version: z.literal('0.12.23') }), environment: z.strictObject({ path: absolute, sites: z.array(absolute).min(1) }),
  tools: z.strictObject({ libcst: z.literal('1.9.0'), jedi: z.literal('0.20.0'), mypy: z.literal('2.4.0'), pytest: z.literal('9.1.1') }),
  packages: z.array(z.strictObject({ alias: z.string().min(1), name: z.string().min(1), version: z.string().min(1), phases: z.array(z.enum(['build', 'runtime', 'test'])) })),
});
export type PythonEnvironment = z.infer<typeof reportSchema>;

export function pythonEnvironment(snapshot: ProjectSnapshot, profile: PythonProfile, configFile = 'expec.python.json'): { value?: PythonEnvironment; problems: Diagnostic[] } {
  const problems: Diagnostic[] = [], file = snapshot.files.find(file => file.path === pythonReportPath);
  if (!file) return { problems: [outputProblem('python-install-required', pythonReportPath, 'Run an explicit Python install before using native project analysis.')] };
  try {
    const parsed = reportSchema.safeParse(readJson(new TextDecoder('utf-8', { fatal: true }).decode(file.bytes), (code, message) => problems.push(outputProblem(code, pythonReportPath, message))));
    if (!parsed.success) return { problems: [...problems, outputProblem('invalid-python-environment', pythonReportPath, 'The installed Python profile report is invalid.')] };
    const data = parsed.data, key = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
    if (key(data.python.path) !== key(profile.python) || key(data.uv.path) !== key(profile.uv) || key(data.environment.path) !== key(join(snapshot.root.path, profile.environment))
      || data.environment.sites.some(path => !key(path).startsWith(key(data.environment.path) + (process.platform === 'win32' ? '\\' : '/')))) problems.push(outputProblem('stale-python-environment', pythonReportPath, 'Installed native locations disagree with the Python profile.'));
    for (const [path, digest] of [[configFile, data.config], ['pyproject.toml', data.pyproject], ['uv.lock', data.lock]]) {
      const source = snapshot.files.find(file => file.path === path);
      if (!source || hash(source.bytes) !== digest) problems.push(outputProblem('stale-python-environment', path!, 'Native requirements changed; run an explicit install.'));
    }
    return problems.length ? { problems } : { value: data, problems };
  } catch { return { problems: [outputProblem('invalid-python-environment', pythonReportPath, 'The installed report must be valid UTF-8 JSON.')] }; }
}

/** Hashes the exact selected native files and inventories; never grants them write ownership. */
export class PythonInputs {
  readonly problems: Diagnostic[] = [];
  readonly inputs = new Map<string, string>();
  private readonly directories = new Map<string, string[]>();
  private readonly fingerprints = new Map<string, string>();
  async capture(environment: PythonEnvironment, profile: PythonProfile): Promise<void> {
    for (const directory of [...environment.python.stdlib, ...environment.environment.sites, ...profile.sourcePath]) await this.walk(directory);
    for (const path of [profile.python, profile.uv, ...environment.python.binaries]) await this.file(path);
    await this.file(fileURLToPath(new URL('./python/inspect.py', import.meta.url)));
    await this.verify();
  }
  private fingerprint(info: Awaited<ReturnType<typeof fs.lstat>>): string { return [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs, info.mode].join(':'); }
  private async ordinary(path: string, directory: boolean): Promise<Awaited<ReturnType<typeof fs.lstat>>> {
    const info = await fs.lstat(path);
    if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile()) || !info.ino) throw new Error('Native input is not an ordinary identifiable ' + (directory ? 'directory.' : 'file.'));
    return info;
  }
  private async walk(path: string): Promise<void> {
    if (this.directories.has(path)) return;
    try {
      await this.ordinary(path, true);
      const names = (await fs.readdir(path)).filter(name => name !== '__pycache__' && name !== 'site-packages').sort();
      this.directories.set(path, names);
      for (const name of names) {
        const child = join(path, name), info = await fs.lstat(child);
        if (info.isSymbolicLink()) throw new Error('Native inputs cannot follow a link: ' + child);
        if (info.isDirectory()) await this.walk(child); else if (!name.endsWith('.pyc')) await this.file(child);
      }
    } catch (error) { this.problems.push(outputProblem('native-input-unavailable', path, String(error))); }
  }
  private async file(path: string): Promise<void> {
    const uri = pathToFileURL(resolve(path)).href; if (this.inputs.has(uri)) return;
    try {
      const before = await this.ordinary(path, false), bytes = await fs.readFile(path), after = await this.ordinary(path, false);
      if (this.fingerprint(before) !== this.fingerprint(after)) throw new Error('Native input changed during capture.');
      this.inputs.set(uri, hash(bytes)); this.fingerprints.set(path, this.fingerprint(after));
    } catch (error) { this.problems.push(outputProblem('native-input-unavailable', path, String(error))); }
  }
  async verify(): Promise<void> {
    for (const [path, names] of this.directories) try {
      await this.ordinary(path, true);
      if (JSON.stringify((await fs.readdir(path)).filter(name => name !== '__pycache__' && name !== 'site-packages').sort()) !== JSON.stringify(names)) throw new Error('Native directory entries changed.');
    } catch (error) { this.problems.push(outputProblem('native-input-changed', path, String(error))); }
    for (const [path, stamp] of this.fingerprints) try {
      const before = await this.ordinary(path, false), bytes = await fs.readFile(path), after = await this.ordinary(path, false);
      if (this.fingerprint(before) !== stamp || this.fingerprint(after) !== stamp || hash(bytes) !== this.inputs.get(pathToFileURL(resolve(path)).href)) throw new Error('Native bytes changed after capture.');
    } catch (error) { this.problems.push(outputProblem('native-input-changed', path, String(error))); }
  }
  evidence(): { uri: string; version: string }[] { return [...this.inputs].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([uri, version]) => ({ uri, version })); }
}
