import { expect } from 'vitest';
import {
  capabilitySummaries, namedTypeOccurrences, promiseDescriptions,
  type Capability, type TypeUse, type PromiseText,
} from './inspection-collectors.js';
import { createSyntaxReader, DescriptionInspection, type Inspection, type InspectionNode, type ReadResult } from '../../src/index.js';

function recorded<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

export class QueryInspection {
  private result: ReadResult | undefined;
  private original!: ReadResult;
  private inspection: Inspection | undefined;
  private capabilities: Capability[] | undefined;
  private typeUses: TypeUse[] | undefined;
  private typeIds: string[] = [];
  private promises: PromiseText[] | undefined;

  sourceIs(sourceId: string, text: string): void {
    this.capabilities = undefined;
    this.typeUses = undefined;
    this.typeIds = [];
    this.promises = undefined;
    this.result = createSyntaxReader().read({ sourceId, text });
    this.original = structuredClone(this.result);
    this.inspection = this.result.status === 'accepted' ? new DescriptionInspection(this.result.description) : undefined;
  }

  collectCapabilities(): void {
    this.capabilities = capabilitySummaries(this.acceptedInspection());
  }

  collectNamedTypes(): void {
    const occurrences = namedTypeOccurrences(this.acceptedInspection());
    this.typeUses = occurrences.map(occurrence => occurrence.fact);
    this.typeIds = occurrences.map(occurrence => JSON.stringify(occurrence.id));
  }

  collectPromises(): void {
    this.promises = promiseDescriptions(this.acceptedInspection());
  }

  expectCapabilities(expected: Capability[]): void {
    const actual = recorded(this.capabilities, 'Collect capabilities before checking them');
    expect(actual, 'Capability declarations in authored order').toEqual(expected);
  }

  expectCapabilityNames(expected: string[]): void {
    const actual = recorded(this.capabilities, 'Collect capabilities before checking them');
    expect(actual.map(item => item.name), 'Capability names in authored order').toEqual(expected);
  }

  expectNamedTypes(expected: TypeUse[]): void {
    const actual = recorded(this.typeUses, 'Collect named types before checking them');
    expect(actual, 'Named type occurrences in authored order').toEqual(expected);
  }

  expectTypeNames(expected: string[]): void {
    const actual = recorded(this.typeUses, 'Collect named types before checking them');
    expect(actual.map(item => item.name), 'Named type spellings in authored order').toEqual(expected);
  }

  expectDistinctTypeOccurrences(count: number): void {
    recorded(this.typeUses, 'Collect named types before checking them');
    expect(this.typeIds).toHaveLength(count);
    expect(new Set(this.typeIds).size).toBe(count);
  }

  expectPromises(expected: PromiseText[]): void {
    const actual = recorded(this.promises, 'Collect promises before checking them');
    expect(actual, 'Authored prose promises').toEqual(expected);
  }

  expectSourceUnchanged(): void {
    const actual = recorded(this.result, 'Read source before checking it');
    expect(actual, 'Source read result after inspection').toEqual(this.original);
  }

  expectRejectedWithDiagnostics(): void {
    const result = recorded(this.result, 'Read source before checking it');
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('Expected syntax rejection');
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(this.inspection).toBeUndefined();
    expect(result.diagnostics).toEqual(this.original.status === 'rejected' ? this.original.diagnostics : []);
  }

  private acceptedInspection(): Inspection {
    if (!this.inspection) throw new Error('Expected syntactically accepted source');
    return this.inspection;
  }
}

/** Unit tests use the public reader too; no private-node search constructs their expectations. */
export function inspectText(text: string, sourceId = 'store.expec'): Inspection {
  const result = createSyntaxReader().read({ sourceId, text });
  if (result.status !== 'accepted') throw new Error(JSON.stringify(result.diagnostics));
  return new DescriptionInspection(result.description);
}

export function capabilityNames(inspection: Inspection, nodes: Iterable<InspectionNode<'capability'>>): string[] {
  return Array.from(nodes, node => inspection.name(node.payload.name));
}
