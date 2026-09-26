// Comparison prototype retained for CORE-19; not part of the released API.
import type { SourceDescription, SourceNodeId } from '../../../src/index.js';
import { createSourceLookup, type SourceKind, type SourceLookup, type SourceNodeOf } from '../../../src/inspection/source-access.js';

export type SourceVisitors = { [K in SourceKind]?: (node: SourceNodeOf<K>, source: SourceLookup) => void };
export function visitSource(source: SourceDescription, visitors: SourceVisitors): void {
  const lookup = createSourceLookup(source);
  function dispatch<K extends SourceKind>(kind: K, id: SourceNodeId): void {
    const visitor = visitors[kind];
    if (visitor) visitor(lookup.node(id, kind), lookup);
  }
  // The reader supplies the structural forest in authored depth-first order.
  for (const node of source.nodes) dispatch(node.payload.kind, node.id);
}
