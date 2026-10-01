import { LangiumReader, LangiumModel, QueryInspection, type Inspection, type Item, type ReadResult, type SourceDocument } from '../../src/index.js';

export class InspectionQueryDriver {
  result: ReadResult | undefined;
  source: SourceDocument | undefined;
  originalSource: SourceDocument | undefined;
  inspection: Inspection | undefined;

  sourceIs(sourceId: string, text: string): void {
    this.source = { sourceId, text };
    this.originalSource = { ...this.source };
    this.result = new LangiumReader().read(this.source);
    this.inspection = this.result.status === 'accepted' ? new QueryInspection(new LangiumModel(sourceId, this.result.document)) : undefined;
  }
  acceptedInspection(): Inspection {
    if (!this.inspection) throw new Error('Expected syntactically accepted source');
    return this.inspection;
  }
}

export function inspectText(text: string, sourceId = 'store.expec'): Inspection {
  const driver = new InspectionQueryDriver();
  driver.sourceIs(sourceId, text);
  return driver.acceptedInspection();
}
export function capabilityNames(nodes: Iterable<Item<'capability'>>): string[] {
  return Array.from(nodes, node => node.name);
}
