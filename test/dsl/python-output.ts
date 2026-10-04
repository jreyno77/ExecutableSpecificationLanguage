import { expect } from 'vitest';
import { PythonOutputDriver } from '../driver/python-output.js';

export class PythonDelivery {
  private static readonly examples: PythonDelivery[] = [];
  private constructor(readonly driver: PythonOutputDriver) {}
  static async create(): Promise<PythonDelivery> { const p = new PythonDelivery(new PythonOutputDriver()); this.examples.push(p); await p.driver.initialize(); return p; }
  static async dispose(): Promise<void> { for (const p of this.examples.splice(0)) await p.driver.dispose(); }
  source(text: string): void { this.driver.source(text); }
  async buildContracts(options?: Record<string, unknown>): Promise<void> { await this.driver.build(options); }
  async checkConsumer(text: string): Promise<void> { expect(this.driver.written.problems).toEqual([]); expect(this.driver.written.receipt?.status).toBe('applied'); await this.driver.checkConsumer(text); }
  expectNativeTypecheckPassed(): void { expect(this.driver.native.text).not.toContain('error:'); expect(this.driver.native.code, this.driver.native.text).toBe(0); }
  expectNativeTypecheckFailedAt(text: string): void { expect(this.driver.native.code).not.toBe(0); expect(this.driver.native.text).toContain(text); }
  runConsumer(): Promise<void> { return this.driver.runConsumer(); }
  expectRaised(type: string, message: string): void { expect(this.driver.runtime.code).not.toBe(0); expect(this.driver.runtime.text).toContain(type); expect(this.driver.runtime.text).toContain(message); }
  expectOutput(text: string): void { expect(this.driver.runtime.code, this.driver.runtime.text).toBe(0); expect(this.driver.runtime.text.trim()).toBe(text); }
  expectProblemAt(code: string, text: string): void {
    expect(this.driver.written.problems.some(problem => problem.code === code && problem.at.kind === 'source' && problem.at.range.sourceId === 'main.expec'), JSON.stringify(this.driver.written.problems)).toBe(true);
    expect(this.driver.written.problems.some(problem => problem.message.includes(text))).toBe(true);
  }
  expectNoWrites(): void { expect(this.driver.written.receipt).toBeUndefined(); expect(this.driver.written.artifacts).toBeUndefined(); }
}
