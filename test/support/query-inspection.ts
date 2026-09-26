import { createSyntaxReader, inspect, collect, type Inspection, type InspectionNode } from '../../src/index.js';
import { capabilityCollector, namedTypeCollector, promiseCollector } from './inspection-collectors.js';
import { InspectionExpectations, type InspectionObservations } from './inspection-expectations.js';

export class QueryInspection {
  private inspection: Inspection | undefined;
  private readonly observations: InspectionObservations = {};
  readonly expect = new InspectionExpectations(this.observations);

  sourceIs(sourceId: string, text: string): void {
    delete this.observations.capabilities;
    delete this.observations.namedTypes;
    delete this.observations.promises;
    const result = createSyntaxReader().read({ sourceId, text });
    const before = structuredClone(result);
    this.inspection = result.status === 'accepted' ? inspect(result.description) : undefined;
    this.observations.read = { result, before, inspectionCreated: this.inspection !== undefined };
  }

  collectCapabilities(): void {
    this.observations.capabilities = collect(this.acceptedInspection(), capabilityCollector);
  }

  collectNamedTypes(): void {
    this.observations.namedTypes = collect(this.acceptedInspection(), namedTypeCollector);
  }

  collectPromises(): void {
    this.observations.promises = collect(this.acceptedInspection(), promiseCollector);
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
  return inspect(result.description);
}

export function capabilityNames(inspection: Inspection, nodes: Iterable<InspectionNode<'capability'>>): string[] {
  return Array.from(nodes, node => inspection.name(node.payload.name));
}

