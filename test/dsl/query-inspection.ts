import { expect } from 'vitest';
import { QueryInspectionDriver } from '../driver/query-inspection.js';
import type { Capability, TypeUse, PromiseText } from '../driver/inspection-collectors.js';

export class QueryInspection {
  private readonly driver = new QueryInspectionDriver();

  sourceIs(sourceId: string, text: string): void { this.driver.sourceIs(sourceId, text); }
  collectCapabilities(): void { this.driver.collectCapabilities(); }
  collectNamedTypes(): void { this.driver.collectNamedTypes(); }
  collectPromises(): void { this.driver.collectPromises(); }

  expectCapabilities(expected: Capability[]): void {
    expect(this.driver.collectedCapabilities(), 'Capability declarations in authored order').toEqual(expected);
  }

  expectCapabilityNames(expected: string[]): void {
    expect(this.driver.collectedCapabilities().map(item => item.name), 'Capability names in authored order').toEqual(expected);
  }

  expectNamedTypes(expected: TypeUse[]): void {
    expect(this.driver.collectedTypes(), 'Named type occurrences in authored order').toEqual(expected);
  }

  expectTypeNames(expected: string[]): void {
    expect(this.driver.collectedTypes().map(item => item.name), 'Named type spellings in authored order').toEqual(expected);
  }

  expectDistinctTypeOccurrences(count: number): void {
    const ids = this.driver.collectedTypeIds();
    expect(ids).toHaveLength(count);
    expect(new Set(ids).size).toBe(count);
  }

  expectPromises(expected: PromiseText[]): void {
    expect(this.driver.collectedPromises(), 'Authored prose promises').toEqual(expected);
  }

  expectSourceUnchanged(): void {
    expect(this.driver.readResult(), 'Source read result after inspection').toEqual(this.driver.original);
  }

  expectRejectedWithDiagnostics(): void {
    const result = this.driver.readResult();
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('Expected syntax rejection');
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(this.driver.inspection).toBeUndefined();
    expect(result.diagnostics).toEqual(this.driver.original.status === 'rejected' ? this.driver.original.diagnostics : []);
  }
}
