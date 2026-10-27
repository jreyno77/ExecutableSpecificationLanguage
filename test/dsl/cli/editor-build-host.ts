import { expect } from 'vitest';
import { EditorBuildHostDriver } from '../../driver/cli/editor-build-host.js';

export class EditorBuildHost {
  constructor(readonly driver: EditorBuildHostDriver) {}
  static async create(): Promise<EditorBuildHost> { return new EditorBuildHost(await EditorBuildHostDriver.create()); }
  selectTypeScriptOutput(): void { this.driver.selectTypeScriptOutput(); }
  projectWithEntries(...sources: string[]): Promise<void> { return this.driver.projectWithEntries(...sources); }
  buildWithHost(): Promise<void> { return this.driver.buildWithHost(); }
  cancelBeforeBuild(): void { this.driver.cancelBuild(); }
  cancelBuild(): void { this.driver.cancelBuild(); }
  holdRealOutputPlanning(): void { this.driver.holdRealOutputPlanning(); }
  awaitHeldPlan(): Promise<void> { return this.driver.awaitHeldPlan(); }
  releasePlan(): void { this.driver.releasePlan(); }
  refuseCurrentWrites(path: string, message: string): void { this.driver.refuseCurrentWrites(path, message); }
  holdWritePermission(): void { this.driver.holdWritePermission(); }
  awaitHeldPermission(): Promise<void> { return this.driver.awaitHeldPermission(); }
  releasePermission(): void { this.driver.releasePermission(); }
  rejectPermission(message: string): Promise<void> { return this.driver.rejectPermission(message); }
  drainOwnedWork(): Promise<void> { return this.driver.drainOwnedWork(); }
  keepImplementation(path: string, body: string): Promise<void> { return this.driver.keepImplementation(path, body); }
  replaceAuthored(text: string): Promise<void> { return this.driver.replaceAuthored(text); }
  throwOnResult(message: string): void { this.driver.throwOnResult(message); }
  throwOnPermission(message: string): void { this.driver.throwOnPermission(message); }
  invalidWriteCallback(): void { this.driver.invalidWriteCallback(); }
  returnInvalidPermission(value: unknown): void { this.driver.returnInvalidPermission(value); }
  replaceResultSink(): void { this.driver.replaceResultSink(); }
  expectExitCode(code: number): void { expect(this.driver.exitCode).toBe(code); }
  expectReportedCommand(command: string, status: string): void { expect(this.driver.report()).toMatchObject({ format: 1, command, status }); }
  async expectGeneratedDeclaration(name: string): Promise<void> {
    expect(await this.driver.fileText('src/' + name + '.ts')).toBe('export type ' + name + ' = {};\n');
  }
  expectProcessOutputUntouched(): void { expect(this.driver.processOutput).toEqual([]); }
  expectNoInputAcquisitions(): void { expect(this.driver.inputAcquisitions).toEqual([]); }
  expectNoOutputProviderInvocations(): void { expect(this.driver.providerInvocations).toBe(0); }
  expectWritePermissionWasQueried(): void { expect(this.driver.permissionInvocations).toBeGreaterThan(0); }
  expectReportedProblem(code: string, path: string): void {
    expect(this.driver.report().problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ code, at: { kind: 'dependency', path: ['project', path] } }),
    ]));
  }
  expectVisibleRefusal(): void {
    const report = this.driver.report();
    expect(report.exitCode).not.toBe(0);
    expect(report.problems.length).toBeGreaterThan(0);
  }
  async expectCompleteProjectTreeUnchanged(): Promise<void> { expect(await this.driver.tree()).toEqual(this.driver.before); }
  async expectFileContains(path: string, text: string): Promise<void> { expect(await this.driver.fileText(path)).toContain(text); }
  async expectBuildRejects(message: string): Promise<void> { await expect(this.driver.buildWithHost()).rejects.toThrow(message); }
  expectResultSinkInvocations(count: number): void { expect(this.driver.resultSinkInvocations).toBe(count); }
  expectOwnedListenerCount(count: number): void { expect(this.driver.ownedListenerCount()).toBe(count); }
  expectNoLateOutput(previous: string): void { expect(this.driver.stdout).toBe(previous); }
  receivedOutput(): string { return this.driver.stdout; }
}

