import { AntlrSyntaxReader } from '../../src/grammar/reader.js';
import type { ReadResult, SourceDescription, SourceNode, SourceNodeId, SourcePayload } from '../../src/grammar/source.js';

export function readSyntax(text: string, sourceId = 'memory:example'): ReadResult {
  return new AntlrSyntaxReader().read({ sourceId, text });
}

type NodeOfKind<Kind extends SourcePayload['kind']> = SourceNode & { payload: SourcePayload & { kind: Kind } };
export function nodesOfKind<Kind extends SourcePayload['kind']>(source: SourceDescription, kind: Kind): NodeOfKind<Kind>[] {
  return source.nodes.filter((node): node is NodeOfKind<Kind> => node.payload.kind === kind);
}
export function nodeFor(source: SourceDescription, id: SourceNodeId): SourceNode {
  const node = source.nodes[id.ordinal];
  if (!node) throw new Error(`The source description is missing node ${id.ordinal}.`);
  return node;
}
export function childrenOf(node: SourceNode): SourceNodeId[] {
  return Object.entries(node.payload).flatMap(([key, value]) => {
    if (key === 'operatorRange') return [];
    const values = Array.isArray(value) ? value : [value];
    return values.filter((value): value is SourceNodeId => typeof value === 'object' && value !== null && 'ordinal' in value);
  });
}
