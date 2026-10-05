import { expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { PythonOutputDriver } from '../driver/python-output.js';
import type { ProjectSnapshot } from '../../src/index.js';

export type ContractObligation = readonly [code: string, subject: string, text: string, source: string];
export function expectContractObligations(driver: PythonOutputDriver, phase: 'plan' | 'write', expected: readonly ContractObligation[]): void {
  const report = phase === 'plan' ? driver.planned.value : driver.written;
  expect(phase === 'plan' ? driver.planned.problems : driver.written.problems).toEqual([]);
  expect(report).toBeDefined();
  const obligations = report!.obligations ?? [];
  expect.soft(obligations).toHaveLength(expected.length);
  for (const [code, subject, text, source] of expected) {
    const position = driver.sourceText.indexOf(source); expect(position).toBeGreaterThanOrEqual(0);
    const offset = Array.from(driver.sourceText.slice(0, position)).length;
    expect.soft(obligations.filter(item => item.code === code && item.message.includes(subject) && item.message.includes(text)
      && item.at.kind === 'source' && item.at.range.sourceId === 'main.expec' && item.at.range.start.offset === offset)).toHaveLength(1);
  }
}
export async function expectCallableDocumentation(driver: PythonOutputDriver, name: string, clauses: string[]): Promise<void> {
  const source = await fs.readFile(join(driver.root, 'src/store/contracts.py'), 'utf8');
  expect(source.split('def ' + name + '(')).toHaveLength(2);
  for (const clause of clauses) expect.soft(source).toContain(clause);
}

export class PythonDelivery {
  private before?: ProjectSnapshot;
  private static readonly examples: PythonDelivery[] = [];
  private constructor(readonly driver: PythonOutputDriver) {}
  static async create(): Promise<PythonDelivery> { const p = new PythonDelivery(new PythonOutputDriver()); this.examples.push(p); await p.driver.initialize(); return p; }
  static async dispose(): Promise<void> { for (const p of this.examples.splice(0)) await p.driver.dispose(); }
  source(text: string): void { this.driver.source(text); }
  mapNames(names: Record<string, string>): void { this.driver.mapNames(names); }
  async rememberProject(): Promise<void> { this.before = await this.driver.captureProject(); }
  async expectProjectUnchanged(): Promise<void> {
    expect(this.before).toBeDefined(); expect((await this.driver.captureProject()).files).toEqual(this.before!.files);
  }
  expectNameConflict(phase: 'plan' | 'write', source: string): void {
    if (phase === 'plan') expect(this.driver.planned.value).toBeUndefined(); else this.expectNoWrites();
    const position = this.driver.sourceText.indexOf(source); expect(position).toBeGreaterThanOrEqual(0);
    const problems = phase === 'plan' ? this.driver.planned.problems : this.driver.written.problems;
    expect(problems.some(problem => problem.code === 'native-name-conflict' && problem.at.kind === 'source'
      && problem.at.range.sourceId === 'main.expec' && problem.at.range.start.offset === Array.from(this.driver.sourceText.slice(0, position)).length), JSON.stringify(problems)).toBe(true);
  }
  planContracts(): Promise<void> { return this.driver.planContracts(); }
  expectContractObligations(phase: 'plan' | 'write', expected: readonly ContractObligation[]): void { expectContractObligations(this.driver, phase, expected); }
  expectCallableDocumentation(name: string, clauses: string[]): Promise<void> { return expectCallableDocumentation(this.driver, name, clauses); }
  async buildContracts(options?: Record<string, unknown>): Promise<void> { await this.driver.build(options); }
  expectDefaultObligation(name: string, value: string): void { this.expectObligation('default-verification-required', name + ': ' + value); }
  expectFailureObligation(name: string, failure: string): void {
    expect(this.driver.written.obligations?.some(problem => problem.code === 'failure-verification-required'
      && problem.message.includes(name) && problem.message.includes(failure)
      && problem.at.kind === 'source' && problem.at.range.sourceId === 'main.expec'), JSON.stringify(this.driver.written.obligations)).toBe(true);
  }
  expectResultObligation(name: string): void { this.expectObligation('unspecified-result', name); }
  private expectObligation(code: string, name: string): void {
    const obligations = this.driver.written.obligations ?? [];
    expect(obligations.some(problem => problem.code === code && problem.message.includes(name)
      && problem.at.kind === 'source' && problem.at.range.sourceId === 'main.expec'), JSON.stringify(obligations)).toBe(true);
  }
  async checkConsumer(text: string): Promise<void> { expect(this.driver.written.problems).toEqual([]); expect(this.driver.written.receipt?.status).toBe('applied'); await this.driver.checkConsumer(text); }
  expectNativeTypecheckPassed(): void { expect(this.driver.native.text).not.toContain('error:'); expect(this.driver.native.code, this.driver.native.text).toBe(0); }
  expectNativeTypecheckFailedAt(text: string): void { expect(this.driver.native.code).not.toBe(0); expect(this.driver.native.text).toContain(text); }
  runConsumer(): Promise<void> { return this.driver.runConsumer(); }
  async run(text: string): Promise<void> { await this.driver.file('consumer.py', text); await this.driver.runConsumer(); }
  expectRaised(type: string, message: string): void { expect(this.driver.runtime.code).not.toBe(0); expect(this.driver.runtime.text).toContain(type); expect(this.driver.runtime.text).toContain(message); }
  expectOutput(text: string): void { expect(this.driver.runtime.code, this.driver.runtime.text).toBe(0); expect(this.driver.runtime.text.trim().split(/\r?\n/)).toEqual(text.split('\n')); }
  expectProblemAt(code: string, text: string): void {
    expect(this.driver.written.problems.some(problem => problem.code === code && problem.at.kind === 'source' && problem.at.range.sourceId === 'main.expec'), JSON.stringify(this.driver.written.problems)).toBe(true);
    expect(this.driver.written.problems.some(problem => problem.message.includes(text))).toBe(true);
  }
  expectNoWrites(): void { expect(this.driver.written.receipt).toBeUndefined(); expect(this.driver.written.artifacts).toBeUndefined(); }
}
