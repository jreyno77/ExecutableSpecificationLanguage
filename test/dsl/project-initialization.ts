import { promises as fs } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { expect, onTestFinished, vi } from 'vitest';
import { ConfigurationReader, ProjectConnector, type Configuration } from '../../src/index.js';
import { InitializationDriver } from '../driver/project-initialization.js';

export class InitializationExamples {
  private constructor(private readonly driver: InitializationDriver) { onTestFinished(() => driver.dispose()); }
  static async withManifest(input?: Record<string, unknown>): Promise<InitializationExamples> {
    const driver = new InitializationDriver(); await driver.initialize(input); return new InitializationExamples(driver);
  }
  static withPackages(packages: Configuration['packages']): Promise<InitializationExamples> {
    return this.withManifest({ formatVersion: 1, version: '0.1.0', build: { entries: ['store.expec'] }, packages });
  }
  expectProposedPackages(packages: Configuration['packages']): void { expect(this.driver.prepared.value?.configuration.packages).toEqual(packages); }
  static withUnconnectedManifest(): Promise<InitializationExamples> { return this.withManifest(); }
  prepare(root: string, target: string): Promise<void> { return this.driver.prepare(root, target); }
  apply(accepted: boolean): Promise<void> { return this.driver.apply(accepted); }
  async applyWithAlreadyAbortedSignal(accepted: boolean): Promise<void> { const controller = new AbortController(); controller.abort(); await this.driver.apply(accepted, controller.signal); }
  file(path: string, text: string): Promise<void> { return this.driver.file(path, text); }
  destinationFiles(root: string, files: Record<string, string>): Promise<void> { return this.driver.destinationFiles(root, files); }
  async destinationDirectory(root: string): Promise<void> { await fs.mkdir(this.driver.relativeToManifest(root), { recursive: true }); }
  parentDirectory(root: string): Promise<void> { return this.destinationDirectory(root); }
  emptyDestination(root: string): Promise<void> { this.driver.destination = this.driver.relativeToManifest(root); return this.destinationDirectory(root); }
  async destinationIsFile(root: string, text: string): Promise<void> { await this.driver.file(relative(this.driver.directory, this.driver.relativeToManifest(root)), text); }
  async linkDestination(root: string, target: string): Promise<void> {
    await this.destinationDirectory(target); this.driver.remembered.set('linkTarget', this.driver.relativeToManifest(target));
    await fs.symlink(this.driver.relativeToManifest(target), this.driver.relativeToManifest(root), process.platform === 'win32' ? 'junction' : 'dir');
  }
  replaceParentWithEmptyDirectory(root: string): Promise<void> { return this.driver.replaceDirectory(root); }
  replaceDestinationWithEmptyDirectory(): Promise<void> { return this.driver.replaceDirectory(this.driver.destination); }
  runFromUnrelatedDirectory(): void {
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(this.driver.path('unrelated-working-directory'));
    this.driver.restores.set('cwd', () => cwd.mockRestore());
  }
  async rememberDestinationIdentity(): Promise<void> { const info = await fs.lstat(this.driver.destination, { bigint: true }); this.driver.remembered.set('rootIdentity', [info.dev, info.ino]); }
  rememberSuccessfulConnection(): void { this.driver.remembered.set('connectedIdentity', this.driver.result!.value!.context.root.identity); }
  async reconnectReturnedConfiguration(): Promise<void> { this.driver.connection = await new ProjectConnector(this.driver.manifest).connect(this.driver.result!.value!.configuration); }
  async connectOriginalOnDiskManifest(): Promise<void> {
    const configuration = new ConfigurationReader([]).read({ sourceId: 'settings', text: await fs.readFile(this.driver.manifest, 'utf8') });
    expect(configuration.problems).toEqual([]); this.driver.connection = await new ProjectConnector(this.driver.manifest).connect(configuration.value!);
  }
  failRootCreation(code: string): void { this.driver.failRootCreation(code); }
  restoreRootCreation(): void { this.driver.restores.get('mkdir')?.(); }
  failRealFileCreation(path: string, code: string): void { this.driver.failFileCreation(path, code); }
  restoreFileCreation(): void { this.driver.restores.get('open')?.(); }
  forbidProcessNetworkAndOutputExecution(): void { this.driver.forbidExecution(); }
  rememberDestinationBytes = async (): Promise<void> => { this.driver.remembered.set('files', await this.driver.files()); };
  mutateCallerConfigurationVersion(version: string): void { Object.assign(this.driver.configuration, { version }); }
  changePreviewBytes(path: string, text: string): void {
    const change = this.driver.prepared.value!.changes.find(change => change.kind === 'write' && change.path === path)!;
    Object.assign(change, { bytes: new TextEncoder().encode(text) });
  }
  async expectApplyTypeError(): Promise<void> { await expect(this.driver.apply(true)).rejects.toBeInstanceOf(TypeError); }
  expectStatus(status: string): void { expect(this.driver.result?.status).toBe(status); }
  expectNoConnection(): void { expect(this.driver.result?.value).toBeUndefined(); }
  expectNoWriterReceipt(): void { expect(this.driver.result?.write).toBeUndefined(); }
  expectNoCreatedRoot(): void { expect(this.driver.result?.createdRoot).toBeUndefined(); }
  expectCreatedRoot(root: string): void { expect(this.driver.result?.createdRoot).toBe(this.driver.relativeToManifest(root)); }
  expectNoPlan(): void { expect(this.driver.prepared.value).toBeUndefined(); }
  expectProblem(code: string): void { expect((this.driver.result ?? this.driver.prepared).problems.map(problem => problem.code)).toContain(code); }
  expectNoForbiddenExecution(): void { expect(this.driver.forbidden).toEqual([]); }
  expectWriterStatus(status: string): void { expect(this.driver.result?.write?.status).toBe(status); }
  expectWriterOutcome(path: string, state: string): void { expect(this.driver.result?.write?.outcomes.find(outcome => outcome.change.kind === 'write' && outcome.change.path === path)?.state).toBe(state); }
  expectPlannedRoot(root: string): void { expect(this.driver.prepared.value?.root).toBe(this.driver.relativeToManifest(root)); }
  expectPlannedPaths(paths: string[]): void { expect(this.driver.prepared.value?.changes.map(change => change.kind === 'move' ? change.to : change.path)).toEqual(paths); }
  private plannedText(path: string): string {
    const change = this.driver.prepared.value?.changes.find(change => change.kind === 'write' && change.path === path);
    expect(change?.kind).toBe('write'); return new TextDecoder().decode(change?.kind === 'write' ? change.bytes : undefined);
  }
  expectPlannedText(path: string, text: string): void { expect(this.plannedText(path)).toBe(text); }
  expectPlannedJson(path: string, value: unknown): void { expect(JSON.parse(this.plannedText(path))).toEqual(value); }
  expectPlannedJsonProperty(path: string, keys: string[], value: unknown): void { expect(at(JSON.parse(this.plannedText(path)), keys)).toEqual(value); }
  expectConnectedRoot(root: string): void { expect(this.driver.result?.value?.context.root.path).toBe(this.driver.relativeToManifest(root)); }
  expectReturnedProjectRoot(root: string): void { expect(this.driver.result?.value?.configuration.project?.root).toBe(root); }
  expectReturnedBuild(build: Configuration['build']): void { expect(this.driver.result?.value?.configuration.build).toEqual(build); }
  expectReturnedOutputs(outputs: Configuration['outputs']): void { expect(this.driver.result?.value?.configuration.outputs).toEqual(outputs); }
  expectOriginalLibraries(): void {
    expect(this.driver.result?.value?.configuration.libraries).toEqual(this.driver.configuration.libraries);
  }
  expectReturnedPackages(packages: Configuration['packages']): void { expect(this.driver.result?.value?.configuration.packages).toEqual(packages); }
  expectInputConfigurationUnchanged(): void { expect(this.driver.configuration).toEqual(this.driver.remembered.get('configuration')); }
  expectSameConnectedRootIdentity(): void {
    expect(this.driver.connection.value?.status).toBe('connected');
    if (this.driver.connection.value?.status === 'connected') expect(this.driver.connection.value.context.root.identity).toBe(this.driver.remembered.get('connectedIdentity'));
  }
  expectOriginalManifestStillUnconnected(reason: string): void { expect(this.driver.connection.value).toEqual({ status: 'unconnected', reason }); }
  async expectSameDestinationIdentity(): Promise<void> { const info = await fs.lstat(this.driver.destination, { bigint: true }); expect([info.dev, info.ino]).toEqual(this.driver.remembered.get('rootIdentity')); }
  async expectDestinationAbsent(): Promise<void> { await expect(fs.lstat(this.driver.destination)).rejects.toMatchObject({ code: 'ENOENT' }); }
  async expectPathAbsent(path: string): Promise<void> { await expect(fs.lstat(this.driver.relativeToManifest(path))).rejects.toMatchObject({ code: 'ENOENT' }); }
  async expectUnrelatedWorkingDirectoryUnchanged(): Promise<void> { await expect(fs.lstat(this.driver.path('unrelated-working-directory'))).rejects.toMatchObject({ code: 'ENOENT' }); }
  async expectManifestUnchanged(): Promise<void> { expect(await fs.readFile(this.driver.manifest, 'utf8')).toBe(this.driver.manifestText); }
  async expectFile(path: string, text: string): Promise<void> { expect(await fs.readFile(this.driver.target(path), 'utf8')).toBe(text); }
  async expectDestinationFile(text: string): Promise<void> { expect(await fs.readFile(this.driver.destination, 'utf8')).toBe(text); }
  async expectDestinationEmpty(): Promise<void> { expect(await fs.readdir(this.driver.destination)).toEqual([]); }
  async expectLinkedTargetEmpty(): Promise<void> { expect(await fs.readdir(this.driver.remembered.get('linkTarget') as string)).toEqual([]); }
  async expectDestinationFilesExactly(files: Record<string, string>): Promise<void> { expect(await this.driver.files()).toEqual(files); }
  async expectRememberedDestinationBytes(): Promise<void> { expect(await this.driver.files()).toEqual(this.driver.remembered.get('files')); }
  async expectExactStarterFiles(paths: string[]): Promise<void> { expect(Object.keys(await this.driver.files()).sort()).toEqual([...paths].sort()); }
  async expectOnlyDestinationDirectory(path: string): Promise<void> { expect(await fs.readdir(this.driver.destination)).toEqual([path]); expect(await fs.readdir(this.driver.target(path))).toEqual([]); }
  async expectAbsentFiles(paths: string[]): Promise<void> { for (const path of paths) await expect(fs.lstat(this.driver.target(path))).rejects.toMatchObject({ code: 'ENOENT' }); }
  async expectJsonProperty(path: string, keys: string[], value: unknown): Promise<void> { expect(at(JSON.parse(await fs.readFile(this.driver.target(path), 'utf8')), keys)).toEqual(value); }
  async expectNoCopiedSpecificationWorkspace(): Promise<void> { await this.expectAbsentFiles(['expec.json', 'spec', 'store.expec']); }
  async expectNoGeneratedTests(): Promise<void> { await this.expectAbsentFiles(['test', 'tests']); }
  generateTypeScript(text: string): Promise<void> { return this.driver.generateTypeScript(text); }
  runConsumer(text: string): Promise<void> { return this.driver.runConsumer(text); }
  expectThrownError(message: string): void { expect(this.driver.runtime?.code).toBe(1); expect(this.driver.runtime?.text).toContain('Error: ' + message); }
  supplyInstalledTypeScript(version: string): Promise<void> { return this.driver.supplyCompiler(version); }
  runNativeBuildScript(): Promise<void> { return this.driver.build(); }
  writeImplementation(path: string, text: string): Promise<void> { return this.driver.file(relative(this.driver.directory, this.driver.target(path)), text); }
  expectNativeBuildExit(code: number): void { expect(this.driver.native?.text, 'Native output').toBeDefined(); expect(this.driver.native?.code, this.driver.native?.text).toBe(code); }
  expectNativeBuildFailedAt(path: string, code: number): void { expect(this.driver.native?.code).not.toBe(0); expect(this.driver.native?.text).toContain(path); expect(this.driver.native?.text).toContain('TS' + code); }
}
function at(value: unknown, keys: string[]): unknown { return keys.reduce((current, key) => (current as Record<string, unknown> | undefined)?.[key], value); }
