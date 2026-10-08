import { expect, vi } from 'vitest';
import { BuildContext } from '../../../src/cli/cli-context.js';
import type { ProjectFile, ProjectSnapshot } from '../../../src/project/connection/project-connection.js';
import { NativeContextDriver } from '../project/typescript/typescript-context.js';

export class NativeBuildExample {
  private readonly metadata = new Map<string, object>();
  private observation: (files: readonly ProjectFile[]) => readonly ProjectFile[] = files => files;
  private readonly build: BuildContext;
  private reads = 0;
  constructor(private readonly project: NativeContextDriver) {
    const context = { root: project.ordinary.root, readSnapshot: async () => {
      const read = ++this.reads, snapshot = await project.ordinary.readSnapshot();
      const files = snapshot.files.map(file => ({ ...file, ...this.metadata.get(file.path) }));
      return { ...snapshot, files: read === 2 || read === 3 ? this.observation(files) : files };
    } };
    this.build = new BuildContext(context, { manifest: project.path('expec.json'), text: '{}', captures: [], problems: [], syntax: [], deferred: [] },
      [{ id: 'typescript', options: {} }]);
  }
  nativeObservation(observation: (files: readonly ProjectFile[]) => readonly ProjectFile[]): void { this.observation = observation; }
  fileMetadata(path: string, metadata: object): void { this.metadata.set(path, metadata); }
  collect(): Promise<ProjectSnapshot> { return this.build.readSnapshot(); }
  dispose(): Promise<void> { return this.project.dispose(); }
}

export async function createNativeBuild(files: Record<string, string>): Promise<NativeBuildExample> {
  const project = new NativeContextDriver();
  try {
    await project.file('expec.json', '{}');
    for (const [path, text] of Object.entries(files)) await project.file(path, text);
    await project.package('tiny-types', { types: 'index.d.ts' }, { 'index.d.ts': 'export interface Value { n: number }' });
    await project.connect();
    return new NativeBuildExample(project);
  } catch (error) { await project.dispose(); throw error; }
}

export function replaceFile(files: readonly ProjectFile[], path: string, change: Partial<ProjectFile> & Record<string, unknown>): readonly ProjectFile[] {
  if (!files.some(file => file.path === path)) throw Error('Missing comparison fixture file: ' + path);
  return files.map(file => file.path === path ? { ...file, ...change } : file);
}
export function swapFiles(files: readonly ProjectFile[], first: string, second: string): readonly ProjectFile[] {
  const result = [...files], a = result.findIndex(file => file.path === first), b = result.findIndex(file => file.path === second);
  if (a < 0 || b < 0) throw Error('Missing ordered comparison fixture files.');
  [result[a], result[b]] = [result[b]!, result[a]!]; return result;
}
export function asUint8ArraySlices(files: readonly ProjectFile[]): readonly ProjectFile[] {
  return files.map(file => {
    const storage = new Uint8Array(file.bytes.byteLength + 11).fill(93); storage.set(file.bytes, 7);
    return { ...file, bytes: storage.subarray(7, 7 + file.bytes.byteLength) };
  });
}
export function expectNativeDisagreement(result: ProjectSnapshot): void {
  expect(result.complete).toBe(false);
  expect(result.problems).toContainEqual(expect.objectContaining({ code: 'stale-project', message: 'Native configurations observed different project bytes.' }));
}
export function fileText(result: ProjectSnapshot, path: string, native = false): string {
  const file = (native ? result.readOnlyFiles ?? [] : result.files).find(file => file.path === path);
  if (!file) throw Error('Missing captured comparison file: ' + path);
  return Buffer.from(file.bytes).toString('utf8');
}
export function observeEditableArrayBodyClones(editablePaths: readonly string[]) {
  const editable = new Set(editablePaths);
  const clone = globalThis.structuredClone, arrays: string[][] = []; let snapshots = 0;
  const observer = vi.spyOn(globalThis, 'structuredClone').mockImplementation(((value: unknown, options?: Parameters<typeof structuredClone>[1]) => {
    if (Array.isArray(value) && value.length && value.every(file => file && typeof file.path === 'string' && file.bytes instanceof Uint8Array)
      && value.some(file => editable.has(file.path))) arrays.push(value.map(file => file.path));
    if (value && typeof value === 'object' && 'root' in value && 'files' in value && Array.isArray(value.files)) snapshots++;
    return clone(value, options);
  }) as typeof structuredClone);
  return { fileArraysWithBodies: () => arrays, ownedSnapshotCopies: () => snapshots, restore: () => observer.mockRestore() };
}
