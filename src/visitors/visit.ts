import { createContext } from './context.js';
import type { VisitorInput, VisitorKind, Visitors } from './types.js';
import type { SourceNodeId } from '../grammar/source.js';

/** Deliver matching nodes from an accepted, stable reader snapshot. */
export function visit(description: VisitorInput, visitors: Visitors): void {
  const context = createContext(description);
  function dispatch<K extends VisitorKind>(kind: K, id: SourceNodeId): void {
    const visitor = visitors[kind];
    if (visitor) visitor(context.node(id, kind), context);
  }
  // The reader already publishes parent-before-descendant source order.
  for (const node of description.nodes) dispatch(node.payload.kind, node.id);
}