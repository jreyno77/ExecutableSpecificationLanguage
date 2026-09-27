import { InspectionError, type Inspection, type InspectionKind, type InspectionNode, type NodeId } from './model.js';
const handles = new WeakSet<object>();
export function createNodeId(): NodeId {
  const id = Object.freeze({}) as NodeId;
  handles.add(id);
  return id;
}
/** Shared query mechanics for declared and enriched snapshot views. */
export class InspectionView implements Inspection {
  private readonly byId: ReadonlyMap<NodeId, InspectionNode>;
  constructor(private readonly rootIds: readonly NodeId[], private readonly orderedNodes: readonly InspectionNode[],
    private readonly unanalyzed: ReadonlySet<NodeId> = new Set()) {
    this.byId = new Map(orderedNodes.map(node => [node.id, node]));
  }
  roots(): Iterable<NodeId> { return this.rootIds; }
  nodes<K extends InspectionKind>(kind: K): Iterable<InspectionNode<K>> {
    const nodes = this.orderedNodes;
    return { *[Symbol.iterator]() { for (const node of nodes) if (node.payload.kind === kind) yield node as InspectionNode<K>; } };
  }
  node(id: NodeId): InspectionNode;
  node<K extends InspectionKind>(id: NodeId, kind: K): InspectionNode<K>;
  node(id: NodeId, kind?: InspectionKind): InspectionNode {
    const node = this.byId.get(id);
    if (!node) {
      const code = this.unanalyzed.has(id) ? 'not-analyzed' : typeof id === 'object' && id !== null && handles.has(id) ? 'foreign-node' : 'missing-node';
      throw new InspectionError(code, id, `The node is ${code} in this inspection.`);
    }
    if (kind !== undefined && node.payload.kind !== kind) throw new InspectionError('unexpected-kind', id,
      `Expected ${kind}, found ${node.payload.kind}.`, kind, node.payload.kind);
    return node;
  }
  name(id: NodeId): string { return this.node(id, 'name').payload.decoded; }
  reference(id: NodeId): readonly string[] { return this.node(id, 'reference').payload.segments.map(id => this.name(id)); }
}
