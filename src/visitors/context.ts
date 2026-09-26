import type { SourceNodeId } from '../grammar/source.js';
import type { VisitorContext, VisitorInput, VisitorKind, VisitorNode } from './types.js';

export class VisitError extends Error {
  constructor(message: string) { super(message); this.name = 'VisitError'; }
}

export function createContext(description: VisitorInput): VisitorContext {
  function node<K extends VisitorKind>(id: SourceNodeId, expectedKind: K): VisitorNode<K> {
    if (id.sourceId !== description.sourceId) {
      throw new VisitError(`Node belongs to ${id.sourceId}, not ${description.sourceId}.`);
    }
    if (!Number.isInteger(id.ordinal) || id.ordinal < 0) {
      throw new VisitError(`Node ordinal ${id.ordinal} is not a non-negative integer.`);
    }
    const found = description.nodes[id.ordinal];
    if (!found || found.id.sourceId !== id.sourceId || found.id.ordinal !== id.ordinal) {
      throw new VisitError(`Node ${id.ordinal} does not exist in ${description.sourceId}.`);
    }
    if (found.payload.kind !== expectedKind) {
      throw new VisitError(`Node ${id.ordinal} is ${found.payload.kind}; expected ${expectedKind}.`);
    }
    return found as VisitorNode<K>;
  }
  return {
    node,
    name(id) { return node(id, 'name').payload.decoded; },
    reference(id) { return node(id, 'reference').payload.segments.map(segment => node(segment, 'name').payload.decoded); },
  } as VisitorContext;
}