import { isNodeId, propertyNames, QueryError, type Model, type ModelNode, type NodeId, type NodeKind, type ReferenceResolution } from './model.js';

/** Shared indexes for owned structural records and captured resolution results. */
export class IndexedModel implements Model {
  private readonly byId = new Map<NodeId, ModelNode>();
  private readonly byKind = new Map<NodeKind, ModelNode[]>();
  private readonly childrenById = new Map<NodeId, readonly NodeId[]>();
  private readonly parents = new Map<NodeId, NodeId>();
  private readonly rootIds: readonly NodeId[];
  constructor(roots: readonly NodeId[], nodes: readonly ModelNode[],
    private readonly bindings: ReadonlyMap<NodeId, ReferenceResolution> = new Map(),
    private readonly unanalyzed: ReadonlySet<NodeId> = new Set(),
    containment?: ReadonlyMap<NodeId, readonly NodeId[]>) {
    this.rootIds = [...roots];
    for (const node of nodes) {
      this.byId.set(node.id, node);
      const group = this.byKind.get(node.kind) ?? [];
      group.push(node);
      this.byKind.set(node.kind, group);
      const children = containment?.get(node.id) ?? propertyNames(node).map(key => [key, (node as unknown as Record<string, unknown>)[key]] as const)
        .filter(([key]) => key !== 'id' && key !== 'origin').flatMap(([, value]) => containedIds(value));
      this.childrenById.set(node.id, [...children]);
      for (const child of children) this.parents.set(child, node.id);
    }
  }
  roots(): readonly NodeId[] { return this.rootIds; }
  nodes<K extends NodeKind>(kind: K): readonly ModelNode<K>[] {
    return (this.byKind.get(kind) ?? []) as ModelNode<K>[];
  }
  node(id: NodeId): ModelNode;
  node<K extends NodeKind>(id: NodeId, kind: K): ModelNode<K>;
  node(id: NodeId, kind?: NodeKind): ModelNode {
    const node = this.byId.get(id);
    if (!node) {
      const code = this.unanalyzed.has(id) ? 'not-analyzed' : isNodeId(id) ? 'foreign-node' : 'missing-node';
      throw new QueryError(code, id, `The node is ${code} in this model.`);
    }
    if (kind !== undefined && node.kind !== kind) throw new QueryError('unexpected-kind', id,
      `Expected ${kind}, found ${node.kind}.`, kind, node.kind);
    return node;
  }
  children(id: NodeId): readonly NodeId[] { this.node(id); return this.childrenById.get(id)!; }
  parent(id: NodeId): NodeId | undefined { this.node(id); return this.parents.get(id); }
  resolution(reference: NodeId): ReferenceResolution {
    this.node(reference, 'reference');
    return this.bindings.get(reference) ?? { status: 'not-analyzed' };
  }
}

function containedIds(value: unknown): NodeId[] {
  if (isNodeId(value)) return [value];
  if (Array.isArray(value)) return value.flatMap(containedIds);
  if (value && typeof value === 'object') return Object.values(value).flatMap(containedIds);
  return [];
}
