import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { expect, onTestFinished } from 'vitest';
import type { ProjectSnapshot } from '../../../../src/index.js';
import { ConnectionDriver } from '../../../driver/project/connection/project-connection.js';

export class ConnectionExamples {
  private readonly driver = new ConnectionDriver();
  constructor() { onTestFinished(() => this.driver.dispose()); }
  files(files: Record<string, string>): Promise<void> { return this.driver.files(files); }
  directory(path: string): Promise<void> { return this.driver.mkdir(path); }
  fileBytes(path: string, bytes: number[]): Promise<void> { return this.driver.file(path, Uint8Array.from(bytes)); }
  editFile(path: string, content: string): Promise<void> { return this.driver.file(path, content); }
  removeFile(path: string): Promise<void> { return this.driver.remove(path); }
  removeDirectory(path: string): Promise<void> { return this.driver.remove(path); }
  moveDirectory(from: string, to: string): Promise<void> { return this.driver.move(from, to); }
  directoryLink(path: string, target: string): Promise<void> { return this.driver.directoryLink(path, target); }
  retargetDirectoryLink(path: string, target: string): Promise<void> { return this.driver.retargetDirectoryLink(path, target); }
  manifest(path: string, contents: unknown, options?: { sourceId: string }): void { this.driver.manifest(path, contents, options?.sourceId); }
  connectedManifest(root: string): void {
    this.manifest('expec.json', { formatVersion: 1, version: '0.2.0', project: { root }, build: { entries: ['store.expec'] } });
  }
  excludeNames(names: string[]): void { this.driver.excludeNames(names); }
  connect(): Promise<void> { return this.driver.connect(); }
  readSnapshot(): Promise<void> { return this.driver.readSnapshot(); }
  preventRead(path: string): Promise<void> { return this.driver.preventRead(path); }
  allowRead(path: string): Promise<void> { return this.driver.allowRead(path); }
  rememberSnapshot(label: string): void { this.driver.remember(label); }
  replaceCapturedBytes(path: string, bytes: number[]): void { this.file(path).bytes.set(bytes); }
  expectConnectedTo(path: string): void {
    expect(this.driver.connection).toMatchObject({ value: { status: 'connected' }, problems: [], deferred: [] });
    expect(this.driver.current.root.path).toBe(this.driver.path(path));
  }
  expectUnconnected(reason: string, root?: string): void {
    expect(this.driver.connection).toEqual({ value: { status: 'unconnected', reason, ...(root ? { root: this.driver.path(root) } : {}) }, problems: [], deferred: [] });
  }
  expectNoSuggestedRoot(): void { expect(this.driver.connection.value).not.toHaveProperty('root'); }
  expectNoConnectionValue(): void { expect(this.driver.connection.value).toBeUndefined(); expect(this.driver.connection.deferred).toEqual([]); }
  expectConnectionProblem(code: string, path: string[]): void {
    expect(this.driver.connection.problems).toContainEqual(expect.objectContaining({ code, at: { kind: 'dependency', path: ['manifest', this.driver.configuration.sourceId, ...path] } }));
  }
  expectAuthoredRoot(root: string): void { expect(this.driver.configuration.project?.root).toBe(root); }
  expectCompleteSnapshot(): void { expect(this.driver.current.problems).toEqual([]); expect(this.driver.current.complete).toBe(true); }
  expectIncompleteSnapshot(): void { expect(this.driver.current.complete).toBe(false); expect(this.driver.current.problems.length).toBeGreaterThan(0); }
  expectFile(path: string, text: string): void { expect(Buffer.from(this.file(path).bytes).toString('utf8')).toBe(text); }
  expectBytes(path: string, bytes: number[]): void { expect([...this.file(path).bytes]).toEqual(bytes); }
  expectFilePaths(paths: string[]): void { expect(this.driver.current.files.map(file => file.path)).toEqual(paths); }
  expectExcludedPaths(paths: string[]): void { expect(this.driver.current.excluded).toEqual(paths); }
  expectExcludeNames(names: string[]): void { expect(this.driver.current.excludeNames).toEqual(names); }
  expectSnapshotProblem(code: string, path: string): void {
    expect(this.driver.current.problems).toContainEqual(expect.objectContaining({ code,
      at: { kind: 'dependency', path: ['project', this.driver.current.root.path, ...(path ? path.split('/') : [])] } }));
  }
  expectVersionDescribesBytes(path: string, bytes: number[]): void {
    expect(this.file(path).version).toBe(createHash('sha256').update(Uint8Array.from(bytes)).digest('hex'));
  }
  expectChangedFileVersion(path: string, label: string): void { expect(this.file(path).version).not.toBe(this.file(path, this.remembered(label)).version); }
  expectSameRootIdentity(label: string): void { expect(this.driver.current.root.identity).toBe(this.remembered(label).root.identity); }
  expectDifferentRootIdentity(label: string): void { expect(this.driver.current.root.identity).not.toBe(this.remembered(label).root.identity); }
  expectRememberedFile(label: string, path: string, text: string): void { expect(Buffer.from(this.file(path, this.remembered(label)).bytes).toString('utf8')).toBe(text); }
  expectRememberedExcludeNames(label: string, names: string[]): void { expect(this.remembered(label).excludeNames).toEqual(names); }
  expectRememberedSnapshotUnchanged(label: string): void { expect(this.driver.facts(this.remembered(label))).toEqual(this.driver.remembered.get(label)!.facts); }
  async expectFilesystemUnchanged(): Promise<void> { expect(await this.driver.tree()).toEqual(this.driver.before); }
  async expectDiskFile(path: string, text: string): Promise<void> { expect(await readFile(this.driver.path(path), 'utf8')).toBe(text); }
  async expectMissingPath(path: string): Promise<void> { await expect(lstat(this.driver.path(path))).rejects.toMatchObject({ code: 'ENOENT' }); }
  private remembered(label: string): ProjectSnapshot { return this.driver.remembered.get(label)!.source; }
  private file(path: string, snapshot = this.driver.current) {
    const files = snapshot.files.filter(file => file.path === path);
    expect(files, `Expected one captured file ${path}`).toHaveLength(1);
    return files[0]!;
  }
}
