import { expect } from 'vitest';
import { PythonAcceptanceDriver } from '../driver/python-acceptance.js';

export class PythonAcceptance {
  private static readonly examples: PythonAcceptance[] = [];
  private constructor(private readonly driver: PythonAcceptanceDriver) {}
  static async create(): Promise<PythonAcceptance> {
    const value = new PythonAcceptance(new PythonAcceptanceDriver()); this.examples.push(value); await value.driver.initializeAcceptance(); return value;
  }
  static async dispose(): Promise<void> { for (const value of this.examples.splice(0)) await value.driver.dispose(); }
  aShopperCanAddAnAvailableBook(title: string, quantity: number): void { this.driver.authorShopping(title, quantity); }
  aBookRetainsItsDeclaredData(): void { this.driver.authorBook(); }
  numbersRetainTheirDeclaredMeaning(): void { this.driver.authorNumberComparison(); }
  observeTextAsNumbers(): Promise<void> { return this.driver.observeTextAsNumbers(); }
  expectInvalidNumber(): void {
    expect(this.driver.runtime.code, this.driver.runtime.text).not.toBe(0);
    expect(this.driver.runtime.text).toContain('Expected a finite Number'); expect(this.driver.runtime.text).toContain('1 failed');
  }
  generateBookContract(): Promise<void> { return this.driver.generateBookContract(); }
  observeBook(expression: string): Promise<void> { return this.driver.observeBook(expression); }
  expectInvalidBook(): void {
    expect(this.driver.runtime.code, this.driver.runtime.text).not.toBe(0);
    expect(this.driver.runtime.text).toContain('AssertionError'); expect(this.driver.runtime.text).toContain('1 failed');
  }
  async generateTests(): Promise<void> {
    await this.driver.generate(); expect(this.driver.written.problems, JSON.stringify(this.driver.written.problems)).toEqual([]);
    expect(this.driver.written.receipt?.status).toBe('applied');
  }
  implementBasket(copies: number): Promise<void> { return this.driver.implementBasket(copies); }
  runTests(): Promise<void> { return this.driver.runGeneratedTests(); }
  expectPassed(count: number): void { expect(this.driver.runtime.code, this.driver.runtime.text).toBe(0); expect(this.driver.runtime.text).toContain(count + ' passed'); }
  expectWrongQuantity(actual: number, expected: number): void {
    expect(this.driver.runtime.code, this.driver.runtime.text).not.toBe(0);
    expect(this.driver.runtime.text).toContain('Expected ' + expected + ', actual ' + actual);
    expect(this.driver.runtime.text).toContain('1 failed');
  }
  expectUnimplemented(operation: string): void {
    expect(this.driver.runtime.code).not.toBe(0); expect(this.driver.runtime.text).toContain('NotImplementedError'); expect(this.driver.runtime.text).toContain(operation);
  }
  expectReadableSteps(steps: string[]): void {
    for (const step of steps) expect(this.driver.scenario).toContain(step);
    expect(this.driver.scenario).not.toMatch(/sys\.path|http|\.basket/);
  }
}
