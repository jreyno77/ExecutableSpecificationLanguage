import { expect } from 'vitest';
import { capabilitySummaries, namedTypeOccurrences, promiseDescriptions,
  type Capability, type TypeUse, type PromiseText } from '../../driver/model/inspection-collectors.js';
import { InspectionQueryDriver } from '../../driver/model/query-inspection.js';

function recorded<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

export class QueryInspection {
  private readonly driver = new InspectionQueryDriver();
  private capabilities: Capability[] | undefined;
  private typeUses: TypeUse[] | undefined;
  private typeIds: object[] = [];
  private promises: PromiseText[] | undefined;

  sourceIs(sourceId: string, text: string): void {
    this.capabilities = undefined;
    this.typeUses = undefined;
    this.typeIds = [];
    this.promises = undefined;
    this.driver.sourceIs(sourceId, text);
  }
  collectCapabilities(): void { this.capabilities = capabilitySummaries(this.driver.acceptedInspection()); }
  collectNamedTypes(): void {
    const occurrences = namedTypeOccurrences(this.driver.acceptedInspection());
    this.typeUses = occurrences.map(occurrence => occurrence.fact);
    this.typeIds = occurrences.map(occurrence => occurrence.id);
  }
  collectPromises(): void { this.promises = promiseDescriptions(this.driver.acceptedInspection()); }
  expectCapabilities(expected: Capability[]): void {
    expect(recorded(this.capabilities, 'Collect capabilities before checking them'), 'Capability declarations in authored order').toEqual(expected);
  }
  expectCapabilityNames(expected: string[]): void {
    expect(recorded(this.capabilities, 'Collect capabilities before checking them').map(item => item.name), 'Capability names in authored order').toEqual(expected);
  }
  expectNamedTypes(expected: TypeUse[]): void {
    expect(recorded(this.typeUses, 'Collect named types before checking them'), 'Named type occurrences in authored order').toEqual(expected);
  }
  expectTypeNames(expected: string[]): void {
    expect(recorded(this.typeUses, 'Collect named types before checking them').map(item => item.name), 'Named type spellings in authored order').toEqual(expected);
  }
  expectDistinctTypeOccurrences(count: number): void {
    recorded(this.typeUses, 'Collect named types before checking them');
    expect(this.typeIds).toHaveLength(count);
    expect(new Set(this.typeIds).size).toBe(count);
  }
  expectPromises(expected: PromiseText[]): void {
    expect(recorded(this.promises, 'Collect promises before checking them'), 'Authored prose promises').toEqual(expected);
  }
  expectSourceUnchanged(): void {
    const result = recorded(this.driver.result, 'Read source before checking it');
    expect(this.driver.source).toEqual(this.driver.originalSource);
    if (result.status === 'accepted') expect(result.document.source).toEqual(this.driver.originalSource);
  }
  expectRejectedWithDiagnostics(): void {
    const result = recorded(this.driver.result, 'Read source before checking it');
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('Expected syntax rejection');
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(this.driver.inspection).toBeUndefined();
  }
}
