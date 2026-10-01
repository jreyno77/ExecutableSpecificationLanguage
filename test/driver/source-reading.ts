import { createSyntaxReader } from '../../src/index.js';
import type { AcceptedSource, ReadResult, SourceDocument, SourceNode, SourceNodeId } from '../../src/index.js';

export class SourceReadingDriver {
  private readonly reader = createSyntaxReader();
  private source: SourceDocument | undefined;
  originalSource: SourceDocument | undefined;
  result: ReadResult | undefined;

  sourceIs(text: string): void {
    this.source = { sourceId: 'memory:example', text };
    this.originalSource = structuredClone(this.source);
    this.result = undefined;
  }
  readSource(): void {
    if (!this.source) throw new Error('Supply a specification before reading it.');
    this.result = this.reader.read(this.source);
  }
  conceptNamed(name: string): SourceNode | undefined {
    return this.acceptedResult().description.nodes.find(node => {
      if (node.payload.kind !== 'concept') return false;
      const declaredName = this.nodeFor(node.payload.name);
      return declaredName?.payload.kind === 'name' && declaredName.payload.decoded === name;
    });
  }
  acceptedResult(): AcceptedSource {
    if (this.result?.status !== 'accepted') throw new Error('The reader did not accept the supplied specification.');
    return this.result;
  }
  nodeFor(id: SourceNodeId): SourceNode | undefined {
    return this.acceptedResult().description.nodes.find(node => node.id.sourceId === id.sourceId && node.id.ordinal === id.ordinal);
  }
}
