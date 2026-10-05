import { promises as fs, type BigIntStats } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import os from 'node:os';
import { readJson } from '../../model/json-data.js';
import { errorCode, fail, literal, ProjectFiles, sameIdentity, type ObservedFile } from '../connection/project-files.js';

/** Native manifest and package evidence use the existing guarded project-file operations. */
export class NpmProject {
  private constructor(readonly selected: string, readonly files: ProjectFiles, readonly manifest: ObservedFile, readonly data: Record<string, unknown>) {}
  static async open(selected: string): Promise<NpmProject> {
    const named = await fs.lstat(selected, { bigint: true }), path = await fs.realpath(selected), actual = await fs.lstat(path, { bigint: true });
    if (!named.isDirectory() || named.isSymbolicLink() || !sameIdentity(named, actual) || actual.ino <= 0n) throw new Error('Provide an ordinary native project directory with usable identity.');
    const files = new ProjectFiles({ path, identity: `${actual.dev}:${actual.ino}:${path}` });
    const manifest = await files.read('package.json');
    if (manifest.value.state !== 'file') fail(files.root, 'native-project-unavailable', 'package.json', 'An existing regular package.json is required.');
    const data = parse(files, manifest, 'package.json');
    if (data.workspaces !== undefined) fail(files.root, 'unsupported-native-project', 'package.json', 'npm workspace orchestration is not supported.');
    for (const name of ['dependencies', 'devDependencies']) if (data[name] !== undefined
      && (!object(data[name]) || Object.values(data[name]).some(value => typeof value !== 'string'))) {
      fail(files.root, 'invalid-native-manifest', 'package.json', name + ' must be a native string dependency map.');
    }
    const project = new NpmProject(selected, files, manifest, data);
    await project.verifyRoot(); return project;
  }
  async verifyRoot(): Promise<void> {
    if (await fs.realpath(this.selected) !== this.files.root.path || (await fs.lstat(this.selected)).isSymbolicLink()) {
      fail(this.files.root, 'stale-project', '', 'The selected project root changed.');
    }
    await this.files.verifyRoot();
    try {
      await fs.lstat(join(this.files.root.path, 'npm-shrinkwrap.json'));
      fail(this.files.root, 'unsupported-native-project', 'npm-shrinkwrap.json', 'This profile requires package-lock.json; native shrinkwrap projects are unsupported.');
    } catch (error) { if (errorCode(error) !== 'ENOENT') throw error; }
  }
  async readCache(): Promise<ProjectFiles> {
    const parent = await fs.realpath(os.tmpdir()), child = relative(this.files.root.path, parent);
    if (!isAbsolute(child) && child !== '..' && !child.startsWith('..' + sep)) {
      fail(this.files.root, 'unsupported-native-project', '', 'The native read cache needs an OS temporary directory outside the project.');
    }
    const path = await fs.mkdtemp(join(parent, 'expec-npm-read-')), info = await fs.lstat(path, { bigint: true });
    return new ProjectFiles({ path, identity: `${info.dev}:${info.ino}:${path}` });
  }
  async prepareInstall(): Promise<() => Promise<void>> {
    const directory = async (): Promise<BigIntStats | undefined> => {
      try { return await fs.lstat(join(this.files.root.path, 'node_modules'), { bigint: true }); }
      catch (error) { if (errorCode(error) === 'ENOENT') return undefined; throw error; }
    };
    const before = await directory(), lock = await this.files.read('package-lock.json');
    if (before && (!before.isDirectory() || before.isSymbolicLink())) {
      fail(this.files.root, 'unsupported-change', 'node_modules', 'Native installation requires an absent or ordinary node_modules directory.');
    }
    const verify = async (): Promise<void> => {
      await this.verifyRoot(); const after = await directory();
      if (before ? !after || !after.isDirectory() || after.isSymbolicLink() || !sameIdentity(before, after) : after !== undefined) {
        fail(this.files.root, 'stale-project', 'node_modules', 'The native installation directory changed after preflight.');
      }
      await this.files.verify('package-lock.json', lock);
    };
    await verify(); return verify;
  }
  async configure(requests: readonly { native: string; requested: string; runtime: boolean }[]): Promise<ObservedFile> {
    const updated = structuredClone(this.data);
    for (const request of requests) {
      const group = request.runtime ? 'dependencies' : 'devDependencies', other = request.runtime ? 'devDependencies' : 'dependencies';
      const values = object(updated[group]) ? updated[group] : {};
      updated[group] = { ...values, [request.native]: request.requested };
      if (object(updated[other])) delete updated[other][request.native];
    }
    await this.verifyRoot();
    if (JSON.stringify(updated) === JSON.stringify(this.data)) { await this.files.verify('package.json', this.manifest); return this.manifest; }
    await this.files.write('package.json', Buffer.from(JSON.stringify(updated, null, 2) + '\n'), this.manifest);
    return this.files.read('package.json');
  }
  async json(path: string): Promise<{ data?: Record<string, unknown>; observation: ObservedFile }> {
    const observation = await this.files.read(path);
    return { observation, ...(observation.value.state === 'file' ? { data: parse(this.files, observation, path) } : {}) };
  }
  location(path: string): string {
    if (!literal(path) || /[\\*]/.test(path) || /^[A-Za-z]:/.test(path)) {
      fail(this.files.root, 'unsupported-package-location', '', 'Native package location must be a literal path within the selected project.');
    }
    return path;
  }
}
function parse(files: ProjectFiles, observed: ObservedFile, path: string): Record<string, unknown> {
  if (observed.value.state !== 'file') fail(files.root, 'native-file-unavailable', path, 'Expected a regular native JSON file.');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(observed.value.bytes); }
  catch { fail(files.root, 'invalid-native-json', path, 'Native JSON is not valid UTF-8.'); }
  const data = readJson(text, (_code, message) => fail(files.root, 'invalid-native-json', path, message));
  if (!object(data)) fail(files.root, 'invalid-native-json', path, 'Native JSON must be an object.');
  return data;
}
export function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
