import { expect } from 'vitest';
import { PythonNativeImportsDriver } from '../driver/python-native-imports.js';

export class PythonNativeImports {
  private static readonly projects: PythonNativeImports[] = [];
  private constructor(readonly driver: PythonNativeImportsDriver) {}
  static async create(): Promise<PythonNativeImports> {
    const project = new PythonNativeImports(new PythonNativeImportsDriver()); this.projects.push(project);
    await project.driver.initialize(); await project.driver.installFixture(); return project;
  }
  static async dispose(): Promise<void> { for (const project of this.projects.splice(0)) await project.driver.dispose(); }
  source(text: string): void { this.driver.source(text); }
  mapNativeImport(declaration: string, moduleName: string, name: string): void { this.driver.mapNativeImport(declaration, moduleName, name); }
  rememberProject(): Promise<void> { return this.driver.rememberProject(); }
  planContracts(): Promise<void> { return this.driver.planContracts(); }
  buildContracts(): Promise<void> { return this.driver.buildContracts(); }
  expectPlanRefused(code: string, file: string, nativeName?: string): void {
    expect(this.driver.planned.value === undefined).toBe(true);
    this.expectLocated(this.driver.planned.problems, code, file, nativeName);
  }
  expectWriteRefused(code: string, file: string, nativeName?: string): void {
    expect(this.driver.written.receipt).toBeUndefined(); expect(this.driver.written.artifacts).toBeUndefined();
    this.expectLocated(this.driver.written.problems, code, file, nativeName);
  }
  private expectLocated(problems: typeof this.driver.written.problems, code: string, file: string, nativeName?: string): void {
    expect(problems.some(problem => problem.code === code && problem.at.kind === 'dependency' && problem.at.path.includes(file)
      && (!nativeName || problem.message.includes(nativeName))), JSON.stringify(problems)).toBe(true);
  }
  async expectProjectUnchanged(): Promise<void> {
    await this.driver.capture(); expect(this.driver.snapshot.complete, JSON.stringify(this.driver.snapshot.problems)).toBe(true);
    const files = (snapshot: typeof this.driver.snapshot) => snapshot.files.map(file => ({ path: file.path, bytes: Buffer.from(file.bytes) })).sort((a, b) => a.path.localeCompare(b.path));
    expect(files(this.driver.snapshot)).toEqual(files(this.driver.before));
  }
  expectPlanAccepted(): void { expect(this.driver.planned.problems).toEqual([]); expect(this.driver.planned.value).toBeDefined(); }
  expectApplied(): void { expect(this.driver.written.problems).toEqual([]); expect(this.driver.written.receipt?.status).toBe('applied'); }
  async checkConsumer(text: string): Promise<void> { await this.driver.checkCapturedConsumer(text); expect(this.driver.native.code, this.driver.native.text).toBe(0); }
  run(text: string): Promise<void> { return this.driver.run(text); }
  expectOutput(text: string): void { expect(this.driver.runtime.code, this.driver.runtime.text).toBe(0); expect(this.driver.runtime.text.trim()).toBe(text); }
}
