import {
  capabilitySummaries, namedTypeOccurrences, promiseDescriptions,
  type Capability, type TypeUse, type PromiseText,
} from './inspection-collectors.js';
import { createSyntaxReader, DescriptionInspection, type Inspection, type InspectionNode, type ReadResult } from '../../src/index.js';

function recorded<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

export class QueryInspectionDriver {
  private result: ReadResult | undefined;
  original!: ReadResult;
  inspection: Inspection | undefined;
  private capabilities: Capability[] | undefined;
  private typeUses: TypeUse[] | undefined;
  private typeIds: object[] = [];
  private promises: PromiseText[] | undefined;

  sourceIs(sourceId: string, text: string): void {
    this.capabilities = undefined;
    this.typeUses = undefined;
    this.typeIds = [];
    this.promises = undefined;
    this.result = createSyntaxReader().read({ sourceId, text });
    this.original = structuredClone(this.result);
    this.inspection = this.result.status === 'accepted' ? new DescriptionInspection(sourceId, this.result.description) : undefined;
  }

  collectCapabilities(): void {
    this.capabilities = capabilitySummaries(this.acceptedInspection());
  }

  collectNamedTypes(): void {
    const occurrences = namedTypeOccurrences(this.acceptedInspection());
    this.typeUses = occurrences.map(occurrence => occurrence.fact);
    this.typeIds = occurrences.map(occurrence => occurrence.id);
  }

  collectPromises(): void {
    this.promises = promiseDescriptions(this.acceptedInspection());
  }

  collectedCapabilities(): Capability[] {
    return recorded(this.capabilities, 'Collect capabilities before checking them');
  }

  collectedTypes(): TypeUse[] {
    return recorded(this.typeUses, 'Collect named types before checking them');
  }

  collectedTypeIds(): object[] {
    this.collectedTypes();
    return this.typeIds;
  }

  collectedPromises(): PromiseText[] {
    return recorded(this.promises, 'Collect promises before checking them');
  }

  readResult(): ReadResult {
    return recorded(this.result, 'Read source before checking it');
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
  return new DescriptionInspection(sourceId, result.description);
}

export function capabilityNames(inspection: Inspection, nodes: Iterable<InspectionNode<'capability'>>): string[] {
  return Array.from(nodes, node => inspection.name(node.payload.name));
}
