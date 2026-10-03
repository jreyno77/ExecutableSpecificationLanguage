import { expect } from 'vitest';
import { KotlinDeliveryDriver } from '../driver/kotlin-delivery.js';

export class KotlinDelivery {
  private static readonly instances: KotlinDelivery[] = [];
  private constructor(readonly driver: KotlinDeliveryDriver) {}
  static async create(): Promise<KotlinDelivery> {
    const project = new KotlinDelivery(new KotlinDeliveryDriver()); this.instances.push(project); await project.driver.initialize(); await project.driver.configureNative(); return project;
  }
  static async dispose(): Promise<void> { for (const project of this.instances.splice(0)) await project.driver.dispose(); }
  source(text: string): void { this.driver.source(text); }
  change(text: string, renames: Readonly<Record<string, string>> = {}): void { this.driver.source(text, renames); }
  async updateContracts(): Promise<void> {
    await this.driver.update(); expect(this.driver.written.problems).toEqual([]); expect(this.driver.written.receipt?.status).toBe('applied');
  }
  expectFileContains(path: string, text: string): void { expect(this.driver.files.get(path)).toContain(text); }
  expectFileText(path: string, text: string): void { expect(this.driver.files.get(path)).toBe(text); }
  expectMissingFile(path: string): void { expect(this.driver.files.has(path)).toBe(false); }
  file(path: string, text: string): Promise<void> { return this.driver.file(path, text); }
  search(name: string): Promise<void> { return this.driver.search(name); }
  expectIncomingCall(path: string, start: number, end: number): void {
    expect(this.driver.searchResult.incoming.coverage.complete, JSON.stringify(this.driver.searchResult.problems)).toBe(true);
    expect(this.driver.searchResult.incoming.uses).toEqual(expect.arrayContaining([expect.objectContaining({
      target: expect.objectContaining({ kind: 'project' }),
      at: expect.objectContaining({ format: 'kotlin-site-1', value: expect.objectContaining({ file: path, start, end }) }),
    })]));
  }
  expectSearchScope(paths: string[]): void {
    expect(this.driver.searchResult.incoming.coverage.complete, JSON.stringify(this.driver.searchResult.problems)).toBe(true);
    expect(this.driver.searchResult.incoming.coverage.scope.map(at => (at.value as { file: string }).file).sort()).toEqual([...paths].sort());
  }
  async buildContracts(): Promise<void> {
    await this.driver.build(); expect(this.driver.written.problems).toEqual([]); expect(this.driver.written.receipt?.status).toBe('applied');
  }
  compileConsumer(text: string): Promise<void> { return this.driver.compile(text); }
  runConsumer(text: string): Promise<void> { return this.driver.execute(text); }
  expectNativeCompilationPassed(): void { expect(this.driver.compiled, this.driver.compiled.stderr).toMatchObject({ code: 0 }); }
  expectNativeCompilationFailedAt(text: string): void { expect(this.driver.compiled.code).not.toBe(0); expect(this.driver.compiled.stderr).toContain(text); }
  expectStdout(text: string): void { this.expectNativeCompilationPassed(); expect(this.driver.execution.code, this.driver.execution.stderr).toBe(0); expect(this.driver.execution.stdout.trim()).toBe(text); }
  expectUnimplemented(name: string): void { this.expectNativeCompilationPassed(); expect(this.driver.execution.code).not.toBe(0); expect(this.driver.execution.stderr).toContain('NotImplementedError'); expect(this.driver.execution.stderr).toContain(name); }
}
