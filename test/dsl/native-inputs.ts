import { promises as fs } from 'node:fs';
import { expect, onTestFinished } from 'vitest';
import type { ProjectSnapshot, WriteResult } from '../../src/index.js';
import { NativeInputDriver } from '../driver/native-inputs.js';

export class NativeInputProject {
  private constructor(private readonly driver: NativeInputDriver) { onTestFinished(() => driver.project.dispose()); }
  static async withoutNativeInputs(): Promise<NativeInputProject> {
    const driver = new NativeInputDriver(), project = new NativeInputProject(driver);
    await driver.initialize(); driver.mode = 'plain'; return project;
  }
  static async withLibrary(name: string, text: string): Promise<NativeInputProject> {
    const project = await this.withoutNativeInputs(); project.driver.mode = 'native';
    await project.driver.addLibrary(name, text); return project;
  }
  static async withIncludedLibrary(name: string, text: string): Promise<NativeInputProject> {
    const project = await this.withoutNativeInputs(); project.driver.mode = 'native';
    await project.driver.addLibrary(name, text, true); return project;
  }
  planWrite(path: string, text: string): Promise<void> { return this.planWrites({ [path]: text }); }
  planWrites(files: Record<string, string>): Promise<void> { return this.driver.plan(files); }
  writeProjectFile(path: string, text: string): Promise<void> { return this.driver.project.edit(path, text); }
  async planMove(from: string, to: string): Promise<void> {
    await this.driver.plan({}); this.driver.project.changes = [{ kind: 'move', from, to }];
  }
  replaceNativeAfterMoveCopy(destination: string, name: string, text: string): void {
    this.driver.replaceLibraryAfterDestinationWrite(destination, name, text);
  }
  expectMoveState(state: WriteResult['outcomes'][number]['state']): void {
    expect(this.driver.project.result.outcomes).toMatchObject([{ change: { kind: 'move' }, state }]);
  }
  applyPlan(): Promise<void> { return this.driver.project.apply(); }
  replaceNativeFile(name: string, text: string): Promise<void> { return this.driver.replaceLibrary(name, text); }
  addNativeFile(name: string, text: string): Promise<void> { return this.driver.addLibrary(name, text); }
  beforeGuard(number: number, action: () => Promise<void>): void { this.driver.hooks.set(number, action); }
  usePlainProjectContext(): void { this.driver.mode = 'plain'; }
  returnEmptyNativeEvidence(): void { this.driver.mode = 'empty'; }
  reverseNativeEvidenceOrder(): void { this.driver.reversed = true; }
  returnMalformedNativeEvidence(): void { this.driver.mode = 'malformed'; }
  replacePlanEvidence(nativeInputs: NonNullable<ProjectSnapshot['nativeInputs']>): void { this.driver.project.snapshot = { ...this.driver.project.snapshot, nativeInputs }; }
  registerOutputThatDropsNativeEvidence(): void { this.driver.registerOutput(true); }
  registerCurrentFileOutput(): void { this.driver.registerOutput(); }
  createThroughOutput(text: string): Promise<void> { return this.driver.create(text); }
  readThroughOutput(): Promise<void> { return this.driver.observeOutput(() => this.driver.output.read('save')); }
  searchThroughOutput(): Promise<void> { return this.driver.observeOutput(() => this.driver.output.search('save')); }
  expectOutputContractError(text: string): void {
    expect(this.driver.error).toBeInstanceOf(TypeError); expect((this.driver.error as Error).message).toContain(text);
  }
  expectStatus(status: WriteResult['status']): void { expect(this.driver.project.result.status).toBe(status); }
  expectStopped(code: string): void {
    this.expectStatus('stopped'); expect(this.driver.project.result.problems).toContainEqual(expect.objectContaining({ code }));
  }
  expectChangeState(path: string, state: WriteResult['outcomes'][number]['state']): void {
    expect(this.driver.project.result.outcomes.find(item => item.change.kind === 'write' && item.change.path === path)?.state).toBe(state);
  }
  async expectFile(path: string, text: string): Promise<void> { expect(await fs.readFile(this.driver.project.path(path), 'utf8')).toBe(text); }
  async expectFileAbsent(path: string): Promise<void> { await expect(fs.lstat(this.driver.project.path(path))).rejects.toMatchObject({ code: 'ENOENT' }); }
  async expectNativeFile(name: string, text: string): Promise<void> { expect(await fs.readFile(this.driver.libraries.get(name)!, 'utf8')).toBe(text); }
  async expectNoFileEffects(): Promise<void> { expect((await this.driver.ordinary.readSnapshot()).files).toEqual([]); }
}
