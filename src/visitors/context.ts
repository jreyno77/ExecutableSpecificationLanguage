import type { SourceNodeId } from '../grammar/source.js';
import type { VisitorContext, VisitorInput, VisitorKind, VisitorNode } from './types.js';

type Failure =
  | { code: 'foreign-source' | 'missing-node'; nodeId: SourceNodeId }
  | { code: 'unexpected-kind'; nodeId: SourceNodeId; expectedKind: VisitorKind; actualKind: VisitorKind };

export class VisitError extends Error {
  readonly code: Failure['code'];
  readonly nodeId: Readonly<SourceNodeId>;
  readonly expectedKind?: VisitorKind;
  readonly actualKind?: VisitorKind;

  constructor(failure: Failure, message: string) {
    super(message);
    this.name = 'VisitError';
    this.code = failure.code;
    this.nodeId = { ...failure.nodeId };
    if (failure.code === 'unexpected-kind') {
      this.expectedKind = failure.expectedKind;
      this.actualKind = failure.actualKind;
    }
  }
}

/** Follow references within one stable reader snapshot, without resolving names. */
export function createContext(description: VisitorInput): VisitorContext {
  function node(id: SourceNodeId): VisitorNode;
  function node<K extends VisitorKind>(id: SourceNodeId, expectedKind: K): VisitorNode<K>;
  function node(id: SourceNodeId, expectedKind?: VisitorKind): VisitorNode {
    if (id.sourceId !== description.sourceId) {
      throw new VisitError({ code: 'foreign-source', nodeId: id },
        `Node belongs to ${id.sourceId}, not ${description.sourceId}.`);
    }
    if (!Number.isInteger(id.ordinal) || id.ordinal < 0) {
      throw new VisitError({ code: 'missing-node', nodeId: id },
        `Node ordinal ${id.ordinal} is not a non-negative integer.`);
    }
    const found = description.nodes[id.ordinal];
    if (!found || found.id.sourceId !== id.sourceId || found.id.ordinal !== id.ordinal) {
      throw new VisitError({ code: 'missing-node', nodeId: id },
        `Node ${id.ordinal} does not exist in ${description.sourceId}.`);
    }
    if (expectedKind !== undefined && found.payload.kind !== expectedKind) {
      throw new VisitError({
        code: 'unexpected-kind', nodeId: id, expectedKind, actualKind: found.payload.kind,
      }, `Node ${id.ordinal} is ${found.payload.kind}; expected ${expectedKind}.`);
    }
    // Reader variants group some kinds; the checked overload narrows that same data.
    return found as VisitorNode;
  }

  function name(id: SourceNodeId): string { return node(id, 'name').payload.decoded; }
  function reference(id: SourceNodeId): readonly string[] {
    return node(id, 'reference').payload.segments.map(name);
  }
  return { node, name, reference };
}
