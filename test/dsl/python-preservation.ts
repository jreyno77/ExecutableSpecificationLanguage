import { expect } from 'vitest';
import { PythonPreservationDriver } from '../driver/python-preservation.js';

export class PythonEvolution {
  private static readonly examples: PythonEvolution[] = [];
  private constructor(readonly driver: PythonPreservationDriver) {}
  static async create(): Promise<PythonEvolution> { const p = new PythonEvolution(new PythonPreservationDriver()); this.examples.push(p); await p.driver.initialize(); await p.driver.installFixture(); return p; }
  static async dispose(): Promise<void> { for (const p of this.examples.splice(0)) await p.driver.dispose(); }
  source(text: string): void { this.driver.source(text); }
  async generate(): Promise<void> { await this.driver.generate(); this.expectApplied(); }
  async adoptStoreFile(file: string): Promise<void> { this.driver.associateStoreFile(file); await this.driver.generate({ adoptExisting: true }); this.expectApplied(); }
  change(text: string): void { this.driver.change(text); }
  renameCapability(from: string, to: string, text: string): void { this.driver.renameCapability(from, to, text); }
  retireCapability(name: string, text: string): void { this.driver.retireCapability(name, text); }
  file(path: string, text: string): Promise<void> { return this.driver.file(path, text); }
  async expectFileText(path: string, text: string): Promise<void> { expect(await this.driver.text(path)).toBe(text); }
  expectDefinitionFiles(files: string[]): void { expect([...new Set(this.driver.written.artifacts?.map(item => (item.locator.value as { file: string }).file))].sort()).toEqual(files); }
  update(): Promise<void> { return this.driver.update(); }
  implementSave(body: string): Promise<void> { return this.driver.implementSave(body); }
  implementTitleDefault(value: string): Promise<void> { return this.driver.implementTitleDefault(value); }
  run(text: string): Promise<void> { return this.driver.run(text); }
  expectApplied(): void { expect(this.driver.written.problems, JSON.stringify({ problems: this.driver.written.problems, capture: this.driver.captureProblems.slice(0, 5), status: this.driver.written.receipt?.status })).toEqual([]); expect(this.driver.written.receipt?.status).toBe('applied'); }
  expectRefused(code: string): void { expect(this.driver.written.problems.map(problem => problem.code)).toContain(code); expect(this.driver.written.receipt).toBeUndefined(); }
  async expectSaveImplementationKept(body: string): Promise<void> { expect(await this.driver.text('src/store/contracts.py')).toContain(body); }
  async expectSaveParameter(declaration: string): Promise<void> { expect(await this.driver.text('src/store/contracts.py')).toContain('def save(self, ' + declaration + ') -> None:'); }
  expectOutput(text: string): void { expect(this.driver.runtime.code, this.driver.runtime.text).toBe(0); expect(this.driver.runtime.text.trim().split(/\r?\n/)).toEqual(text.split('\n')); }
}
