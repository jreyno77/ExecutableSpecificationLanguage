import { expect } from 'vitest';
import type { ReadResult } from '../../src/index.js';
import type { Capability, TypeUse, TypeOccurrence, PromiseText } from './inspection-collectors.js';

export interface InspectionObservations {
  read?: { result: ReadResult; before: ReadResult; inspectionCreated: boolean };
  capabilities?: Capability[];
  namedTypes?: TypeOccurrence[];
  promises?: PromiseText[];
}

function recorded<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

/** Assertions inspect recorded observations; they cannot query the inspected source. */
export class InspectionExpectations {
  constructor(private readonly observations: InspectionObservations) {}

  capabilities(expected: Capability[]): void {
    const actual = recorded(this.observations.capabilities, 'Collect capabilities before checking them');
    expect(actual, 'Capability declarations in authored order').toEqual(expected);
  }
  capabilityNames(expected: string[]): void {
    const actual = recorded(this.observations.capabilities, 'Collect capabilities before checking them');
    expect(actual.map(item => item.name), 'Capability names in authored order').toEqual(expected);
  }
  namedTypes(expected: TypeUse[]): void {
    const actual = recorded(this.observations.namedTypes, 'Collect named types before checking them');
    expect(actual.map(item => item.fact), 'Named type occurrences in authored order').toEqual(expected);
  }
  typeNames(expected: string[]): void {
    const actual = recorded(this.observations.namedTypes, 'Collect named types before checking them');
    expect(actual.map(item => item.fact.name), 'Named type spellings in authored order').toEqual(expected);
  }
  distinctTypeOccurrences(count: number): void {
    const actual = recorded(this.observations.namedTypes, 'Collect named types before checking them');
    expect(actual, 'Number of type occurrences').toHaveLength(count);
    expect(new Set(actual.map(item => JSON.stringify(item.id))).size, 'Distinct type occurrence identifiers').toBe(count);
  }
  promises(expected: PromiseText[]): void {
    const actual = recorded(this.observations.promises, 'Collect promises before checking them');
    expect(actual, 'Authored prose promises').toEqual(expected);
  }
  sourceUnchanged(): void {
    const read = recorded(this.observations.read, 'Read source before checking it');
    expect(read.result, 'Source read result after inspection').toEqual(read.before);
  }
  rejectedWithDiagnostics(): void {
    const read = recorded(this.observations.read, 'Read source before checking it');
    expect(read.result.status, 'Source read status').toBe('rejected');
    if (read.result.status !== 'rejected') throw new Error('Expected syntax rejection');
    expect(read.result.diagnostics.length, 'Reader rejection includes diagnostics').toBeGreaterThan(0);
    expect(read.inspectionCreated, 'Rejected source must not reach inspection').toBe(false);
    expect(read.result.diagnostics).toEqual(read.before.status === 'rejected' ? read.before.diagnostics : []);
  }
}

