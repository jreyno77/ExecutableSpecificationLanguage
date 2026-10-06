import { expect } from 'vitest';
import { PythonRuntimeValuesDriver } from '../../../driver/project/python/python-runtime-values.js';

export class PythonRuntimeValues {
  private static readonly cases: PythonRuntimeValues[] = [];
  private constructor(private readonly driver: PythonRuntimeValuesDriver) {}
  static async create(): Promise<PythonRuntimeValues> {
    const value = new PythonRuntimeValues(new PythonRuntimeValuesDriver()); this.cases.push(value);
    await value.driver.initializeAcceptance(); return value;
  }
  static async dispose(): Promise<void> { for (const value of this.cases.splice(0)) await value.driver.dispose(); }
  source(text: string): void { this.driver.source(text); }
  generateReceiptContract(): Promise<void> { return this.driver.generateBookContract(); }
  async generateTests(): Promise<void> {
    await this.driver.generate();
    expect(this.driver.written.problems, JSON.stringify(this.driver.written)).toEqual([]);
    expect(this.driver.written.receipt?.status).toBe('applied');
  }
  returnReceipt(copies: number): Promise<void> { return this.driver.receipt(copies); }
  observeNumber(expression: string): Promise<void> { return this.driver.number(expression); }
  proveConversionHookIsExecutable(nativeType?: string): Promise<void> { return this.driver.verifyConversionCanary(nativeType); }
  useIndependentBaskets(): Promise<void> { return this.driver.isolatedBaskets(); }
  run(): Promise<void> { return this.driver.run(); }
  expectPassed(count: number): void {
    expect(this.driver.runtime.code, this.driver.runtime.text).toBe(0);
    expect(this.driver.runtime.text).toContain(count + ' passed');
  }
  expectInvalidNumber(nativeType: string): void {
    expect(this.driver.runtime.code, this.driver.runtime.text).not.toBe(0);
    expect(this.driver.runtime.text).toMatch(/Expected (?:a|an exactly representable) finite Number/);
    expect(this.driver.runtime.text).toContain('1 failed');
    expect(this.driver.events).toContainEqual({ event: 'number-type', value: nativeType });
  }
  expectNoNativeOverflow(): void {
    expect(this.driver.runtime.text).toMatch(/^E\s+AssertionError: Expected an exactly representable finite Number/m);
    expect(this.driver.runtime.text).not.toMatch(/^E\s+OverflowError:/m);
  }
  expectNoConversionHooksCalled(): void {
    expect(this.driver.events.filter(item => item.event.endsWith('-hook'))).toEqual([]);
  }
  expectCapturedResult(receipt: { copies: number }): void {
    expect(this.driver.events.filter(item => item.event === 'returned')).toEqual([{ event: 'returned', value: receipt }]);
    expect(this.driver.events.filter(item => item.event === 'captured')).toEqual([{ event: 'captured', value: receipt }]);
  }
  expectBasketQuantity(title: string, quantity: number): void {
    expect(this.driver.events.filter(item => item.event === 'quantity')).toEqual([{ event: 'quantity', title, value: quantity }]);
  }
  expectDistinctLiveDrivers(count: number): void {
    const drivers = this.driver.events.filter(item => item.event === 'driver');
    expect(drivers).toHaveLength(count);
    expect(new Set(drivers.map(item => item.id)).size).toBe(count);
    expect(new Set(drivers.map(item => item.basket)).size).toBe(count);
    expect(drivers.at(-1)?.live).toEqual(drivers.map(item => item.id));
  }
  expectSecondStartingQuantity(title: string, quantity: number): void {
    const drivers = this.driver.events.filter(item => item.event === 'driver');
    expect(this.driver.events.filter(item => item.event === 'initial' && item.id === drivers[1]?.id))
      .toEqual([{ event: 'initial', id: drivers[1]!.id, title, value: quantity }]);
    expect(this.driver.events.filter(item => item.event === 'quantity'))
      .toEqual(drivers.map(item => ({ event: 'quantity', id: item.id, title, value: 1 })));
  }
}
